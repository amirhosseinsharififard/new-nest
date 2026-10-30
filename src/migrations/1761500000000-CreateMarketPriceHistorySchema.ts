
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMarketPriceHistory1761500000000
  implements MigrationInterface
{
  name = 'CreateMarketPriceHistory1761500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "market_price_history" (
        "id" BIGSERIAL PRIMARY KEY,
        "streamId" VARCHAR(50) NOT NULL UNIQUE,
        "exchangeSlug" VARCHAR(30) NOT NULL,
        "symbol" VARCHAR(100) NOT NULL,
        "bidPrice" NUMERIC(30, 12) NOT NULL,
        "bidSize" NUMERIC(30, 12) NOT NULL,
        "askPrice" NUMERIC(30, 12) NOT NULL,
        "askSize" NUMERIC(30, 12) NOT NULL,
        "exchangeTimestamp" BIGINT,
        "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_market_history_symbol_received"
      ON "market_price_history" ("symbol", "receivedAt");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_market_history_exchange_symbol_received"
      ON "market_price_history" ("exchangeSlug", "symbol", "receivedAt");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "market_price_history";`);
  }
}
