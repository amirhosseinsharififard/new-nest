import { Controller, Get, Module } from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RedisModule } from '../../common/redis/redis.module';
import { RedisService } from '../../common/redis/redis.service';

interface HealthStatus {
  status: 'ok' | 'degraded';
  database: 'up' | 'down';
  redis: 'up' | 'down';
  timestamp: string;
}

@Controller('health')
class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const [dbOk, redisOk] = await Promise.all([
      this.checkDatabase(),
      this.redisService.ping(),
    ]);

    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      database: dbOk ? 'up' : 'down',
      redis: redisOk ? 'up' : 'down',
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

@Module({
  imports: [RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
