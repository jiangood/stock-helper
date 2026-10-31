'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'static-quotes.js'), 'utf8');

function makeHarness(fetchImpl) {
  let storageReads = 0;
  let storageWrites = 0;
  let indexedDbReads = 0;
  const window = {
    localStorage: {
      getItem() { storageReads += 1; return null; },
      setItem() { storageWrites += 1; }
    }
  };
  Object.defineProperty(window, 'indexedDB', {
    get() { indexedDbReads += 1; throw new Error('frontend database must not be accessed'); }
  });
  const context = {
    window,
    document: { baseURI: 'https://example.test/stock-helper/' },
    fetch: fetchImpl,
    AbortSignal,
    URL,
    console
  };
  vm.runInNewContext(source, context, { filename: 'static-quotes.js' });
  return {
    api: window.StockQuotes,
    getStorageAccesses: () => ({ storageReads, storageWrites, indexedDbReads })
  };
}

const bars = Array.from({ length: 12 }, (_, index) => ({
  time: '2026-10-' + String(index + 1).padStart(2, '0'),
  open: 4 + index / 100,
  close: 4.01 + index / 100,
  high: 4.05 + index / 100,
  low: 3.99 + index / 100,
  volume: 1000 + index
}));

test('static adapter reads quote, detail, daily/weekly/monthly and index data from same origin', async () => {
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
    'data/index-cache.json': { monthly: { sh000001: { bars: bars.slice(0, 10) } } },
  };
  const harness = makeHarness(async (url, options) => {
    requested.push({ url: String(url), cache: options && options.cache });
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
  assert.ok(requested.every(item => item.url.startsWith('https://example.test/stock-helper/')));
  assert.ok(requested.every(item => item.cache === 'no-store'));
  assert.deepEqual(harness.getStorageAccesses(), { storageReads: 0, storageWrites: 0, indexedDbReads: 0 });
});


test('detail bundle and peer valuation index are read as compact same-origin files', async () => {
  const requested = [];
  const files = {
    'data/cache/stocks/sz002408.json': {
      schemaVersion: 1, cacheType: 'stock-detail', code: 'sz002408', marketDate: '2026-10-29',
      data: {
        detail: { code: 'sz002408', name: '齐翔腾达', price: 4.36 },
        dailyAdjusted: { bars }, dailyRaw: { bars },
        weeklyAdjusted: { bars }, monthlyAdjusted: { bars }
      }
    },
    'data/cache/stock-details.json': {
      schemaVersion: 1, details: {
        sz002408: { code: 'sz002408', name: '齐翔腾达', price: 4.36, peTtm: 12, pb: 1.1 },
        sh600000: { code: 'sh600000', name: '浦发银行', price: 10, peTtm: 5, pb: 0.5 }
      }
    }
  };
  const harness = makeHarness(async (url, options) => {
    requested.push({ url: String(url), cache: options && options.cache });
    const key = Object.keys(files).find(item => String(url).endsWith('/' + item));
    if (!key) throw new Error('Unexpected URL: ' + url);
    return { ok: true, status: 200, json: async () => files[key] };
  });
  const client = new harness.api.Client();
  const bundle = await client.fetchStockBundle('sz002408');
  assert.equal(bundle.detail.name, '齐翔腾达');
  assert.equal(bundle.dailyAdjusted.bars.length, 12);
  assert.equal((await client.fetchDetail('sz002408')).name, '齐翔腾达');
  assert.equal((await client.fetchKline('sz002408', { period: 'day', count: 10 })).bars.length, 10);
  const peers = await client.fetchDetails(['sh600000', 'sz002408']);
  assert.equal(peers.sh600000.peTtm, 5);
  assert.equal(peers.sz002408.pb, 1.1);
  assert.equal(requested.length, 4);
  assert.ok(requested.every(item => item.cache === 'no-store'));
  assert.deepEqual(harness.getStorageAccesses(), { storageReads: 0, storageWrites: 0, indexedDbReads: 0 });
});

test('every data request goes to network again and failed reads do not use stale browser cache', async () => {
  let calls = 0;
  let fail = false;
  const harness = makeHarness(async () => {
    calls += 1;
    if (fail) throw new Error('offline');
    return { ok: true, status: 200, json: async () => ({ quotes: { sz002408: { price: 4.36 } } }) };
  });
  const client = new harness.api.Client();
  assert.equal((await client.fetch(['sz002408'])).sz002408.price, 4.36);
  assert.equal((await client.fetch(['sz002408'])).sz002408.price, 4.36);
  assert.equal(calls, 2, 'repeated reads must fetch the static source each time');
  fail = true;
  await assert.rejects(client.fetch(['sz002408']), /offline/);
  assert.equal(calls, 3);
  assert.deepEqual(harness.getStorageAccesses(), { storageReads: 0, storageWrites: 0, indexedDbReads: 0 });
});
