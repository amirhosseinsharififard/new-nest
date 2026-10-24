
const readline = require('readline');

const BASE_URL = 'http://localhost:3000';
const API_PATH = '/market/live/all';
const REFRESH_MS = 1000;

const USERNAME = process.env.API_USERNAME || 'aliiii';
const PASSWORD = process.env.API_PASSWORD || 'MyPass123456';

const EXCHANGES = ['binance', 'bybit', 'okx', 'hyperliquid'];

let accessToken = null;
let running = true;
let isRefreshing = false;
let latestSymbols = [];
let lastError = null;

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {}),
      ...options.headers,
    },
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (!response.ok) {
    const error = new Error(
      data.message || `HTTP ${response.status}`,
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

async function login() {
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
    }),
  });

  accessToken =
    result.accessToken ||
    result.access_token ||
    result.data?.accessToken ||
    result.data?.access_token;

  if (!accessToken) {
    throw new Error('Access token not found in login response.');
  }
}

function normalizeExchangeName(name) {
  return String(name || '').toLowerCase();
}

function normalizeSymbol(symbol) {
  return String(symbol || '').replace(/[\/_-]/g, '').toUpperCase();
}

function getTicker(symbolData, exchange) {
  const exchanges = symbolData?.exchanges || {};
  const key = Object.keys(exchanges).find(
    (name) => normalizeExchangeName(name) === exchange,
  );

  return key ? exchanges[key] : null;
}

function getNumber(ticker, fields) {
  for (const field of fields) {
    const value = Number(ticker?.[field]);

    if (
      ticker?.[field] !== null &&
      ticker?.[field] !== undefined &&
      ticker?.[field] !== '' &&
      Number.isFinite(value)
    ) {
      return value;
    }
  }

  return NaN;
}

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 'N/A';

  return number.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'N/A';
  return `${value >= 0 ? '+' : ''}${value.toFixed(4)}%`;
}

function calculateSpreads(symbolData) {
  const results = [];

  for (const buyExchange of EXCHANGES) {
    for (const sellExchange of EXCHANGES) {
      if (buyExchange === sellExchange) continue;

      const buyTicker = getTicker(symbolData, buyExchange);
      const sellTicker = getTicker(symbolData, sellExchange);

      if (!buyTicker || !sellTicker) continue;

      const buyAsk = getNumber(buyTicker, ['askPrice', 'ask']);
      const sellBid = getNumber(sellTicker, ['bidPrice', 'bid']);

      if (
        !Number.isFinite(buyAsk) ||
        !Number.isFinite(sellBid) ||
        buyAsk <= 0 ||
        sellBid <= 0
      ) {
        continue;
      }

      const difference = sellBid - buyAsk;

      results.push({
        symbol: symbolData.symbol,
        buyExchange,
        sellExchange,
        buyAsk,
        sellBid,
        difference,
        percent: (difference / buyAsk) * 100,
      });
    }
  }

  return results.sort((a, b) => b.percent - a.percent);
}

function calculateAllSpreads(symbols) {
  const results = [];

  for (const symbolData of symbols) {
    results.push(...calculateSpreads(symbolData));
  }

  return results.sort((a, b) => b.percent - a.percent);
}

