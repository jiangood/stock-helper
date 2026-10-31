'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LIMITS, buildFile } = require('../scripts/build_stock_detail_cache');

const bars = count => Array.from({ length: count }, (_, i) => ({
  time: '2026-01-' + String((i % 28) + 1).padStart(2, '0'),
  open: 10, close: 11, high: 12, low: 9, volume: 100
}));
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-detail-cache-'));
  const dataDir = path.join(root, 'data');
  const stocks = [{ code: 'sh600000', name: '浦发银行' }, { code: 'sz000001', name: '平安银行' }];
  write(path.join(dataDir, 'stocks.json'), stocks);
  write(path.join(dataDir, 'stock-quotes.json'), {
    marketDate: '2026-10-29', updatedAt: '2026-10-30T08:00:00Z',
    quotes: {
      sh600000: { code: 'sh600000', name: '浦发银行', price: 10, peTtm: 5, pb: 0.5 },
      sz000001: { code: 'sz000001', name: '平安银行', price: 12, peTtm: 6, pb: 0.6 }
    }
  });
  for (const stock of stocks) write(path.join(dataDir, 'stock-cache', stock.code + '.json'), {
    detail: { code: stock.code, name: stock.name, price: 10, peTtm: 5, pb: 0.5 },
    dailyAdjusted: { bars: bars(300) }, dailyRaw: { bars: bars(280) },
    weeklyAdjusted: { bars: bars(220) }, monthlyAdjusted: { bars: bars(260) }
  });
  return { root, dataDir };
}

test('builds compact bundles and the peer valuation index', () => {
  const env = fixture();
  try {
    const result = buildFile({ dataDir: env.dataDir, updatedAt: '2026-10-30T08:05:00Z' });
    assert.equal(result.bundleCount, 2);
    const bundle = JSON.parse(fs.readFileSync(path.join(env.dataDir, 'cache/stocks/sh600000.json'), 'utf8'));
    assert.equal(bundle.marketDate, '2026-10-29');
    assert.equal(bundle.data.dailyAdjusted.bars.length, LIMITS.dailyAdjusted);
    assert.equal(bundle.data.dailyRaw.bars.length, LIMITS.dailyRaw);
    assert.equal(bundle.data.weeklyAdjusted.bars.length, LIMITS.weeklyAdjusted);
    assert.equal(bundle.data.monthlyAdjusted.bars.length, LIMITS.monthlyAdjusted);
    const index = JSON.parse(fs.readFileSync(path.join(env.dataDir, 'cache/stock-details.json'), 'utf8'));
    assert.equal(index.details.sz000001.peTtm, 5);
    assert.equal(index.details.sz000001.pb, 0.5);
    assert.equal(index.monthlyTrends.sh600000.length, 200);
    assert.deepEqual(index.monthlyTrends.sh600000[0], { time: '2026-01-05', close: 11 });
    assert.equal(index.monthlyTrends.sz000001.length, 200);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('refuses detail publication below the 70 percent coverage threshold', () => {
  const env = fixture();
  try {
    buildFile({ dataDir: env.dataDir });
    const indexFile = path.join(env.dataDir, 'cache/stock-details.json');
    const before = fs.readFileSync(indexFile, 'utf8');
    fs.rmSync(path.join(env.dataDir, 'stock-cache/sz000001.json'));
    write(path.join(env.dataDir, 'stock-quotes.json'), { marketDate: '2026-10-29', quotes: { sh600000: { price: 10 } } });
    assert.throws(() => buildFile({ dataDir: env.dataDir }), /coverage below 70%/);
    assert.equal(fs.readFileSync(indexFile, 'utf8'), before);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('timestamp-only changes do not rewrite unchanged detail bundles', () => {
  const env = fixture();
  try {
    buildFile({ dataDir: env.dataDir, updatedAt: '2026-10-30T08:00:00Z' });
    const file = path.join(env.dataDir, 'cache/stocks/sh600000.json');
    const before = fs.readFileSync(file, 'utf8');
    const result = buildFile({ dataDir: env.dataDir, updatedAt: '2026-10-30T09:00:00Z' });
    assert.equal(result.changedFiles, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});
