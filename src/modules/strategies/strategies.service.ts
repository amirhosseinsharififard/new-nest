import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ArbitrageStrategy } from './entities/arbitrage-strategy.entity';
import { Exchange } from '../exchanges/entities/exchange.entity';
import { ExchangeAccount } from '../exchange-accounts/entities/exchange-account.entity';
import { CreateStrategyDto } from './dto/create-strategy.dto';
import { UpdateStrategyDto } from './dto/update-strategy.dto';

@Injectable()
export class StrategiesService {
  constructor(
    @InjectRepository(ArbitrageStrategy)
    private readonly strategyRepo: Repository<ArbitrageStrategy>,
    @InjectRepository(Exchange)
    private readonly exchangeRepo: Repository<Exchange>,
    @InjectRepository(ExchangeAccount)
    private readonly accountRepo: Repository<ExchangeAccount>,
  ) {}

  async create(dto: CreateStrategyDto): Promise<ArbitrageStrategy> {
    if (dto.exchangeAId === dto.exchangeBId) {
      throw new ConflictException('exchangeA و exchangeB نمی‌توانند یکسان باشند');
    }

    const [exchangeA, exchangeB] = await Promise.all([
      this.exchangeRepo.findOne({ where: { id: dto.exchangeAId } }),
      this.exchangeRepo.findOne({ where: { id: dto.exchangeBId } }),
    ]);
    if (!exchangeA || !exchangeB) {
      throw new NotFoundException('یکی از صرافی‌های انتخاب‌شده یافت نشد');
    }

    const existing = await this.strategyRepo.findOne({
      where: {
        symbol: dto.symbol,
        exchangeA: { id: dto.exchangeAId },
        exchangeB: { id: dto.exchangeBId },
      },
    });
    if (existing) {
      throw new ConflictException(
        'استراتژی‌ای برای این ترکیب symbol/exchangeA/exchangeB از قبل وجود دارد',
      );
    }

    // اگر autoExecute درخواست شده، باید هر دو اکانت معاملاتی مشخص شده باشن
    // وگرنه سیستم نمی‌دونه با کدوم Credential باید پوزیشن باز کنه
    if (dto.autoExecute && (!dto.exchangeAAccountId || !dto.exchangeBAccountId)) {
      throw new ConflictException(
        'برای فعال کردن autoExecute، باید exchangeAAccountId و exchangeBAccountId هر دو مشخص شوند',
      );
    }

    const [exchangeAAccount, exchangeBAccount] = await Promise.all([
      dto.exchangeAAccountId
        ? this.accountRepo.findOne({ where: { id: dto.exchangeAAccountId } })
        : Promise.resolve(null),
      dto.exchangeBAccountId
        ? this.accountRepo.findOne({ where: { id: dto.exchangeBAccountId } })
        : Promise.resolve(null),
    ]);
    if (dto.exchangeAAccountId && !exchangeAAccount) {
      throw new NotFoundException('exchangeAAccountId یافت نشد');
    }
    if (dto.exchangeBAccountId && !exchangeBAccount) {
      throw new NotFoundException('exchangeBAccountId یافت نشد');
    }

    const strategy = this.strategyRepo.create({
      symbol: dto.symbol,
      exchangeA,
      exchangeB,
      minSpreadPercent: dto.minSpreadPercent.toString(),
      takerFeeAPercent: dto.takerFeeAPercent?.toString(),
      takerFeeBPercent: dto.takerFeeBPercent?.toString(),
      maxPositionSize: dto.maxPositionSize.toString(),
      orderQuantity: dto.orderQuantity.toString(),
      autoExecute: dto.autoExecute ?? false,
      exchangeAAccount,
      exchangeBAccount,
    });

    return this.strategyRepo.save(strategy);
  }

  async findAll(): Promise<ArbitrageStrategy[]> {
    return this.strategyRepo.find({
      relations: ['exchangeA', 'exchangeB', 'exchangeAAccount', 'exchangeBAccount'],
    });
  }

  async findOne(id: string): Promise<ArbitrageStrategy> {
    const strategy = await this.strategyRepo.findOne({
      where: { id },
      relations: ['exchangeA', 'exchangeB', 'exchangeAAccount', 'exchangeBAccount'],
    });
    if (!strategy) {
      throw new NotFoundException('استراتژی یافت نشد');
    }
    return strategy;
  }

  /** برای استفاده داخلی توسط OpportunityDetectorService (فقط استراتژی‌های فعال) */
  async findAllActive(): Promise<ArbitrageStrategy[]> {
    return this.strategyRepo.find({
      where: { isActive: true },
      relations: ['exchangeA', 'exchangeB', 'exchangeAAccount', 'exchangeBAccount'],
    });
  }

  async update(id: string, dto: UpdateStrategyDto): Promise<ArbitrageStrategy> {
    const strategy = await this.findOne(id);

    if (dto.minSpreadPercent !== undefined) {
      strategy.minSpreadPercent = dto.minSpreadPercent.toString();
    }
    if (dto.takerFeeAPercent !== undefined) {
      strategy.takerFeeAPercent = dto.takerFeeAPercent.toString();
    }
    if (dto.takerFeeBPercent !== undefined) {
      strategy.takerFeeBPercent = dto.takerFeeBPercent.toString();
    }
    if (dto.maxPositionSize !== undefined) {
      strategy.maxPositionSize = dto.maxPositionSize.toString();
    }
    if (dto.orderQuantity !== undefined) {
      strategy.orderQuantity = dto.orderQuantity.toString();
    }
    if (dto.exchangeAAccountId !== undefined) {
      const account = await this.accountRepo.findOne({ where: { id: dto.exchangeAAccountId } });
      if (!account) throw new NotFoundException('exchangeAAccountId یافت نشد');
      strategy.exchangeAAccount = account;
    }
    if (dto.exchangeBAccountId !== undefined) {
      const account = await this.accountRepo.findOne({ where: { id: dto.exchangeBAccountId } });
      if (!account) throw new NotFoundException('exchangeBAccountId یافت نشد');
      strategy.exchangeBAccount = account;
    }

    const nextAutoExecute = dto.autoExecute ?? strategy.autoExecute;
    if (nextAutoExecute && (!strategy.exchangeAAccount || !strategy.exchangeBAccount)) {
      throw new ConflictException(
        'برای فعال کردن autoExecute، باید هر دو اکانت معاملاتی مشخص شده باشند',
      );
    }
    if (dto.autoExecute !== undefined) {
      strategy.autoExecute = dto.autoExecute;
    }
    if (dto.isActive !== undefined) {
      strategy.isActive = dto.isActive;
    }

    return this.strategyRepo.save(strategy);
  }

  async remove(id: string): Promise<void> {
    const strategy = await this.findOne(id);
    await this.strategyRepo.remove(strategy);
  }
}
