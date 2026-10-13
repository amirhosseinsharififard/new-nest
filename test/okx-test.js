const WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';

const COINS = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];

let ws;
let reconnectTimer;
let pingTimer;
let reconnectDelay = 2000;
let stopped = false;
let lastPongTime = Date.now();

function log(message, data) {
  console.log(`\n[${new Date().toLocaleTimeString()}] ${message}`);

  if (data !== undefined) {
    console.dir(data, { depth: 6, colors: true });
  }
}

function subscribe(instId) {
  if (ws?.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      op: 'subscribe',
      args: [
        {
          channel: 'books5',
          instId,
        },
      ],
    }),
  );
}

function connect() {
  if (stopped) return;

  log('Connecting to OKX WebSocket...');
  ws = new WebSocket(WS_URL);

  ws.addEventListener('open', () => {
    reconnectDelay = 2000;
    lastPongTime = Date.now();

    log('CONNECTED', WS_URL);

    // دریافت دفتر سفارشات BTC و ETH
    for (const coin of COINS) {
      subscribe(coin);
    }

    // OKX از رشته ping/pong برای حفظ اتصال پشتیبانی می‌کند.
    pingTimer = setInterval(() => {
      if (ws?.readyState !== WebSocket.OPEN) return;

      if (Date.now() - lastPongTime > 60000) {
        log('No pong received; reconnecting...');
        ws.terminate?.();
        ws.close();
        return;
      }

      ws.send('ping');
    }, 25000);
  });

  ws.addEventListener('message', (event) => {
    const raw = event.data;

    // پاسخ heartbeat در OKX ممکن است رشته pong باشد.
    if (raw === 'pong') {
      lastPongTime = Date.now();
      log('PONG received');
      return;
    }

    let message;

    try {
      message = JSON.parse(raw.toString());
    } catch {
      log('INVALID JSON', raw);
      return;
    }

    // پاسخ تأیید اشتراک
    if (message.event === 'subscribe') {
      log('SUBSCRIBED', message.arg);
      return;
    }

    // خطای اشتراک یا سرور
    if (message.event === 'error' || message.code !== undefined) {
      if (message.event === 'error' || message.code !== '0') {
        log('OKX ERROR', message);
        return;
      }
    }

    if (message.event === 'unsubscribe') {
      log('UNSUBSCRIBED', message.arg);
      return;
    }

    // پیام دفتر سفارشات
    if (message.arg?.channel === 'books5' && message.data?.length) {
      const book = message.data[0];
      const instId = message.arg.instId;

      const bestBid = book.bids?.[0];
      const bestAsk = book.asks?.[0];

      console.log(`\n========== ORDER BOOK: ${instId} ==========`);

      console.log(
        'Exchange timestamp:',
        book.ts ? new Date(Number(book.ts)).toLocaleString() : 'Unavailable',
      );

      console.log(
        'Best Bid:',
        bestBid
          ? `Price=${bestBid[0]}, Size=${bestBid[1]}`
          : 'Unavailable',
      );

      console.log(
        'Best Ask:',
        bestAsk
          ? `Price=${bestAsk[0]}, Size=${bestAsk[1]}`
          : 'Unavailable',
      );

      if (bestBid && bestAsk) {
        const bid = Number(bestBid[0]);
        const ask = Number(bestAsk[0]);
        const bidSize = Number(bestBid[1]);
        const askSize = Number(bestAsk[1]);

        console.log('Bid Size:', bidSize);
        console.log('Ask Size:', askSize);
        console.log('Spread:', (ask - bid).toFixed(8));

        console.log(
          'Spread %:',
          ask > 0
            ? (((ask - bid) / ask) * 100).toFixed(6) + '%'
            : 'Unavailable',
        );
      }

      return;
    }

    log(`CHANNEL: ${message.arg?.channel ?? 'unknown'}`, message);
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

  log('Stopping OKX WebSocket test...');

  if (ws && ws.readyState < WebSocket.CLOSING) {
    ws.close();
  } else {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

connect();

