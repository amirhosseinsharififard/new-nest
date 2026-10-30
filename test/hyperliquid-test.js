
const WS_URL = 'wss://api.hyperliquid.xyz/ws';

const COINS = ['BTC', 'ETH'];

let ws;
let reconnectTimer;
let pingTimer;
let reconnectDelay = 2000;
let stopped = false;

function log(message, data) {
  console.log(
    `\n[${new Date().toLocaleTimeString()}] ${message}`,
  );

  if (data !== undefined) {
    console.dir(data, { depth: 6, colors: true });
  }
}

function subscribe(subscription) {
  ws.send(
    JSON.stringify({
      method: 'subscribe',
      subscription,
    }),
  );
}

function connect() {
  if (stopped) return;

  log('Connecting to Hyperliquid WebSocket...');

  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    reconnectDelay = 2000;

    log('CONNECTED', WS_URL);

    // دریافت قیمت میانی همه ارزها
    subscribe({ type: 'allMids' });

    // دریافت دفتر سفارشات BTC
    subscribe({ type: 'l2Book', coin: 'BTC' });

    // دریافت دفتر سفارشات ETH
    subscribe({ type: 'l2Book', coin: 'ETH' });

    // ارسال ping برای حفظ اتصال
    pingTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, 30000);
  });

  ws.addEventListener('message', (event) => {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      log('INVALID JSON', event.data);
      return;
    }

    // پیام تأیید اشتراک یا پاسخ ping
    if (
      message.channel === 'subscriptionResponse' ||
      message.channel === 'pong'
    ) {
      log(`SYSTEM: ${message.channel}`, message.data);
      return;
    }

    // قیمت میانی ارزها
    if (message.channel === 'allMids') {
      const mids = message.data?.mids ?? {};

      console.log('\n========== ALL MIDS ==========');

      for (const coin of COINS) {
        console.log(`${coin}: ${mids[coin] ?? 'Not available'}`);
      }

      return;
    }

    // دفتر سفارشات خرید و فروش
    if (message.channel === 'l2Book') {
      const { coin, levels, time } = message.data ?? {};

      const bids = levels?.[0] ?? [];
      const asks = levels?.[1] ?? [];

      const bestBid = bids[0];
      const bestAsk = asks[0];

      console.log(`\n========== L2 BOOK: ${coin} ==========`);

      console.log('Exchange timestamp:', time);

      console.log(
        'Best Bid:',
        bestBid
          ? `Price=${bestBid.px}, Size=${bestBid.sz}`
          : 'Unavailable',
      );

      console.log(
        'Best Ask:',
        bestAsk
          ? `Price=${bestAsk.px}, Size=${bestAsk.sz}`
          : 'Unavailable',
      );

      if (bestBid && bestAsk) {
        const bid = Number(bestBid.px);
        const ask = Number(bestAsk.px);

        console.log(
          'Bid/Ask Spread:',
          (ask - bid).toFixed(8),
        );

        console.log(
          'Spread %:',
          (((ask - bid) / ask) * 100).toFixed(6) + '%',
        );
      }

      return;
    }

    // نمایش خطاها و سایر کانال‌ها
    log(`CHANNEL: ${message.channel ?? 'unknown'}`, message);
  });

  ws.addEventListener('error', (event) => {
    log('WEBSOCKET ERROR', event.message || 'Connection error');
  });

  ws.addEventListener('close', (event) => {
    clearInterval(pingTimer);

    log(
      `DISCONNECTED: code=${event.code}, reason=${event.reason || 'none'}`,
    );

    if (!stopped) {
      log(`Reconnecting in ${reconnectDelay / 1000}s...`);

      reconnectTimer = setTimeout(connect, reconnectDelay);

      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }
  });
}

function shutdown() {
  stopped = true;

  clearTimeout(reconnectTimer);
  clearInterval(pingTimer);

  log('Stopping WebSocket test...');

  if (ws && ws.readyState < WebSocket.CLOSING) {
    ws.close();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

connect();
