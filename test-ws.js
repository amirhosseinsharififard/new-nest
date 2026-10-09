const BASE_URL = 'http://localhost:3000';

const USERNAME = 'aliiii';
const PASSWORD = 'MyPass123456';

const SYMBOL = 'BTC-USDT';

const EXCHANGES = [
  'binance',
  'bybit',
  'okx',
  'hyperliquid',
];

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `${options.method || 'GET'} ${path} -> ${response.status}\n` +
        JSON.stringify(data, null, 2),
    );
  }

  return data;
}

// ============================================================
// LOGIN
// ============================================================

async function login() {
  console.log('\n========== LOGIN ==========');

  const data = await request('/auth/login', {
    method: 'POST',

    body: JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
    }),
  });

  if (!data?.accessToken) {
    throw new Error(
      `Login succeeded but accessToken was not found:\n${JSON.stringify(
        data,
        null,
        2,
      )}`,
    );
  }

  console.log('Login successful');

  return data.accessToken;
}

// ============================================================
// GET EXCHANGES
// ============================================================

async function getExchanges(token) {
  console.log('\n========== EXCHANGES ==========');

  const exchanges = await request('/exchanges', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  console.table(
    exchanges.map((exchange) => ({
      id: exchange.id,
      slug: exchange.slug,
      name: exchange.displayName,
      marketType: exchange.marketType,
      active: exchange.isActive,
    })),
  );

  return exchanges;
}

// ============================================================
// CHECK LIVE MARKET
// ============================================================

async function checkLiveMarket(token) {
  const path =
    `/market/live` +
    `?symbol=${encodeURIComponent(SYMBOL)}`;

  try {
    const data = await request(path, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return data;
  } catch (error) {
    console.log('\nLIVE DATA ERROR');
    console.log(error.message);

    return null;
  }
}

// ============================================================
// DISPLAY LIVE DATA
// ============================================================

function displayLiveData(data) {
  console.clear();

  console.log('==============================================');
  console.log('          LIVE MARKET DATA');
  console.log('==============================================');

  console.log(`Symbol: ${SYMBOL}`);
  console.log(`Time: ${new Date().toLocaleTimeString()}`);

  console.log('==============================================');

  if (!data) {
    console.log('No data received');
    return;
  }

  console.log(
    JSON.stringify(data, null, 2),
  );
}

// ============================================================
// WAIT
// ============================================================

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  try {
    console.log('==============================================');
    console.log('       ARBITRAGE BOT - LIVE DATA TEST');
    console.log('==============================================');

    console.log(`Base URL : ${BASE_URL}`);
    console.log(`Symbol   : ${SYMBOL}`);

    // ----------------------------------------------------------
    // LOGIN
    // ----------------------------------------------------------

    const token = await login();

    // ----------------------------------------------------------
    // EXCHANGES
    // ----------------------------------------------------------

    await getExchanges(token);

    // ----------------------------------------------------------
    // LIVE DATA
    // ----------------------------------------------------------

    console.log('\n========== LIVE DATA ==========');

    console.log(
      'Waiting for WebSocket market data...',
    );

    // ----------------------------------------------------------
    // CONTINUOUS LIVE MONITOR
    // ----------------------------------------------------------

    while (true) {
      const data = await checkLiveMarket(token);

      displayLiveData(data);

      await wait(1000);
    }
  } catch (error) {
    console.log('\n==============================================');
    console.log('TEST FAILED');
    console.log('==============================================');

    console.error(error.message);

    if (error.stack) {
      console.error('\nSTACK:');
      console.error(error.stack);
    }
  }
}

main();
