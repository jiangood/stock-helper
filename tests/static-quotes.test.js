'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'static-quotes.js'), 'utf8');

function makeHarness(fetchImpl) {
  const storage = new Map();
  const window = {
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, value); }
    }
  };
  const context = {
    window,
    document: { baseURI: 'https://example.test/stock-helper/' },
    fetch: fetchImpl,
    AbortSignal,
    URL,
    console
  };
  vm.runInNewContext(source, context, { filename: 'static-quotes.js' });
  return { api: window.StockQuotes, storage };
}

const bars = Array.from({ length: 12 }, (_, index) => ({
  time: '2026-10-' + String(index + 1).padStart(2, '0'),
  open: 4 + index / 100,
  close: 4.01 + index / 100,
  high: 4.05 + index / 100,
  low: 3.99 + index / 100,
  volume: 1000 + index
}));

test('static adapter reads quote, detail, daily/weekly/monthly and index caches only from same origin', async () => {
  const requested = [];
  const files = {
    'data/stock-quotes.json': { quotes: {
      sz002408: { code: 'sz002408', price: 4.36, todayChange: -1.36 },
      sh000001: { code: 'sh000001', price: 3200, todayChange: 0.4 }
    }, updatedAt: '2026-10-29T07:25:00.000Z', marketDate: '2026-10-29', status: 'ok' },
    'data/stock-cache/sz002408.json': {
      detail: { code: 'sz002408', name: '齐翔腾达', price: 4.36, peTtm: 12, pb: 1.1 },
      dailyAdjusted: { bars }, dailyRaw: { bars },
      weeklyAdjusted: { bars: bars.slice(0, 10) },
      monthlyAdjusted: { bars: bars.slice(0, 8) }
    },
    'data/index-cache.json': { monthly: { sh000001: { bars: bars.slice(0, 10) } } }
  };
  const harness = makeHarness(async url => {
    requested.push(String(url));
    const key = Object.keys(files).find(item => String(url).endsWith('/' + item));
    if (!key) throw new Error('Unexpected URL: ' + url);
    return { ok: true, status: 200, json: async () => files[key] };
  });
  const client = new harness.api.Client();
  const quotes = await client.fetch(['sz002408', 'sh000001']);
  assert.equal(quotes.sz002408.price, 4.36);
  assert.equal(quotes.sh000001.price, 3200);
  assert.equal((await client.fetchDetail('sz002408')).name, '齐翔腾达');
  assert.equal((await client.fetchKline('sz002408', { period: 'day', count: 10 })).bars.length, 10);
  assert.equal((await client.fetchKline('sz002408', { period: 'week', count: 10 })).bars.length, 10);
  assert.equal((await client.fetchKline('sz002408', { period: 'month', count: 10 })).bars.length, 8);
  assert.equal((await client.fetchKline('sh000001', { period: 'month', count: 10 })).bars.length, 10);
  assert.equal(harness.api.isTrading(), false, 'browser-side intraday polling should be disabled');
  assert.ok(requested.every(url => url.startsWith('https://example.test/stock-helper/')));
});

test('static adapter keeps a last-known-good local cache when same-origin fetch fails', async () => {
  let fail = false;
  const files = { 'data/stock-quotes.json': { quotes: { sz002408: { price: 4.36 } } } };
  const harness = makeHarness(async url => {
    if (fail) throw new Error('offline');
    const key = Object.keys(files).find(item => String(url).endsWith('/' + item));
    return { ok: true, status: 200, json: async () => files[key] };
  });
  const client = new harness.api.Client();
  assert.equal((await client.fetch(['sz002408'])).sz002408.price, 4.36);
  fail = true;
  const cached = await client.fetch(['sz002408'], { force: true });
  assert.equal(cached.sz002408.price, 4.36);
});
