
import { Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExchangeError } from '../../core/exchange/exchange-adapter.interface';
import { SlidingWindowRateLimiter } from '../common/rate-limiter';
import { fromGateIoSymbol } from './gateio.mapper';

export interface GateIoContract {
  name: string;
  type: string;
  quanto_multiplier: string;
  order_size_min: number;
  order_size_max: number;
  status: string;
  in_delisting: boolean;
}

export class GateIoRestClient {
  private readonly logger = new Logger(GateIoRestClient.name);
  private readonly http: AxiosInstance;
  private readonly rateLimiter = new SlidingWindowRateLimiter(
    1000,
    60_000,
  );

  private contracts = new Map<string, GateIoContract>();

  constructor(
    baseUrl = 'https://api.gateio.ws/api/v4',
  ) {
    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 10_000,
    });
  }

  private async publicRequest<T>(path: string): Promise<T> {
    await this.rateLimiter.acquire();

    try {
      const response = await this.http.get<T>(path);
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (
          err.code === 'ECONNABORTED' ||
          err.code === 'ETIMEDOUT'
        ) {
          throw new ExchangeError(
            'gateio',
            'NETWORK_TIMEOUT',
            'Gate.io request timed out',
            err,
          );
        }

        if (err.response?.status === 429) {
          throw new ExchangeError(
            'gateio',
            'RATE_LIMIT',
            'Gate.io rate limit exceeded',
            err,
          );
        }

        throw new ExchangeError(
          'gateio',
          'UNKNOWN',
          err.response?.data?.message || err.message,
          err,
        );
      }

      throw new ExchangeError(
        'gateio',
        'UNKNOWN',
        'Unknown Gate.io error',
        err,
      );
    }
  }

  async getContracts(): Promise<GateIoContract[]> {
    const response = await this.publicRequest<GateIoContract[]>(
      '/futures/usdt/contracts',
    );

    const activeContracts = response.filter(
      (contract) =>
        contract.status === 'trading' &&
        !contract.in_delisting,
    );

    this.contracts.clear();

    for (const contract of activeContracts) {
      this.contracts.set(contract.name, contract);
    }

    this.logger.log(
      `Loaded ${activeContracts.length} Gate.io USDT contracts`,
    );

    return activeContracts;
  }

  async getMarketSymbols(): Promise<string[]> {
    const contracts = await this.getContracts();

    return [
      ...new Set(
        contracts.map((contract) =>
          fromGateIoSymbol(contract.name),
        ),
      ),
    ];
  }

  getContractMultiplier(symbol: string): number {
    const gateSymbol = symbol.replace('-', '_').toUpperCase();
    const contract = this.contracts.get(gateSymbol);

    if (!contract) {
      throw new Error(
        `Gate.io contract not found: ${gateSymbol}`,
      );
    }

    const multiplier = Number(contract.quanto_multiplier);

    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error(
        `Invalid Gate.io contract multiplier: ${gateSymbol}`,
      );
    }

    return multiplier;
  }

  getTokenSize(symbol: string, contractSize: number): number {
    return contractSize * this.getContractMultiplier(symbol);
  }
}
