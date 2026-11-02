const url =
  'http://localhost:3000/spread-analytics?symbol=BTCUSDT&maxQuoteAgeMs=10000';

async function main() {
  try {
    const response = await fetch(url);

    const data = await response.json();

    console.log('Status:', response.status);
    console.log('Response:');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('Request Error:', error.message);
  }
}

main();
