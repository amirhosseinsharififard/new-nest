import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOpportunitiesAndPositions1700000300000
  implements MigrationInterface
{
  name = 'AddOpportunitiesAndPositions1700000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- گسترش arbitrage_strategies ---
    await queryRunner.query(`
      ALTER TABLE "arbitrage_strategies"
      ADD COLUMN "autoExecute" boolean NOT NULL DEFAULT false,
      ADD COLUMN "orderQuantity" decimal(20,8) NOT NULL DEFAULT 0,
      ADD COLUMN "exchange_a_account_id" uuid,
      ADD COLUMN "exchange_b_account_id" uuid,
      ADD CONSTRAINT "FK_strategies_exchange_a_account" FOREIGN KEY ("exchange_a_account_id") REFERENCES "exchange_accounts"("id") ON DELETE RESTRICT,
      ADD CONSTRAINT "FK_strategies_exchange_b_account" FOREIGN KEY ("exchange_b_account_id") REFERENCES "exchange_accounts"("id") ON DELETE RESTRICT;
    `);

    // --- arbitrage_opportunities ---
    await queryRunner.query(`
      CREATE TYPE "arbitrage_opportunities_outcome_enum" AS ENUM (
        'below_threshold', 'detected_not_executed', 'executed',
        'execution_failed', 'skipped_locked', 'skipped_position_open'
      );
      CREATE TABLE "arbitrage_opportunities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "strategy_id" uuid NOT NULL,
        "netSpreadPercent" decimal(10,6) NOT NULL,
        "buyOnExchangeSlug" varchar NOT NULL,
        "sellOnExchangeSlug" varchar NOT NULL,
        "outcome" "arbitrage_opportunities_outcome_enum" NOT NULL,
        "resultingPositionId" uuid,
        "note" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_arbitrage_opportunities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_opportunities_strategy" FOREIGN KEY ("strategy_id") REFERENCES "arbitrage_strategies"("id") ON DELETE CASCADE
      );
      CREATE INDEX "IDX_opportunities_strategy_created" ON "arbitrage_opportunities" ("strategy_id", "createdAt");
    `);

    // --- arbitrage_positions ---
    await queryRunner.query(`
      CREATE TYPE "arbitrage_positions_status_enum" AS ENUM (
        'opening', 'open', 'hedging', 'failed', 'closed', 'needs_manual_review'
      );
      CREATE TABLE "arbitrage_positions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "strategy_id" uuid NOT NULL,
        "symbol" varchar NOT NULL,
        "status" "arbitrage_positions_status_enum" NOT NULL DEFAULT 'opening',
        "idempotencyKey" varchar NOT NULL,
        "expectedNetSpreadPercent" decimal(10,6),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_arbitrage_positions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_arbitrage_positions_idempotency" UNIQUE ("idempotencyKey"),
        CONSTRAINT "FK_positions_strategy" FOREIGN KEY ("strategy_id") REFERENCES "arbitrage_strategies"("id") ON DELETE RESTRICT
      );
    `);

    // --- position_legs ---
    await queryRunner.query(`
      CREATE TYPE "position_legs_side_enum" AS ENUM ('long', 'short');
      CREATE TYPE "position_legs_status_enum" AS ENUM (
        'pending', 'submitted', 'filled', 'partially_filled', 'failed', 'cancelled', 'unknown'
      );
      CREATE TABLE "position_legs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "position_id" uuid NOT NULL,
        "exchange_account_id" uuid NOT NULL,
        "side" "position_legs_side_enum" NOT NULL,
        "status" "position_legs_status_enum" NOT NULL DEFAULT 'pending',
        "requestedQuantity" decimal(20,8) NOT NULL,
        "filledQuantity" decimal(20,8),
        "avgFillPrice" decimal(20,8),
        "exchangeOrderId" varchar,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_position_legs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_legs_position" FOREIGN KEY ("position_id") REFERENCES "arbitrage_positions"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_legs_exchange_account" FOREIGN KEY ("exchange_account_id") REFERENCES "exchange_accounts"("id") ON DELETE RESTRICT
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "position_legs";`);
    await queryRunner.query(`DROP TYPE "position_legs_status_enum";`);
    await queryRunner.query(`DROP TYPE "position_legs_side_enum";`);
    await queryRunner.query(`DROP TABLE "arbitrage_positions";`);
    await queryRunner.query(`DROP TYPE "arbitrage_positions_status_enum";`);
    await queryRunner.query(`DROP TABLE "arbitrage_opportunities";`);
    await queryRunner.query(`DROP TYPE "arbitrage_opportunities_outcome_enum";`);
    await queryRunner.query(`
      ALTER TABLE "arbitrage_strategies"
      DROP CONSTRAINT "FK_strategies_exchange_a_account",
      DROP CONSTRAINT "FK_strategies_exchange_b_account",
      DROP COLUMN "autoExecute",
      DROP COLUMN "orderQuantity",
      DROP COLUMN "exchange_a_account_id",
      DROP COLUMN "exchange_b_account_id";
    `);
  }
}
