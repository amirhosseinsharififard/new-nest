import { Controller, Get, UseGuards } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Exchange } from './entities/exchange.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('exchanges')
class ExchangesController {
  constructor(
    @InjectRepository(Exchange) private readonly repo: Repository<Exchange>,
  ) {}

  @Get()
  findAll() {
    return this.repo.find({ where: { isActive: true } });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Exchange])],
  controllers: [ExchangesController],
})
export class ExchangesModule {}
