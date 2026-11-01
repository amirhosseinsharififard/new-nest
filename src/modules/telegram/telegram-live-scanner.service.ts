import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

import { SpreadCalculatorService } from '../market-data/spread-calculator.service';
import { TelegramService } from './telegram.service';
import { TelegramTopic } from './interfaces/telegram.types';
import { EXCHANGE_SLUGS } from './telegram.constants';

const SCANNER_INTERVAL = 5000;
const MAX_MESSAGE_LENGTH = 3500;

@Injectable()
export class TelegramLiveScannerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(
    TelegramLiveScannerService.name,
  );

  private interval?: NodeJS.Timeout;
  private isUpdating = false;

  constructor(
    private readonly spreadCalculator: SpreadCalculatorService,
    private readonly telegramService: TelegramService,
  ) {}

  onApplicationBootstrap(): void {
    this.logger.log('Telegram Live Scanner initialized.');

    void this.updateScanner();

    this.interval = setInterval(() => {
      void this.updateScanner();
    }, SCANNER_INTERVAL);
  }

  onApplicationShutdown(): void {
    if (this.interval) {
      clearInterval(this.interval);
    }
  }

  private async updateScanner(): Promise<void> {
    if (this.isUpdating) return;

    this.isUpdating = true;

    try {
      const result =
        await this.spreadCalculator.getAllLiveMarketData(
          EXCHANGE_SLUGS,
        );

      const symbols = [...result.symbols].sort((a, b) =>
        a.symbol.localeCompare(b.symbol),
      );

      const positiveCount = symbols.reduce(
        (total, item) =>
          total +
          item.comparisons.filter(
            (comparison) => comparison.spreadPercent > 0,
          ).length,
        0,
      );

      const negativeCount = symbols.reduce(
        (total, item) =>
          total +
          item.comparisons.filter(
            (comparison) => comparison.spreadPercent < 0,
          ).length,
        0,
      );

      const symbolBlocks = symbols.map((item, index) =>
        this.formatSymbol(item, index + 1),
      );

      const messages = this.createPages(
        symbolBlocks,
        result.count,
        positiveCount,
        negativeCount,
      );

      await this.telegramService.updateTopicMessages(
        'scanner' as TelegramTopic,
        messages,
      );

      this.logger.log(
        `Scanner updated: ${result.count} symbols, ${messages.length} Telegram messages.`,
      );
    } catch (error) {
      this.logger.error(
        'Live Scanner update failed.',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.isUpdating = false;
    }
  }

  private formatSymbol(
    item: {
      symbol: string;
      exchanges: Record<string, any>;
      comparisons: any[];
    },
    index: number,
  ): string {
    const lines: string[] = [
      `#${String(index).padStart(3, '0')} ${item.symbol}`,
      '━━━━━━━━━━━━━━━━━━━━',
    ];

    const exchangeEntries = Object.entries(item.exchanges)
      .sort(([a], [b]) => a.localeCompare(b));

    lines.push('📍 EXCHANGE PRICES');

    for (const [exchange, ticker] of exchangeEntries) {
      lines.push(
        `${exchange.toUpperCase()}`,
        `Bid: ${this.formatNumber(Number(ticker.bidPrice))} | Size: ${this.formatNumber(Number(ticker.bidSize))}`,
        `Ask: ${this.formatNumber(Number(ticker.askPrice))} | Size: ${this.formatNumber(Number(ticker.askSize))}`,
      );
    }

    const comparisons = [...item.comparisons].sort(
      (a, b) =>
        a.buyExchange.localeCompare(b.buyExchange) ||
        a.sellExchange.localeCompare(b.sellExchange),
    );

    lines.push('', '🔄 ARBITRAGE DIRECTIONS');

    if (!comparisons.length) {
      lines.push('⚪ No valid cross-exchange comparison.');
    }

    for (const comparison of comparisons) {
      const spread = Number(comparison.spreadPercent);

      const indicator =
        spread > 0 ? '🟢' : spread < 0 ? '🔴' : '⚪';

      const sign = spread > 0 ? '+' : '';

      lines.push(
        '',
        `BUY: ${comparison.buyExchange.toUpperCase()} → SELL: ${comparison.sellExchange.toUpperCase()}`,
        `Buy Price: ${this.formatNumber(comparison.buyPrice)}`,
        `Buy Size: ${this.formatNumber(comparison.buyAskSize)}`,
        `Sell Price: ${this.formatNumber(comparison.sellPrice)}`,
        `Sell Size: ${this.formatNumber(comparison.sellBidSize)}`,
        `Available: ${this.formatNumber(comparison.availableSize)}`,
        `Spread: ${indicator} ${sign}${spread.toFixed(4)}%`,
      );
    }

    return lines.join('\n');
  }

  private createPages(
    blocks: string[],
    symbolCount: number,
    positiveCount: number,
    negativeCount: number,
  ): string[] {
    const bodyLimit = MAX_MESSAGE_LENGTH - 300;
    const chunks: string[] = [];

    let currentChunk = '';

    for (const block of blocks) {
      const parts =
        block.length > bodyLimit
          ? this.splitLongBlock(block, bodyLimit)
          : [block];

      for (const part of parts) {
        const nextChunk = currentChunk
          ? `${currentChunk}\n\n${part}`
          : part;

        if (
          nextChunk.length > bodyLimit &&
          currentChunk
        ) {
          chunks.push(currentChunk);
          currentChunk = part;
        } else {
          currentChunk = nextChunk;
        }
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    if (!chunks.length) {
      chunks.push('No live symbols available.');
    }

    const timestamp = new Date().toISOString()
      .replace('T', ' ')
      .replace('Z', ' UTC');

    return chunks.map((chunk, index) =>
      [
        '📊 LIVE ARBITRAGE SCANNER',
        `📄 Page ${index + 1}/${chunks.length}`,
        '━━━━━━━━━━━━━━━━━━━━',
        `🕒 ${timestamp}`,
        `📌 Monitored symbols: ${symbolCount}`,
        `🟢 Positive directions: ${positiveCount}`,
        `🔴 Negative directions: ${negativeCount}`,
        '',
        chunk,
      ].join('\n'),
    );
  }

  private splitLongBlock(
    block: string,
    limit: number,
  ): string[] {
    const lines = block.split('\n');
    const chunks: string[] = [];

    let current = '';

    for (const line of lines) {
      const next = current ? `${current}\n${line}` : line;

      if (next.length > limit && current) {
        chunks.push(current);
        current = line;
      } else {
        current = next;
      }
    }

    if (current) chunks.push(current);

    return chunks;
  }

  private formatNumber(value: number): string {
    if (!Number.isFinite(value)) return 'N/A';

    return new Intl.NumberFormat('en-US', {
      maximumSignificantDigits: 10,
    }).format(value);
  }
}
