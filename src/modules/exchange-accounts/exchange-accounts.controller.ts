import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExchangeAccountsService } from './exchange-accounts.service';
import { CreateExchangeAccountDto } from './dto/create-exchange-account.dto';

@UseGuards(JwtAuthGuard)
@Controller('exchange-accounts')
export class ExchangeAccountsController {
  constructor(private readonly service: ExchangeAccountsService) {}

  @Post()
  create(@Req() req: any, @Body() dto: CreateExchangeAccountDto) {
    return this.service.create(req.user.userId, dto);
  }

  @Get()
  findAll(@Req() req: any) {
    return this.service.findAllForUser(req.user.userId);
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(req.user.userId, id);
  }
}
