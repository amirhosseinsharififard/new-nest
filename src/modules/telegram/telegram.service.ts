import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Telegraf } from 'telegraf';

import { RedisService } from '../../common/redis/redis.service';
import { TelegramCommandsService } from './telegram.commands.service';
import { createTelegramAccessMiddleware } from './telegram.middleware';
import { getTelegramConfig } from './telegram.config';
import {
  TelegramConfig,
  TelegramTopic,
} from './interfaces/telegram.types';

const MESSAGE_IDS_TTL = 30 * 24 * 60 * 60;

@Injectable()
export class TelegramService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TelegramService.name);

  private bot?: Telegraf;
  private config?: TelegramConfig;

  private readonly topicMessages = new Map<string, number[]>();

  constructor(
    private readonly commandsService: TelegramCommandsService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit(): void {
    this.config = getTelegramConfig();

    if (!this.config.enabled) {
      this.logger.log('Telegram bot is disabled.');
      return;
    }

    if (
      !this.config.allowedUserIds.length ||
      !this.config.allowedChatIds.length
    ) {
      throw new Error(
        'Telegram requires at least one allowed user ID and chat ID.',
      );
    }

    this.bot = new Telegraf(this.config.botToken);

    this.bot.use(
      createTelegramAccessMiddleware(
        this.config.allowedUserIds,
        this.config.allowedChatIds,
      ),
    );

    this.commandsService.registerCommands(this.bot);

    void this.bot.launch()
      .then(() => {
        this.logger.log('Telegram bot started successfully.');
      })
      .catch((error: unknown) => {
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
    if (!this.bot || !this.config?.enabled) return;

    const targetChatId =
      chatId ?? this.config.allowedChatIds[0];

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
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async updateTopicMessage(
    topic: TelegramTopic,
    message: string,
    chatId?: number,
  ): Promise<void> {
    await this.updateTopicMessages(topic, [message], chatId);
  }

  async updateTopicMessages(
    topic: TelegramTopic,
    messages: string[],
    chatId?: number,
  ): Promise<void> {
    if (!this.bot || !this.config?.enabled) return;

    const targetChatId =
      chatId ?? this.config.allowedChatIds[0];

    const threadId = this.config.topics[topic];

    if (!threadId) {
      this.logger.warn(`Topic ID is not configured: ${topic}`);
      return;
    }

    const storageKey =
      `telegram:topic-messages:${targetChatId}:${topic}`;

    const messageIds = await this.getStoredMessageIds(
      storageKey,
    );

    const updatedMessageIds: number[] = [];

    for (let index = 0; index < messages.length; index++) {
      const message = messages[index];
      const previousMessageId = messageIds[index];

      if (previousMessageId) {
        try {
          await this.bot.telegram.editMessageText(
            targetChatId,
            previousMessageId,
            undefined,
            message,
          );

          updatedMessageIds.push(previousMessageId);
          continue;
        } catch (error) {
          const description = this.getErrorMessage(error);

          if (description.includes('message is not modified')) {
            updatedMessageIds.push(previousMessageId);
            continue;
          }

          const canRecreate =
            description.includes('message to edit not found') ||
            description.includes("message can't be edited") ||
            description.includes('message_id_invalid');

          if (!canRecreate) {
            this.logger.error(
              `Failed to edit ${topic} message ${previousMessageId}.`,
              description,
            );

            // شناسه قبلی را حفظ می‌کنیم تا پیام تکراری ساخته نشود.
            updatedMessageIds.push(previousMessageId);
            continue;
          }

          this.logger.warn(
            `Telegram message ${previousMessageId} is unavailable. Creating a replacement.`,
          );
        }
      }

      try {
        const sent = await this.bot.telegram.sendMessage(
          targetChatId,
          message,
          {
            message_thread_id: threadId,
          },
        );

        updatedMessageIds.push(sent.message_id);

        this.logger.log(
          `Telegram ${topic} message created: ${sent.message_id}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to create ${topic} message #${index + 1}.`,
          this.getErrorMessage(error),
        );

        updatedMessageIds.push(previousMessageId ?? 0);
      }
    }

    // پیام‌های اضافی را در صورت کاهش تعداد صفحات حذف می‌کنیم.
    for (
      let index = messages.length;
      index < messageIds.length;
      index++
    ) {
      const oldMessageId = messageIds[index];

      if (!oldMessageId) continue;

      try {
        await this.bot.telegram.deleteMessage(
          targetChatId,
          oldMessageId,
        );
      } catch (error) {
        this.logger.warn(
          `Could not delete old ${topic} message ${oldMessageId}: ${this.getErrorMessage(error)}`,
        );
      }
    }

    this.topicMessages.set(
      storageKey,
      updatedMessageIds,
    );

    try {
      await this.redisService.set(
        storageKey,
        JSON.stringify(updatedMessageIds),
        MESSAGE_IDS_TTL,
      );
    } catch (error) {
      this.logger.error(
        'Failed to persist Telegram message IDs.',
        this.getErrorMessage(error),
      );
    }
  }

  private async getStoredMessageIds(
    key: string,
  ): Promise<number[]> {
    const cached = this.topicMessages.get(key);

    if (cached) return cached;

    try {
      const raw = await this.redisService.get(key);

      if (!raw) return [];

      const parsed: unknown = JSON.parse(raw);

      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          (id) => Number.isSafeInteger(id) && id >= 0,
        )
      ) {
        return [];
      }

      const ids = parsed as number[];

      this.topicMessages.set(key, ids);

      return ids;
    } catch (error) {
      this.logger.error(
        'Failed to load Telegram message IDs.',
        this.getErrorMessage(error),
      );

      return [];
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.bot) return;

    this.bot.stop('Application shutdown');

    this.logger.log('Telegram bot stopped.');
  }
}
