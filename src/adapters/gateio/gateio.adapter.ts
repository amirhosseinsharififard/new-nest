
import { Logger } from '@nestjs/common';

import {
  Balance,
  ClosePositionParams,
  OpenPositionParams,
  OrderResult,
  PositionStatus,
  PositionUpdate,
  TickerData,
} from 'src/core/exchange/exchange.types';

import { ExchangeAccountConfig } from 'src/core/exchange/exchange-registry';

import { GateIoRestClient } from './gateio.rest';
import { GateIoWsManager } from './gateio.ws';
import { IExchangeAdapter } from 'src/core/exchange/exchange-adapter.interface';

export class GateIoAdapter implements IExchangeAdapter {
  readonly exchangeId = 'gateio';

  private readonly logger = new Logger(GateIoAdapter.name);

  private readonly rest: GateIoRestClient;
  private readonly wsManager: GateIoWsManager;

  constructor(config: ExchangeAccountConfig) {
  this.rest = new GateIoRestClient(config.restBaseUrl);

  this.wsManager = new GateIoWsManager(
    (symbol) => this.rest.getContractMultiplier(symbol),
  );

  this.logger.log(
    `Gate.io adapter initialized for account ${config.accountId}`,
  );
}

  async connectWebSocket(): Promise<void> {
    await this.wsManager.connect();
  }

  async disconnectWebSocket(): Promise<void> {
    this.wsManager.disconnect();
  }

  isWebSocketHealthy(): boolean {
    return this.wsManager.isHealthy();
  }

  subscribeTicker(
    symbol: string,
    cb: (data: TickerData) => void,
  ): void {
    this.wsManager.subscribeTicker(symbol, cb);
  }

  unsubscribeTicker(symbol: string): void {
    this.wsManager.unsubscribeTicker(symbol);
  }

  subscribeTickers(
    symbols: string[],
    cb: (data: TickerData) => void,
  ): void {
    this.wsManager.subscribeTickers(symbols, cb);
  }

  unsubscribeTickers(symbols: string[]): void {
    this.wsManager.unsubscribeTickers(symbols);
  }

  async getMarketSymbols(): Promise<string[]> {
    return this.rest.getMarketSymbols();
  }

  subscribePositionUpdates(
    _accountId: string,
    _cb: (data: PositionUpdate) => void,
  ): void {
    this.logger.warn(
      'Gate.io private position updates are not implemented yet',
    );
  }

  async openPosition(
    _params: OpenPositionParams,
  ): Promise<OrderResult> {
    throw new Error('Gate.io trading is not implemented yet');
  }

  async closePosition(
    _params: ClosePositionParams,
  ): Promise<OrderResult> {
    throw new Error('Gate.io trading is not implemented yet');
  }

  async getPositionStatus(
    _accountId: string,
    _symbol: string,
  ): Promise<PositionStatus> {
    throw new Error('Gate.io position status is not implemented yet');
  }

  async getBalance(
    _accountId: string,
  ): Promise<Balance[]> {
    throw new Error('Gate.io balance retrieval is not implemented yet');
  }
}
