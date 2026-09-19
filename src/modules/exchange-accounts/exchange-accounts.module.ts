import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeAccount } from './entities/exchange-account.entity';
import { Exchange } from '../exchanges/entities/exchange.entity';
import { ExchangeAccountsService } from './exchange-accounts.service';
import { ExchangeAccountsController } from './exchange-accounts.controller';
import { EncryptionService } from '../../common/crypto/encryption.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExchangeAccount, Exchange])],
  controllers: [ExchangeAccountsController],
  providers: [ExchangeAccountsService, EncryptionService],
  exports: [ExchangeAccountsService],
})
export class ExchangeAccountsModule {}
