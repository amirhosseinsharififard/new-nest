
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { TelegramCommandsService } from './telegram.commands.service';
import { createTelegramAccessMiddleware } from './telegram.middleware';
import { getTelegramConfig } from './telegram.config';
import { TelegramConfig, TelegramTopic } from './telegram.types';

@Injectable()
export class TelegramService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramService.name);

  private bot?: Telegraf;
  private config?: TelegramConfig;

  constructor(
    private readonly commandsService: TelegramCommandsService,
  ) {}

  onModuleInit(): void {
    this.config = getTelegramConfig();

    if (!this.config.enabled) {
      this.logger.log('Telegram bot is disabled.');
      return;
    }

    this.logger.debug(
  JSON.stringify({
    enabled: this.config.enabled,
    allowedUserIds: this.config.allowedUserIds,
    allowedChatIds: this.config.allowedChatIds,
  }),
);
    if (
      !this.config.allowedUserIds.length ||
      !this.config.allowedChatIds.length
    ) {
      throw new Error(
        'Telegram requires at least one allowed user ID and chat ID.',
      );
    }

    this.bot = new Telegraf(this.config.botToken);

    // Security middleware must be registered before commands.
    this.bot.use(
      createTelegramAccessMiddleware(
        this.config.allowedUserIds,
        this.config.allowedChatIds,
      ),
    );

    this.commandsService.registerCommands(this.bot);

    void this.bot.launch().then(
      () => this.logger.log('Telegram bot started successfully.'),
    ).catch((error: unknown) => {
      this.logger.error(
        'Failed to start Telegram bot.',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  async sendToTopic(
    topic: TelegramTopic,
    message: string,
    chatId?: number,
  ): Promise<void> {
    if (!this.bot || !this.config?.enabled) {
      return;
    }

    const targetChatId = chatId ?? this.config.allowedChatIds[0];
    const messageThreadId = this.config.topics[topic];

    if (!messageThreadId) {
      this.logger.warn(`Topic ID is not configured: ${topic}`);
      return;
    }

    try {
      await this.bot.telegram.sendMessage(
        targetChatId,
        message,
        {
          message_thread_id: messageThreadId,
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to send Telegram message to ${topic}.`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.bot) return;

    this.bot.stop('Application shutdown');
    this.logger.log('Telegram bot stopped.');
  }
}
