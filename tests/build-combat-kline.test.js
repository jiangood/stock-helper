'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BAR_LIMIT, buildPayload, buildFile } = require('../scripts/build_combat_kline');

function makeBars(count) {
  return Array.from({ length: count }, (_, index) => ({
    time: '2026-01-' + String(index + 1).padStart(2, '0'),
    open: 10, close: 11, high: 12, low: 9, volume: 100
  }));
}

test('combat read model contains only latest 120 adjusted daily bars for stock pool', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-kline-'));
  try {
    fs.writeFileSync(path.join(dir, 'sh600000.json'), JSON.stringify({
      dailyAdjusted: { bars: makeBars(150) },
      dailyRaw: { bars: makeBars(150) },
      weeklyAdjusted: { bars: makeBars(100) }
    }));
    const payload = buildPayload([
      { code: 'sh600000' },
      { code: 'sz000001' },
      { code: 'bad-code' }
    ], { cacheDir: dir, marketDate: '2026-10-29', updatedAt: '2026-10-29T08:00:00Z' });
    assert.equal(payload.schemaVersion, 1);
    assert.equal(payload.barLimit, BAR_LIMIT);
    assert.deepEqual(Object.keys(payload.stocks), ['sh600000']);
    assert.equal(payload.stocks.sh600000.bars.length, 120);
    assert.equal(payload.stocks.sh600000.bars[0].time, '2026-01-31');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('buildFile uses the latest quote market date when no date is passed explicitly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-kline-date-'));
  const cacheDir = path.join(dir, 'cache');
  const file = path.join(dir, 'combat-kline.json');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, 'sh600000.json'), JSON.stringify({
    dailyAdjusted: { bars: makeBars(5) }
  }));
  try {
    const result = buildFile({
      stocks: [{ code: 'sh600000' }],
      cacheDir,
      file,
      quotes: { marketDate: '2026-10-29' },
      updatedAt: '2026-10-30T08:00:00Z'
    });
    assert.equal(result.payload.marketDate, '2026-10-29');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty rebuild preserves prior combat snapshot and refuses empty first publication', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combat-kline-empty-'));
  const cacheDir = path.join(dir, 'cache');
  const file = path.join(dir, 'combat-kline.json');
  fs.mkdirSync(cacheDir);
  try {
    assert.throws(() => buildFile({ stocks: [{ code: 'sh600000' }], cacheDir, file }), /refusing to publish an empty snapshot/);
    const previous = { schemaVersion: 1, barLimit: 120, stocks: { sh600000: { bars: makeBars(3) } } };
    fs.writeFileSync(file, JSON.stringify(previous));
    const result = buildFile({ stocks: [{ code: 'sh600000' }], cacheDir, file });
    assert.equal(result.skipped, true);
    assert.deepEqual(result.payload, previous);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).stocks.sh600000.bars.length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
