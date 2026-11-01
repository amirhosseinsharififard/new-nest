

const readline = require('readline');

const BASE_URL = 'http://localhost:4000';
const API_PATH = '/market/live/all';
const REFRESH_MS = 1000;
const TOP_RESULTS = 20;

const USERNAME = process.env.API_USERNAME || 'aliiii';
const PASSWORD = process.env.API_PASSWORD || 'MyPass123456';

const EXCHANGES = [
  'binance',
  'bybit',
  'okx',
  'hyperliquid',
  'gateio',
];

let accessToken = null;
let running = true;
let isRefreshing = false;
let latestSymbols = [];
let lastError = null;

// --------------------------------------------------
// API
// --------------------------------------------------

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

// --------------------------------------------------
// Normalization
// --------------------------------------------------

function normalizeExchangeName(name) {
  return String(name || '').toLowerCase().trim();
}

function normalizeSymbol(symbol) {
  return String(symbol || '')
    .replace(/[\/_-]/g, '')
    .toUpperCase();
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
    const rawValue = ticker?.[field];

    if (
      rawValue === null ||
      rawValue === undefined ||
      rawValue === ''
    ) {
      continue;
    }

    const value = Number(rawValue);

    if (Number.isFinite(value)) {
      return value;
    }
  }

  return NaN;
}

// --------------------------------------------------
// Formatting
// --------------------------------------------------

function formatPrice(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 'N/A';
  }

  return number.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(4)}%`;
}

// --------------------------------------------------
// Spread Calculation
// --------------------------------------------------

function calculateSpreads(symbolData) {
  const results = [];

  for (const buyExchange of EXCHANGES) {
    for (const sellExchange of EXCHANGES) {
      if (buyExchange === sellExchange) {
        continue;
      }

      const buyTicker = getTicker(symbolData, buyExchange);
      const sellTicker = getTicker(symbolData, sellExchange);

      if (!buyTicker || !sellTicker) {
        continue;
      }

      // Buy from ask, sell at bid
      const buyAsk = getNumber(buyTicker, [
        'askPrice',
        'ask',
      ]);

      const sellBid = getNumber(sellTicker, [
        'bidPrice',
        'bid',
      ]);

      if (
        !Number.isFinite(buyAsk) ||
        !Number.isFinite(sellBid) ||
        buyAsk <= 0 ||
        sellBid <= 0
      ) {
        continue;
      }

      const difference = sellBid - buyAsk;
      const percent = (difference / buyAsk) * 100;

      const buySize = getNumber(buyTicker, [
        'askSize',
        'askQty',
        'askVolume',
      ]);

      const sellSize = getNumber(sellTicker, [
        'bidSize',
        'bidQty',
        'bidVolume',
      ]);

      // Comparable only if both sizes are available.
      const availableSize =
        Number.isFinite(buySize) && Number.isFinite(sellSize)
          ? Math.min(buySize, sellSize)
          : null;

      results.push({
        symbol: symbolData.symbol,
        buyExchange,
        sellExchange,
        buyAsk,
        sellBid,
        difference,
        percent,
        buySize,
        sellSize,
        availableSize,
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

// --------------------------------------------------
// API Response Parsing
// --------------------------------------------------

function extractSymbols(data) {
  let payload = data;

  // Unwrap common API response formats.
  for (let i = 0; i < 3; i++) {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (Array.isArray(payload?.symbols)) {
      return payload.symbols;
    }

    if (payload?.data !== undefined) {
      payload = payload.data;
      continue;
    }

    if (payload?.result !== undefined) {
      payload = payload.result;
      continue;
    }

    break;
  }

  return [];
}

// --------------------------------------------------
// Dashboard Rendering
// --------------------------------------------------

function render(data) {
  const symbols = extractSymbols(data);

  latestSymbols = symbols;

  const allSpreads = calculateAllSpreads(symbols);

  const positiveSpreads = allSpreads.filter(
    (item) => item.difference > 0,
  );

  const negativeSpreads = allSpreads.filter(
    (item) => item.difference <= 0,
  );

  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);

  console.log('==============================================================');
  console.log('                 LIVE ARBITRAGE DASHBOARD');
  console.log('==============================================================');

  console.log(`Time:              ${new Date().toLocaleTimeString()}`);
  console.log(`Symbols:           ${symbols.length}`);
  console.log(`Exchanges:         ${EXCHANGES.length}`);
  console.log(`Total routes:      ${allSpreads.length}`);
  console.log(`Positive spreads:  ${positiveSpreads.length}`);
  console.log(`Negative spreads:  ${negativeSpreads.length}`);

  console.log('--------------------------------------------------------------');

  if (lastError) {
    console.log(`API ERROR: ${lastError}`);
    console.log('--------------------------------------------------------------');
  }

  if (!symbols.length) {
    console.log('\nNo live symbols received from API.');
    console.log('Check API response and Redis ticker cache.');
    return;
  }

  if (!positiveSpreads.length) {
    console.log('\nNo positive spreads available.');
    return;
  }

  console.log(`\nTOP ${TOP_RESULTS} POSITIVE SPREADS\n`);

  console.table(
    positiveSpreads.slice(0, TOP_RESULTS).map((item) => ({
      Symbol: item.symbol,
      Buy: item.buyExchange,
      Sell: item.sellExchange,
      'Buy Ask': formatPrice(item.buyAsk),
      'Sell Bid': formatPrice(item.sellBid),
      Difference: formatPrice(item.difference),
      Spread: formatPercent(item.percent),
      'Available Size': item.availableSize ?? 'N/A',
    })),
  );

  console.log('\n==============================================================');
  console.log('Press CTRL+C to stop.');
}

// --------------------------------------------------
// Market Data
// --------------------------------------------------

async function fetchLiveMarket() {
  return await request(API_PATH);
}

// --------------------------------------------------
// Main
// --------------------------------------------------

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
          lastError = null;
        } catch (loginError) {
          lastError = `Login failed: ${loginError.message}`;
        } finally {
          isRefreshing = false;
        }
      }

      readline.cursorTo(process.stdout, 0, 0);
      readline.clearScreenDown(process.stdout);

      console.log('========== LIVE ARBITRAGE DASHBOARD ==========');
      console.log(`API error: ${lastError}`);
      console.log(`Endpoint: ${BASE_URL}${API_PATH}`);
    }

    await new Promise((resolve) =>
      setTimeout(resolve, REFRESH_MS),
    );
  }
}

// --------------------------------------------------
// Shutdown
// --------------------------------------------------

process.on('SIGINT', () => {
  running = false;
  console.log('\nDashboard stopped.');
  process.exit(0);
});

main().catch((error) => {
  console.error('\nCould not start dashboard:', error.message);
  process.exit(1);
});
