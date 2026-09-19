import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStrategiesAndSymbolMappings1700000200000
  implements MigrationInterface
{
  name = 'AddStrategiesAndSymbolMappings1700000200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "arbitrage_strategies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "symbol" varchar NOT NULL,
        "exchange_a_id" uuid NOT NULL,
        "exchange_b_id" uuid NOT NULL,
        "minSpreadPercent" decimal(6,4) NOT NULL,
        "takerFeeAPercent" decimal(5,4) NOT NULL DEFAULT 0.04,
        "takerFeeBPercent" decimal(5,4) NOT NULL DEFAULT 0.04,
        "maxPositionSize" decimal(20,8) NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_arbitrage_strategies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_arbitrage_strategies_exchange_a" FOREIGN KEY ("exchange_a_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_arbitrage_strategies_exchange_b" FOREIGN KEY ("exchange_b_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_arbitrage_strategies_symbol_pair" UNIQUE ("symbol", "exchange_a_id", "exchange_b_id")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "symbol_mappings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "internalSymbol" varchar NOT NULL,
        "exchange_id" uuid NOT NULL,
        "exchangeSymbol" varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_symbol_mappings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_symbol_mappings_exchange" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_symbol_mappings_symbol_exchange" UNIQUE ("internalSymbol", "exchange_id")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "symbol_mappings";`);
    await queryRunner.query(`DROP TABLE "arbitrage_strategies";`);
  }
}
