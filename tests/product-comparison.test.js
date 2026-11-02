'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { monthlyLast, normalizedComparison, productMonthly } = require('../scripts/build_product_comparison');

test('monthlyLast keeps the last valid observation in each month', () => {
  const result = monthlyLast([
    { date: '2026-01-02', value: 10 },
    { date: '2026-01-29', value: 12 },
    { date: '2026-02-01', value: 0 },
    { date: '2026-02-28', value: 15 }
  ]);
  assert.deepEqual(result.map((point) => [point.month, point.value]), [['2026-01', 12], ['2026-02', 15]]);
});

test('monthlyLast accepts month-only dates used by cached monthly K-lines', () => {
  const result = monthlyLast([
    { date: '2026-09', value: 8.8 },
    { date: '2026-10', value: 8.7 }
  ]);
  assert.deepEqual(result.map((point) => [point.month, point.value]), [['2026-09', 8.8], ['2026-10', 8.7]]);
});

test('normalizedComparison aligns common months and uses a common base of 100', () => {
  const result = normalizedComparison(
    [{ month: '2026-01', value: 100 }, { month: '2026-02', value: 110 }],
    [{ month: '2025-12', value: 20 }, { month: '2026-01', value: 5 }, { month: '2026-02', value: 4 }]
  );
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.series.map((point) => [point.productIndex, point.stockIndex]), [[100, 100], [110, 80]]);
});

test('comparison refuses to draw with fewer than two common months', () => {
  const result = normalizedComparison([{ month: '2026-01', value: 1 }], [{ month: '2026-01', value: 2 }]);
  assert.equal(result.status, 'insufficient-history');
  assert.deepEqual(result.series, []);
});

test('productMonthly uses spot first and futures only as fallback', () => {
  const result = productMonthly({ series: [
    { date: '2026-01-10', spot: 100, futures: 90 },
    { date: '2026-01-31', spot: 110, futures: 95 }
  ] });
  assert.equal(result[0].value, 110);
});

test('every stock has a main product label or an explicit manual mapping', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const stocks = JSON.parse(fs.readFileSync(path.join(root, 'data/stocks.json'), 'utf8'));
  const fundamentals = JSON.parse(fs.readFileSync(path.join(root, 'data/fundamentals.json'), 'utf8')).stocks;
  const mappings = JSON.parse(fs.readFileSync(path.join(root, 'data/stock-products.json'), 'utf8')).byCode;
  const missing = stocks.filter((stock) => !(mappings[stock.code] && mappings[stock.code].productName) && !(fundamentals[stock.code] && fundamentals[stock.code].mainItem)).map((stock) => stock.code);
  assert.deepEqual(missing, []);
});

test('productMonthly prefers long-range native monthly K-line closes over short daily snapshots', () => {
  const result = productMonthly({
    series: [
      { date: '2026-09-29', spot: 100 },
      { date: '2026-10-30', spot: 110 }
    ],
    monthlyKlines: {
      series: [
        { date: '2025-01', open: 80, high: 90, low: 75, close: 85 },
        { date: '2025-02', open: 85, high: 95, low: 82, close: 92 },
        { date: '2025-03', open: 92, high: 98, low: 88, close: 96 }
      ]
    }
  });
  assert.deepEqual(result.map((point) => [point.month, point.value]), [
    ['2025-01', 85], ['2025-02', 92], ['2025-03', 96]
  ]);
});

test('productMonthly falls back to actual daily spot/futures when monthly K-lines are absent', () => {
  const result = productMonthly({ series: [
    { date: '2026-01-02', spot: 100 },
    { date: '2026-01-30', spot: 105 },
    { date: '2026-02-27', futures: 110 }
  ] });
  assert.deepEqual(result.map((point) => [point.month, point.value]), [
    ['2026-01', 105], ['2026-02', 110]
  ]);
});


