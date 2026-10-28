const test = require('node:test');
const assert = require('node:assert/strict');
const TechInd = require('../indicators.js');

function barsFromPrices(prices, volumes = []) {
  return prices.map((price, i) => ({
    high: price,
    low: price,
    close: price,
    volume: volumes[i] === undefined ? 1 : volumes[i]
  }));
}

test('MFI uses exactly period price changes in each rolling window', () => {
  const result = TechInd.mfi(barsFromPrices([10, 11, 10, 12]), 2);

  assert.equal(result.period, 2);
  assert.equal(result.series.length, 4);
  assert.equal(result.series[0], null);
  assert.equal(result.series[1], null);
  assert.ok(Math.abs(result.series[2] - (100 * 11 / 21)) < 1e-10);
  assert.ok(Math.abs(result.series[3] - (100 * 12 / 22)) < 1e-10);
  assert.equal(result.latest, result.series[3]);
});

test('MFI returns 100 when the window has positive flow but no negative flow', () => {
  const result = TechInd.mfi(barsFromPrices([10, 11, 12, 13]), 2);
  assert.equal(result.latest, 100);
});

test('MFI returns neutral 50 when all prices are unchanged', () => {
  const result = TechInd.mfi(barsFromPrices([10, 10, 10, 10]), 2);
  assert.equal(result.latest, 50);
});

test('MFI returns null latest when there are fewer than period + 1 bars', () => {
  const result = TechInd.mfi(barsFromPrices([10, 11]), 2);
  assert.equal(result.latest, null);
  assert.deepEqual(result.series, []);
});
