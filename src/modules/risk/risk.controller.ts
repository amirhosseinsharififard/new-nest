import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RiskService } from './risk.service';

class UpdateRiskConfigDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  maxConcurrentPositions?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  consecutiveFailureLimit?: number;
}

class ActivateKillSwitchDto {
  @IsString()
  reason: string;
}

@UseGuards(JwtAuthGuard)
@Controller('risk')
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

  @Get('config')
  getConfig() {
    return this.riskService.getConfig();
  }

  @Patch('config')
  updateConfig(@Body() dto: UpdateRiskConfigDto) {
    return this.riskService.updateConfig(dto);
  }

  @Get('status')
  async getStatus() {
    const config = await this.riskService.getConfig();
    const { allowed, reason } = await this.riskService.canOpenNewPosition();
    return {
      killSwitchActive: config.killSwitchActive,
      killSwitchReason: config.killSwitchReason,
      consecutiveFailureCount: config.consecutiveFailureCount,
      consecutiveFailureLimit: config.consecutiveFailureLimit,
      canOpenNewPosition: allowed,
      blockReason: reason,
    };
  }

  @Post('kill-switch/activate')
  activate(@Body() dto: ActivateKillSwitchDto) {
    return this.riskService.activateKillSwitch(dto.reason);
  }

  @Post('kill-switch/deactivate')
  deactivate() {
    return this.riskService.deactivateKillSwitch();
  }
}
