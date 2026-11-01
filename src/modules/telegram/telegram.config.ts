
import { TelegramConfig } from './telegram.types';

function parseIds(value?: string): number[] {
  if (!value?.trim()) return [];

  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isSafeInteger(id) && id !== 0);
}

function parseTopic(value?: string): number {
  if (!value?.trim()) return 0;

  const topicId = Number(value);

  return Number.isSafeInteger(topicId) && topicId > 0
    ? topicId
    : 0;
}

export function getTelegramConfig(): TelegramConfig {
  const enabled = process.env.TELEGRAM_ENABLED === 'true';
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? '';

  if (enabled && !botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  return {
    enabled,
    botToken,

    allowedUserIds: parseIds(
      process.env.TELEGRAM_ALLOWED_USER_IDS,
    ),

    allowedChatIds: parseIds(
      process.env.TELEGRAM_GROUP_CHAT_ID,
    ),

    topics: {
      scanner: parseTopic(process.env.TELEGRAM_TOPIC_SCANNER),
      reports: parseTopic(process.env.TELEGRAM_TOPIC_REPORTS),
      positions: parseTopic(process.env.TELEGRAM_TOPIC_POSITIONS),
      alerts: parseTopic(process.env.TELEGRAM_TOPIC_ALERTS),
      status: parseTopic(process.env.TELEGRAM_TOPIC_STATUS),
    },
  };
}
