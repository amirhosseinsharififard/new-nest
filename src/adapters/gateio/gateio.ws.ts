
import { Logger } from '@nestjs/common';
import WebSocket from 'ws';

import { ReconnectingWsClient } from '../common/reconnecting-ws-client';
import {
  fromGateIoSymbol,
  parseGateIoNumber,
  toGateIoSymbol,
} from './gateio.mapper';

import { TickerData } from 'src/core/exchange/exchange.types';

const GATE_IO_WS_URL = 'wss://fx-ws.gateio.ws/v4/ws/usdt';
const CHANNEL = 'futures.book_ticker';

interface GateIoBookTicker {
  t: number;
  u: number;
  s: string;
  b: string;
  B: string | number;
  a: string;
  A: string | number;
}

interface GateIoWsMessage {
  channel: string;
  event: string;
  result?: GateIoBookTicker;
  error?: {
    code: number;
    message: string;
  };
}

export class GateIoWsManager {
  private readonly logger = new Logger(GateIoWsManager.name);

  private readonly wsClient: ReconnectingWsClient;

  private readonly subscribedSymbols = new Set<string>();

  private tickerCallback?: (data: TickerData) => void;

  constructor(
    private readonly getContractMultiplier: (symbol: string) => number,
  ) {
    this.wsClient = new ReconnectingWsClient({
      url: GATE_IO_WS_URL,
      exchangeId: 'gateio-ticker',
      onOpen: () => this.handleOpen(),
      onMessage: (raw) => this.handleMessage(raw),
    });
  }

  async connect(): Promise<void> {
    await this.wsClient.connect();
  }

  disconnect(): void {
    this.wsClient.disconnect();
    this.subscribedSymbols.clear();
  }

  isHealthy(): boolean {
    return this.wsClient.isHealthy();
  }

  subscribeTicker(
    symbol: string,
    callback: (data: TickerData) => void,
  ): void {
    this.subscribeTickers([symbol], callback);
  }

  subscribeTickers(
    symbols: string[],
    callback: (data: TickerData) => void,
  ): void {
    this.tickerCallback = callback;

    const newSymbols = symbols
      .map(toGateIoSymbol)
      .filter((symbol) => !this.subscribedSymbols.has(symbol));

    if (!newSymbols.length) return;

    newSymbols.forEach((symbol) => {
      this.subscribedSymbols.add(symbol);
    });

    if (this.isHealthy()) {
      this.sendSubscribe(newSymbols);
    }
  }

  unsubscribeTicker(symbol: string): void {
    this.unsubscribeTickers([symbol]);
  }

  unsubscribeTickers(symbols: string[]): void {
    const existingSymbols = symbols
      .map(toGateIoSymbol)
      .filter((symbol) => this.subscribedSymbols.has(symbol));

    if (!existingSymbols.length) return;

    existingSymbols.forEach((symbol) => {
      this.subscribedSymbols.delete(symbol);
    });

    if (this.isHealthy()) {
      this.sendUnsubscribe(existingSymbols);
    }
  }

  private handleOpen(): void {
    this.logger.log('Gate.io WebSocket connected');

    this.sendSubscribe([...this.subscribedSymbols]);
  }

  private sendSubscribe(symbols: string[]): void {
    if (!symbols.length) return;

    this.wsClient.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: CHANNEL,
        event: 'subscribe',
        payload: symbols,
      }),
    );
  }

  private sendUnsubscribe(symbols: string[]): void {
    if (!symbols.length) return;

    this.wsClient.send(
      JSON.stringify({
        time: Math.floor(Date.now() / 1000),
        channel: CHANNEL,
        event: 'unsubscribe',
        payload: symbols,
      }),
    );
  }

  private handleMessage(raw: WebSocket.RawData): void {
    try {
      const message = JSON.parse(
        raw.toString(),
      ) as GateIoWsMessage;

      if (message.error) {
        this.logger.error(
          `Gate.io WS error: ${message.error.message}`,
        );
        return;
      }

      if (
        message.channel !== CHANNEL ||
        message.event !== 'update' ||
        !message.result
      ) {
        return;
      }

      const ticker = message.result;

      const bidPrice = parseGateIoNumber(ticker.b);
      const askPrice = parseGateIoNumber(ticker.a);

      if (bidPrice <= 0 || askPrice <= 0) return;

      const symbol = fromGateIoSymbol(ticker.s);
      const multiplier = this.getContractMultiplier(symbol);

      const data: TickerData = {
        exchangeId: 'gateio',
        symbol,
        bidPrice,
        bidSize: parseGateIoNumber(ticker.B) * multiplier,
        askPrice,
        askSize: parseGateIoNumber(ticker.A) * multiplier,
        timestamp: ticker.t,
      };

      this.tickerCallback?.(data);
    } catch (error) {
      this.logger.error(
        `Failed to parse Gate.io message: ${String(error)}`,
      );
    }
  }
}
