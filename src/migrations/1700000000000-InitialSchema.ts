import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" varchar NOT NULL,
        "passwordHash" varchar NOT NULL,
        "twoFactorSecret" varchar,
        "isTwoFactorEnabled" boolean NOT NULL DEFAULT false,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "exchanges_markettype_enum" AS ENUM ('spot', 'futures');
      CREATE TABLE "exchanges" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "slug" varchar NOT NULL,
        "displayName" varchar NOT NULL,
        "marketType" "exchanges_markettype_enum" NOT NULL,
        "restBaseUrl" varchar NOT NULL,
        "wsBaseUrl" varchar NOT NULL,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_exchanges_slug" UNIQUE ("slug"),
        CONSTRAINT "PK_exchanges" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE TYPE "exchange_accounts_permissionlevel_enum" AS ENUM ('read_only', 'trade', 'withdraw');
      CREATE TABLE "exchange_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "exchange_id" uuid NOT NULL,
        "label" varchar NOT NULL,
        "encryptedApiKey" text NOT NULL,
        "encryptedApiSecret" text NOT NULL,
        "permissionLevel" "exchange_accounts_permissionlevel_enum" NOT NULL DEFAULT 'trade',
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_exchange_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_exchange_accounts_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_exchange_accounts_exchange" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_exchange_accounts_user_exchange_label" UNIQUE ("user_id", "exchange_id", "label")
      );
    `);

    await queryRunner.query(`
      CREATE TABLE "balances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "exchange_account_id" uuid NOT NULL,
        "asset" varchar NOT NULL,
        "free" decimal(20,8) NOT NULL DEFAULT 0,
        "locked" decimal(20,8) NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_balances" PRIMARY KEY ("id"),
        CONSTRAINT "FK_balances_exchange_account" FOREIGN KEY ("exchange_account_id") REFERENCES "exchange_accounts"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_balances_account_asset" UNIQUE ("exchange_account_id", "asset")
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "balances";`);
    await queryRunner.query(`DROP TABLE "exchange_accounts";`);
    await queryRunner.query(`DROP TYPE "exchange_accounts_permissionlevel_enum";`);
    await queryRunner.query(`DROP TABLE "exchanges";`);
    await queryRunner.query(`DROP TYPE "exchanges_markettype_enum";`);
    await queryRunner.query(`DROP TABLE "users";`);
  }
}
