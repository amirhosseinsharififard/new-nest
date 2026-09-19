import { IsBoolean, IsNumber, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';

export class UpdateStrategyDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minSpreadPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  takerFeeAPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  takerFeeBPercent?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  maxPositionSize?: number;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  orderQuantity?: number;

  @IsOptional()
  @IsBoolean()
  autoExecute?: boolean;

  @IsOptional()
  @IsUUID()
  exchangeAAccountId?: string;

  @IsOptional()
  @IsUUID()
  exchangeBAccountId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