function render(data) {
  const symbols = Array.isArray(data?.symbols) ? data.symbols : [];
  latestSymbols = symbols;

  const allSpreads = calculateAllSpreads(symbols);
  const positiveSpreads = allSpreads.filter((item) => item.difference > 0);

  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  console.log('='.repeat(135));
  console.log('                 CRYPTO ARBITRAGE - ALL SYMBOLS LIVE DASHBOARD');
  console.log('='.repeat(135));
  console.log(
    `Time: ${new Date().toLocaleTimeString()} | Refresh: ${REFRESH_MS}ms | Symbols: ${symbols.length} | Exchanges: ${EXCHANGES.length}`,
  );

  if (lastError) {
    console.log(`Last API error: ${lastError}`);
  }

  console.log('\nBEST LIVE SPREADS — ALL SYMBOLS');
  console.log('-'.repeat(135));

  console.log(
    'SYMBOL'.padEnd(19) +
    'BUY FROM'.padEnd(17) +
    'SELL TO'.padEnd(17) +
    'BUY ASK'.padStart(19) +
    'SELL BID'.padStart(19) +
    'DIFF'.padStart(19) +
    'SPREAD %'.padStart(19),
  );

  console.log('-'.repeat(135));

  const topResults = allSpreads.slice(0, 30);

  for (const item of topResults) {
    console.log(
      String(item.symbol).padEnd(19) +
      item.buyExchange.padEnd(17) +
      item.sellExchange.padEnd(17) +
      formatPrice(item.buyAsk).padStart(19) +
      formatPrice(item.sellBid).padStart(19) +
      formatPrice(item.difference).padStart(19) +
      formatPercent(item.percent).padStart(19),
    );
  }

  if (topResults.length === 0) {
    console.log('No comparable live bid/ask prices yet.');
  }

  console.log('-'.repeat(135));
  console.log(`Total spread routes calculated: ${allSpreads.length}`);

  if (positiveSpreads.length > 0) {
    const best = positiveSpreads[0];

    console.log(
      `BEST GROSS OPPORTUNITY: ${best.symbol} | Buy ${best.buyExchange} -> Sell ${best.sellExchange}`,
    );
    console.log(
      `Gross difference: ${formatPrice(best.difference)} | Spread: ${formatPercent(best.percent)}`,
    );
  } else {
    console.log('No positive gross spread at current prices.');
  }

  console.log('\nLIVE SYMBOL COVERAGE');
  console.log('-'.repeat(80));

  console.log(
    'SYMBOL'.padEnd(20) +
    EXCHANGES.map((exchange) => exchange.padStart(18)).join('') +
    '  ROUTES',
  );

  console.log('-'.repeat(80));

  for (const symbolData of symbols.slice(0, 25)) {
    const available = EXCHANGES.map((exchange) => {
      const ticker = getTicker(symbolData, exchange);
      const bid = getNumber(ticker, ['bidPrice', 'bid']);
      const ask = getNumber(ticker, ['askPrice', 'ask']);

      return Number.isFinite(bid) && Number.isFinite(ask)
        ? 'LIVE'
        : '--';
    });

    const routeCount = calculateSpreads(symbolData).length;

    console.log(
      String(symbolData.symbol).padEnd(20) +
      available.map((value) => value.padStart(18)).join('') +
      String(routeCount).padStart(9),
    );
  }

  if (symbols.length > 25) {
    console.log(`... and ${symbols.length - 25} more symbols`);
  }

  console.log('-'.repeat(135));
  console.log('Showing top 30 spread routes and first 25 symbols.');
  console.log('Fees, funding, slippage and executable order-book depth are not included.');
  console.log('Press Ctrl+C to stop.');
}

async function fetchLiveMarket() {
  return request(API_PATH);
}

async function main() {
  console.log('Logging in...');
  await login();
  console.log('Login successful.');
  console.clear();

  while (running) {
    try {
      const data = await fetchLiveMarket();
      lastError = null;
      render(data);
    } catch (error) {
      lastError = error.message;

      if (
        (error.status === 401 || error.status === 403) &&
        !isRefreshing
      ) {
        isRefreshing = true;

        try {
          await login();
        } catch (loginError) {
          lastError = `Login failed: ${loginError.message}`;
        } finally {
          isRefreshing = false;
        }
      }

      if (!latestSymbols.length) {
        readline.cursorTo(process.stdout, 0, 0);
        readline.clearScreenDown(process.stdout);
        console.log('ALL SYMBOLS LIVE DASHBOARD');
        console.log(`API error: ${lastError}`);
        console.log(`Endpoint: ${BASE_URL}${API_PATH}`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, REFRESH_MS));
  }
}

process.on('SIGINT', () => {
  running = false;
  console.log('\nDashboard stopped.');
  process.exit(0);
});

main().catch((error) => {
  console.error('\nCould not start dashboard:', error.message);
  process.exit(1);
});
