import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFlexibleCredentialColumns1700000100000
  implements MigrationInterface
{
  name = 'AddFlexibleCredentialColumns1700000100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // apiKey/apiSecret دیگه الزامی (NOT NULL) نیستن، چون اکانت‌هایی
    // که فقط publicKey/privateKey دارن این دو فیلد رو خالی می‌ذارن.
    await queryRunner.query(`
      ALTER TABLE "exchange_accounts"
      ALTER COLUMN "encryptedApiKey" DROP NOT NULL,
      ALTER COLUMN "encryptedApiSecret" DROP NOT NULL,
      ADD COLUMN "encryptedPassphrase" text,
      ADD COLUMN "encryptedPublicKey" text,
      ADD COLUMN "encryptedPrivateKey" text;
    `);

    // تضمین دیتابیسی همون قانونی که در Service چک می‌کنیم:
    // حداقل یکی از دو ترکیب (apiKey+apiSecret) یا (publicKey+privateKey) باید موجود باشه
    await queryRunner.query(`
      ALTER TABLE "exchange_accounts"
      ADD CONSTRAINT "CHK_exchange_accounts_has_credentials" CHECK (
        ("encryptedApiKey" IS NOT NULL AND "encryptedApiSecret" IS NOT NULL)
        OR
        ("encryptedPublicKey" IS NOT NULL AND "encryptedPrivateKey" IS NOT NULL)
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "exchange_accounts"
      DROP CONSTRAINT "CHK_exchange_accounts_has_credentials";
    `);
    await queryRunner.query(`
      ALTER TABLE "exchange_accounts"
      DROP COLUMN "encryptedPassphrase",
      DROP COLUMN "encryptedPublicKey",
      DROP COLUMN "encryptedPrivateKey",
      ALTER COLUMN "encryptedApiKey" SET NOT NULL,
      ALTER COLUMN "encryptedApiSecret" SET NOT NULL;
    `);
  }
}
