
import { NktkasHyperliquidExchangeClient } from './hyperliquid.exchange-client';

const mockOrder = jest.fn();
const mockExchangeClient = { order: mockOrder };
const mockPrivateKeyToAccount = jest.fn();


jest.mock(
  '@nktkas/hyperliquid',
  () => ({
    ExchangeClient: jest.fn().mockImplementation(() => mockExchangeClient),
    HttpTransport: jest.fn().mockImplementation(() => ({})),
  }),
  { virtual: true },
);

jest.mock(
  'viem/accounts',
  () => ({
    privateKeyToAccount: (...args: unknown[]) =>
      mockPrivateKeyToAccount(...args),
  }),
  { virtual: true },
);
describe('NktkasHyperliquidExchangeClient', () => {
  let client: NktkasHyperliquidExchangeClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new NktkasHyperliquidExchangeClient(
      '0x1234567890abcdef',
    );

    mockPrivateKeyToAccount.mockReturnValue({
      address: '0xwallet',
    });
  });

  describe('placeMarketOrder', () => {
    it('should create the SDK client and place a market order', async () => {
      mockOrder.mockResolvedValue({
        response: {
          data: {
            statuses: [
              {
                filled: {
                  oid: 12345,
                  totalSz: '2.5',
                  avgPx: '100.25',
                },
              },
            ],
          },
        },
      });

      const result = await client.placeMarketOrder({
        asset: 'BTC',
        isBuy: true,
        size: 2.5,
        reduceOnly: false,
      });

      expect(mockPrivateKeyToAccount).toHaveBeenCalledWith(
        '0x1234567890abcdef',
      );

      expect(mockOrder).toHaveBeenCalledWith({
        name: 'BTC',
        is_buy: true,
        sz: 2.5,
        order_type: { market: {} },
        reduce_only: false,
      });

      expect(result).toEqual({
        orderId: 12345,
        status: 'filled',
        filledSize: 2.5,
        avgPrice: 100.25,
      });
    });

    it('should reuse the SDK client for subsequent orders', async () => {
      mockOrder.mockResolvedValue({
        response: {
          data: {
            statuses: [{ resting: { oid: 100 } }],
          },
        },
      });

      await client.placeMarketOrder({
        asset: 'BTC',
        isBuy: true,
        size: 1,
        reduceOnly: false,
      });

      await client.placeMarketOrder({
        asset: 'ETH',
        isBuy: false,
        size: 2,
        reduceOnly: true,
      });

      expect(mockPrivateKeyToAccount).toHaveBeenCalledTimes(1);
    });

    it('should map resting orders correctly', async () => {
      mockOrder.mockResolvedValue({
        response: {
          data: {
            statuses: [{ resting: { oid: 456 } }],
          },
        },
      });

      const result = await client.placeMarketOrder({
        asset: 'ETH',
        isBuy: false,
        size: 1,
        reduceOnly: false,
      });

      expect(result).toEqual({
        orderId: 456,
        status: 'resting',
        filledSize: 0,
        avgPrice: null,
      });
    });

    it('should return unknown status when the response has no order status', async () => {
      mockOrder.mockResolvedValue({
        response: {
          data: {
            statuses: [],
          },
        },
      });

      const result = await client.placeMarketOrder({
        asset: 'BTC',
        isBuy: true,
        size: 1,
        reduceOnly: false,
      });

      expect(result).toEqual({
        orderId: 'unknown',
        status: 'unknown',
        filledSize: 0,
        avgPrice: null,
      });
    });

    it('should return unknown status when the response is empty', async () => {
      mockOrder.mockResolvedValue({});

      const result = await client.placeMarketOrder({
        asset: 'BTC',
        isBuy: true,
        size: 1,
        reduceOnly: false,
      });

      expect(result.status).toBe('unknown');
      expect(result.orderId).toBe('unknown');
    });

    it('should parse filled size and average price from the response', async () => {
      mockOrder.mockResolvedValue({
        response: {
          data: {
            statuses: [
              {
                filled: {
                  oid: '789',
                  totalSz: '0.125',
                  avgPx: '65432.10',
                },
              },
            ],
          },
        },
      });

      const result = await client.placeMarketOrder({
        asset: 'BTC',
        isBuy: true,
        size: 0.125,
        reduceOnly: false,
      });

      expect(result.filledSize).toBe(0.125);
      expect(result.avgPrice).toBe(65432.1);
    });

    it('should return null average price when avgPx is missing', async () => {
      mockOrder.mockResolvedValue({
        response: {
          data: {
            statuses: [
              {
                filled: {
                  oid: 100,
                  totalSz: '1',
                },
              },
            ],
          },
        },
      });

      const result = await client.placeMarketOrder({
        asset: 'BTC',
        isBuy: true,
        size: 1,
        reduceOnly: false,
      });

      expect(result.avgPrice).toBeNull();
    });

    it('should propagate SDK order errors', async () => {
      mockOrder.mockRejectedValue(new Error('SDK order failed'));

      await expect(
        client.placeMarketOrder({
          asset: 'BTC',
          isBuy: true,
          size: 1,
          reduceOnly: false,
        }),
      ).rejects.toThrow('SDK order failed');
    });
  });
});
