
import { Context, MiddlewareFn } from 'telegraf';

export function createTelegramAccessMiddleware(
  allowedUserIds: number[],
  allowedChatIds: number[],
): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;

    const authorizedUser =
      userId !== undefined && allowedUserIds.includes(userId);

    const authorizedChat =
      chatId !== undefined && allowedChatIds.includes(chatId);

    if (!authorizedUser || !authorizedChat) {
      return;
    }

    await next();
  };
}
