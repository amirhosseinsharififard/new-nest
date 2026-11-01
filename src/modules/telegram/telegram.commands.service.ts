
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Context, Telegraf } from 'telegraf';

import { RedisService } from '../../common/redis/redis.service';
import { SpreadCalculatorService } from '../market-data/spread-calculator.service';
import { RiskService } from '../risk/risk.service';

import {
  ArbitragePosition,
  ArbitragePositionStatus,
} from '../positions/entities/arbitrage-position.entity';
import { EXCHANGE_SLUGS } from './telegram.constants';

const ACTIVE_STATUSES = [
  ArbitragePositionStatus.OPEN,
  ArbitragePositionStatus.OPENING,
  ArbitragePositionStatus.HEDGING,
  ArbitragePositionStatus.NEEDS_MANUAL_REVIEW,
];



@Injectable()
export class TelegramCommandsService {
  private readonly logger = new Logger(TelegramCommandsService.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,

    @InjectRepository(ArbitragePosition)
    private readonly positionRepository: Repository<ArbitragePosition>,

    private readonly redisService: RedisService,
    private readonly spreadCalculator: SpreadCalculatorService,
    private readonly riskService: RiskService,

  ) {}

  registerCommands(bot: Telegraf): void {
    bot.start(async (ctx) => {
      await this.reply(
        ctx,
        [
          '🤖 Arbitrage Bot Monitor',
          '',
          'ربات مانیتورینگ سیستم آربیتراژ فعال است.',
          '',
          'برای مشاهده دستورات از /help استفاده کن.',
        ].join('\n'),
      );
    });

    bot.help(async (ctx) => {
      await this.reply(
        ctx,
        [
          '📚 Available Commands',
          '',
          '/start - شروع کار',
          '/help - راهنمای دستورات',
          '/status - وضعیت سیستم',
          '/scanner - وضعیت Scanner',
          '/positions - پوزیشن‌های فعال',
          '/risk - تنظیمات ریسک',
          '/test - تست کلی سیستم',
        ].join('\n'),
      );
    });

    bot.command('status', async (ctx) => {
      await this.reply(ctx, await this.getStatusText());
    });

    bot.command('scanner', async (ctx) => {
      await this.reply(ctx, await this.getScannerText());
    });

    bot.command('positions', async (ctx) => {
      await this.reply(ctx, await this.getPositionsText());
    });

    bot.command('risk', async (ctx) => {
      await this.reply(ctx, await this.getRiskText());
    });

    bot.command('test', async (ctx) => {
      await this.reply(ctx, await this.getTestText());
    });

   bot.command('testpanels', async (ctx) => {
    const chatId = -1003325556701;

    const topics = [
      { name: 'Scanner', id: 1681 },
      { name: 'Reports', id: 1682 },
      { name: 'Positions', id: 1683 },
      { name: 'Alerts', id: 1684 },
      { name: 'Status', id: 1685 },
    ];

    const results: string[] = [];

    await ctx.reply('🧪 Starting Telegram panel tests...');

    for (const { name, id } of topics) {
      try {
        const message = [
          '🧪 <b>Telegram Test Message</b>',
          '',
          `Panel: ${name}`,
          'Status: 🟢 Connected',
          `Time: ${new Date().toISOString()}`,
        ].join('\n');

        await ctx.telegram.sendMessage(chatId, message, {
          message_thread_id: id,
          parse_mode: 'HTML',
        });

        results.push(`🟢 ${name}: SUCCESS`);
      } catch (error) {
        results.push(`🔴 ${name}: FAILED`);

        this.logger.error(
          `Telegram test failed for ${name}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    const resultMessage = [
      '📋 <b>Telegram Panel Test Results</b>',
      '',
      ...results,
    ].join('\n');

    await ctx.reply(resultMessage, {
      parse_mode: 'HTML',
    });
  });

    this.logger.log('Telegram commands registered.');
  }

  private async reply(
    ctx: Context,
    message: string,
  ): Promise<void> {
    const currentMessage = ctx.message;

    const threadId =
      currentMessage && 'message_thread_id' in currentMessage
        ? currentMessage.message_thread_id
        : undefined;

    await ctx.reply(
      message,
      threadId ? { message_thread_id: threadId } : {},
    );
  }

  private async getStatusText(): Promise<string> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.redisService.ping(),
    ]);

    const healthy = database && redis;

    return [
      '🖥 System Status',
      '',
      `Overall: ${healthy ? '🟢 HEALTHY' : '🔴 DEGRADED'}`,
      `Database: ${database ? '🟢 UP' : '🔴 DOWN'}`,
      `Redis: ${redis ? '🟢 UP' : '🔴 DOWN'}`,
      `Time: ${new Date().toISOString()}`,
    ].join('\n');
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.dataSource.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error(
        'Database health check failed.',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private async getScannerText(): Promise<string> {
    try {
      const result =
        await this.spreadCalculator.getAllLiveMarketData(
          EXCHANGE_SLUGS,
        );

      const opportunities = result.symbols
        .flatMap((item) =>
          item.comparisons.map((comparison) => ({
            symbol: item.symbol,
            ...comparison,
          })),
        )
        .filter((item) => item.spreadPercent > 0)
        .sort((a, b) => b.spreadPercent - a.spreadPercent);

      const topOpportunities = opportunities.slice(0, 5);

      const lines = [
        '📊 Market Scanner',
        '',
        `Monitored symbols: ${result.count}`,
        `Positive spreads: ${opportunities.length}`,
        '',
      ];

      if (topOpportunities.length === 0) {
        lines.push('No positive spreads found.');
      } else {
        lines.push('Top opportunities:');

        for (const item of topOpportunities) {
          lines.push(
            `${item.symbol}: ${item.spreadPercent.toFixed(3)}%`,
            `Buy: ${item.buyExchange} | Sell: ${item.sellExchange}`,
            `Available: ${item.availableSize}`,
            '',
          );
        }
      }

      return lines.join('\n');
    } catch (error) {
      this.logger.error(
        'Scanner command failed.',
        error instanceof Error ? error.stack : String(error),
      );

      return '🔴 Failed to retrieve scanner data.';
    }
  }

  private async getPositionsText(): Promise<string> {
    try {
      const [positions, total] = await Promise.all([
        this.positionRepository.find({
          where: {
            status: In(ACTIVE_STATUSES),
          },
          order: {
            createdAt: 'DESC',
          },
          take: 10,
        }),
        this.positionRepository.count({
          where: {
            status: In(ACTIVE_STATUSES),
          },
        }),
      ]);

      const lines = [
        '📌 Active Positions',
        '',
        `Total active positions: ${total}`,
        '',
      ];

      if (!positions.length) {
        lines.push('No active positions.');
        return lines.join('\n');
      }

      for (const position of positions) {
        lines.push(
          `Symbol: ${position.symbol}`,
          `Status: ${position.status}`,
          `Expected spread: ${position.expectedNetSpreadPercent ?? 'N/A'}%`,
          `Created: ${position.createdAt.toISOString()}`,
          `ID: ${position.id}`,
          '',
        );
      }

      return lines.join('\n');
    } catch (error) {
      this.logger.error(
        'Positions command failed.',
        error instanceof Error ? error.stack : String(error),
      );

      return '🔴 Failed to retrieve positions.';
    }
  }

  private async getRiskText(): Promise<string> {
    try {
      const config = await this.riskService.getConfig();

      return [
        '🛡 Risk Configuration',
        '',
        `Max concurrent positions: ${config.maxConcurrentPositions}`,
        `Consecutive failure limit: ${config.consecutiveFailureLimit}`,
        `Consecutive failures: ${config.consecutiveFailureCount}`,
        `Kill Switch: ${config.killSwitchActive ? '🔴 ACTIVE' : '🟢 INACTIVE'}`,
        `Reason: ${config.killSwitchReason ?? 'None'}`,
        '',
        'Read-only monitoring.',
      ].join('\n');
    } catch (error) {
      this.logger.error(
        'Risk command failed.',
        error instanceof Error ? error.stack : String(error),
      );

      return '🔴 Failed to retrieve risk configuration.';
    }
  }

  private async getTestText(): Promise<string> {
    const checks: string[] = ['🧪 System Test', ''];

    const database = await this.checkDatabase();
    checks.push(`Database: ${database ? '🟢 UP' : '🔴 DOWN'}`);

    const redis = await this.redisService.ping();
    checks.push(`Redis: ${redis ? '🟢 UP' : '🔴 DOWN'}`);

    try {
      const scanner =
        await this.spreadCalculator.getAllLiveMarketData(
          EXCHANGE_SLUGS,
        );

      checks.push(`Scanner: 🟢 ${scanner.count} symbols`);
    } catch {
      checks.push('Scanner: 🔴 ERROR');
    }

    try {
      const positions = await this.positionRepository.count({
        where: {
          status: In(ACTIVE_STATUSES),
        },
      });

      checks.push(`Positions: 🟢 ${positions} active`);
    } catch {
      checks.push('Positions: 🔴 ERROR');
    }

    try {
      const risk = await this.riskService.getConfig();

      checks.push(
        `Risk Config: 🟢 ${risk.killSwitchActive ? 'Kill Switch ACTIVE' : 'Normal'}`,
      );
    } catch {
      checks.push('Risk Config: 🔴 ERROR');
    }

    return checks.join('\n');
  }

}
