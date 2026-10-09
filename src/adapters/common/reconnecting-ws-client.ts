import { Logger } from '@nestjs/common';
import WebSocket = require('ws');

interface ReconnectingWsOptions {
  url: string;
  exchangeId: string;
  onMessage: (data: WebSocket.RawData) => void;
  onOpen?: () => void;
  /** هر چند ثانیه یک‌بار Ping بفرستد تا Connection زنده بماند (بعضی صرافی‌ها لازم دارند) */
  pingIntervalMs?: number;
  maxBackoffMs?: number;
}

/**
 * Wrapper مشترک روی WebSocket برای همه Adapterها.
 * منطق Reconnect با Exponential Backoff اینجا یک‌بار پیاده شده،
 * تا هر Adapter مجبور نباشه دوباره پیاده‌سازیش کنه.
 *
 * نکته مهم: تا وقتی isHealthy() === false باشه، Core Engine
 * (طبق قرارداد IExchangeAdapter) نباید تصمیم معاملاتی بگیره.
 */
export class ReconnectingWsClient {
  private readonly logger: Logger;
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private isManuallyClosed = false;
  private pingInterval: NodeJS.Timeout | null = null;
  private healthy = false;

  constructor(private readonly options: ReconnectingWsOptions) {
    this.logger = new Logger(`WS:${options.exchangeId}`);
  }

  connect(): Promise<void> {
  console.log(
    '🔥 CONNECT CALLED:',
    this.options.exchangeId,
    this.options.url,
  );

  this.isManuallyClosed = false;

  return new Promise((resolve, reject) => {
    console.log('🔥 BEFORE NEW WEBSOCKET');

    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;

      console.error(
        '🔥🔥 WEBSOCKET TIMEOUT:',
        this.options.url,
      );

      this.ws?.terminate();

      reject(
        new Error(
          `WebSocket connection timeout: ${this.options.url}`,
        ),
      );
    }, 10_000);

    try {
      this.ws = new WebSocket(this.options.url);

      console.log('🔥 AFTER NEW WEBSOCKET');

      const onOpenOnce = () => {
        if (settled) return;

        settled = true;
        clearTimeout(timeout);

        this.healthy = true;
        this.reconnectAttempts = 0;

        console.log(
          '🔥🔥🔥 WEBSOCKET OPEN:',
          this.options.url,
        );

        this.logger.log('اتصال WebSocket برقرار شد');

        this.startPing();
        this.options.onOpen?.();

        resolve();
      };

      this.ws.once('open', onOpenOnce);

      this.ws.on('message', (data) => {
        console.log('🔥 WEBSOCKET MESSAGE RECEIVED');

        this.options.onMessage(data);
      });

      this.ws.on('error', (err) => {
        console.error(
          '🔥🔥 WEBSOCKET ERROR:',
          err.message,
        );

        this.healthy = false;

        this.logger.error(
          `خطای WebSocket: ${err.message}`,
        );

        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.ws.on('unexpected-response', (_request, response) => {
        console.error(
          '🔥🔥 UNEXPECTED RESPONSE:',
          response.statusCode,
          response.statusMessage,
        );
      });

      this.ws.on('close', (code, reason) => {
        console.log(
          '🔥 WEBSOCKET CLOSE:',
          code,
          reason.toString(),
        );

        this.healthy = false;
        this.stopPing();

        if (!this.isManuallyClosed) {
          this.logger.warn(
            'اتصال WebSocket قطع شد، تلاش برای اتصال مجدد...',
          );

          this.scheduleReconnect();
        }
      });
    } catch (err) {
      clearTimeout(timeout);

      console.error(
        '🔥🔥 WEBSOCKET CONSTRUCTOR ERROR:',
        err,
      );

      reject(err);
    }
  });
}

  private scheduleReconnect(): void {
    this.reconnectAttempts += 1;
    const maxBackoff = this.options.maxBackoffMs ?? 30_000;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, maxBackoff);

    this.logger.log(`تلاش مجدد اتصال در ${delay}ms (تلاش شماره ${this.reconnectAttempts})`);
    setTimeout(() => {
      if (!this.isManuallyClosed) {
        this.connect().catch(() => {
          // خطا already توسط 'error' handler لاگ شده، اینجا فقط جلوگیری از unhandled rejection
        });
      }
    }, delay);
  }

  private startPing(): void {
    if (!this.options.pingIntervalMs) return;
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, this.options.pingIntervalMs);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(data: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.logger.warn('تلاش برای ارسال پیام روی WebSocket غیرفعال — پیام نادیده گرفته شد');
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  disconnect(): void {
    this.isManuallyClosed = true;
    this.stopPing();
    this.ws?.close();
    this.healthy = false;
  }
}
