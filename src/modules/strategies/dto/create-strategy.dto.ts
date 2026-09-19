import { IsBoolean, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateStrategyDto {
  @IsString()
  symbol: string;

  @IsUUID()
  exchangeAId: string;

  @IsUUID()
  exchangeBId: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  minSpreadPercent: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  takerFeeAPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  takerFeeBPercent?: number;

  @IsNumber()
  @IsPositive()
  maxPositionSize: number;

  @IsNumber()
  @IsPositive()
  orderQuantity: number;

  @IsOptional()
  @IsBoolean()
  autoExecute?: boolean;

  @IsOptional()
  @IsUUID()
  exchangeAAccountId?: string;

  @IsOptional()
  @IsUUID()
  exchangeBAccountId?: string;
}
