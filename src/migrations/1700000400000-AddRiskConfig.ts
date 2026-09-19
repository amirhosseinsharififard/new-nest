import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRiskConfig1700000400000 implements MigrationInterface {
  name = 'AddRiskConfig1700000400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "risk_config" (
        "id" uuid NOT NULL,
        "maxConcurrentPositions" integer NOT NULL DEFAULT 5,
        "consecutiveFailureLimit" integer NOT NULL DEFAULT 3,
        "consecutiveFailureCount" integer NOT NULL DEFAULT 0,
        "killSwitchActive" boolean NOT NULL DEFAULT false,
        "killSwitchReason" text,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_risk_config" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      ALTER TYPE "arbitrage_opportunities_outcome_enum" ADD VALUE 'risk_blocked';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "risk_config";`);
    // نکته: Postgres حذف مقدار از ENUM را به‌صورت مستقیم پشتیبانی نمی‌کند؛
    // برای rollback کامل باید ENUM را از نو ساخت. در این نسخه از down صرف‌نظر شده.
  }
}
