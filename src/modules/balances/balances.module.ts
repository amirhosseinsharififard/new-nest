import { Controller, Get, Module, Param, UseGuards } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance } from './entities/balance.entity';
import { ExchangeAccount } from '../exchange-accounts/entities/exchange-account.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BalanceSyncService } from './balance-sync.service';
import { ExchangeAccountsModule } from '../exchange-accounts/exchange-accounts.module';
import { ExchangeModule } from '../../core/exchange/exchange.module';

@UseGuards(JwtAuthGuard)
@Controller('exchange-accounts/:accountId/balance')
class BalancesController {
  constructor(
    @InjectRepository(Balance) private readonly repo: Repository<Balance>,
  ) {}

  // این مقادیر توسط BalanceSyncService هر ۶۰ ثانیه از صرافی به‌روزرسانی می‌شوند
  @Get()
  findByAccount(@Param('accountId') accountId: string) {
    return this.repo.find({
      where: { exchangeAccount: { id: accountId } },
    });
  }
}

@Module({
  imports: [
    TypeOrmModule.forFeature([Balance, ExchangeAccount]),
    ExchangeAccountsModule,
    ExchangeModule,
  ],
  controllers: [BalancesController],
  providers: [BalanceSyncService],
  exports: [BalanceSyncService],
})
export class BalancesModule {}