test('commodity database index references one independent JSON file per product', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..');
  const { build } = require('../scripts/build_product_comparison');
  const result = build();
  const databaseDir = path.join(root, 'data/commodity-db');
  const database = JSON.parse(fs.readFileSync(path.join(databaseDir, 'index.json'), 'utf8'));
  assert.equal(database.schemaVersion, 2);
  assert.equal(database.productCount, database.products.length);
  assert.equal(database.productCount, result.commodityCount);
  assert.ok(database.productCount > 0);
  assert.equal(Object.prototype.hasOwnProperty.call(database, 'commodityCards'), false,
    'the index must not contain full commodity histories');
  const ids = new Set();
  database.products.forEach((product) => {
    assert.ok(!ids.has(product.id), 'product ids must be unique');
    ids.add(product.id);
    assert.match(product.file, /^products\/[a-z0-9-]+\.json$/);
    const card = JSON.parse(fs.readFileSync(path.join(databaseDir, product.file), 'utf8'));
    assert.equal(card.id, product.id);
    assert.ok(Array.isArray(card.months));
    assert.equal(product.monthCount, card.productMonthCount,
      'index monthCount must represent commodity prices only');
    assert.equal(product.stockTimelineMonthCount, card.stockTimelineMonthCount);
    assert.equal(product.commonMonthCount, card.commonMonthCount);
    assert.ok(Array.isArray(card.productSeries));
    assert.ok(Array.isArray(card.stocks));
    assert.ok(card.productMonthCount >= card.commonMonthCount,
      'common comparison months cannot exceed the commodity own-history count');
    assert.ok(card.productSeries.length === 0 || card.productSeries.length === card.commonMonthCount,
      'aligned product series must match the common comparison timeline');
    assert.ok(card.commonMonthCount <= card.productMonthCount,
      'common month coverage cannot exceed commodity coverage');
    card.stocks.forEach((stock) => {
      assert.ok(Number.isInteger(stock.monthCount) && stock.monthCount >= 0,
        'each stock must expose its own valid monthly coverage');
      assert.ok(stock.monthCount >= stock.values.filter((point) => point.price !== null).length,
        'a stock history count must not be smaller than its aligned chart points');
    });
  });
  const sourceProducts = JSON.parse(fs.readFileSync(path.join(root, 'data/business-data.json'), 'utf8')).items;
  assert.equal(sourceProducts['maleic-anhydride'].sunsirsPpid, '660');
  assert.equal(sourceProducts.tio2.sunsirsPpid, null,
    'unverified Sunsirs PPIDs must remain explicitly empty');
  database.products.forEach((product) => {
    assert.equal(product.sunsirsPpid, sourceProducts[product.id] && sourceProducts[product.id].sunsirsPpid || null,
      'generated commodity index must carry the authoritative Sunsirs PPID');
  });
  const maleic = database.products.find((item) => item.id === 'maleic-anhydride');
  assert.ok(maleic, 'maleic anhydride must remain in the product index');
  const maleicCard = JSON.parse(fs.readFileSync(path.join(databaseDir, maleic.file), 'utf8'));
  const maleicHistory = JSON.parse(fs.readFileSync(path.join(root, 'data/maleic-anhydride-monthly.json'), 'utf8'));
  const observedMonths = new Set(maleicHistory.points
    .filter((point) => point.status === 'estimated' && point.estimated === true && Number(point.value) > 0)
    .map((point) => point.month));
  assert.equal(maleic.monthCount, observedMonths.size,
    'maleic anhydride months must come only from valid month-start chart estimates');
  maleicCard.months.forEach((month) => assert.ok(observedMonths.has(month),
    'a comparison month cannot exist without a valid month-start chart estimate'));
  assert.ok(Array.isArray(maleicCard.alternateProductSeries), 'independent market source series is exposed separately');
  assert.ok(maleicCard.alternateSource, 'alternate source label is available for the clickable chart control');
  assert.match(maleic.source, /图像估算/,
    'maleic anhydride chart must disclose its image-derived estimate basis');
  assert.ok(maleicCard.stocks.some((stock) => stock.monthCount > 0),
    'linked equity history should remain available and separately counted');
});
