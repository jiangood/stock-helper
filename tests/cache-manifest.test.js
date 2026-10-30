'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildManifest } = require('../scripts/build_cache_manifest');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-cache-manifest-'));
  const data = path.join(root, 'data');
  writeJson(path.join(data, 'stocks.json'), [{ code: 'sh600000' }]);
  writeJson(path.join(data, 'stock-quotes.json'), {
    updatedAt: '2026-10-30T07:30:00Z', marketDate: '2026-10-29', status: 'ok',
    quotes: { sh600000: { price: 10 } }
  });
  writeJson(path.join(data, 'fundamentals.json'), { updatedAt: '2026-10-20T00:00:00Z', stocks: {} });
  writeJson(path.join(data, 'stock-cache', 'sh600000.json'), { detail: {}, dailyAdjusted: { bars: [] } });
  writeJson(path.join(data, 'cache', 'stock-details.json'), { schemaVersion: 1, updatedAt: '2026-10-30T07:30:00Z', marketDate: '2026-10-29', details: { sh600000: { code: 'sh600000', name: 'Bank', price: 10, peTtm: 5, pb: 0.5 } } });
  writeJson(path.join(data, 'cache', 'stocks', 'sh600000.json'), { schemaVersion: 1, cacheType: 'stock-detail', code: 'sh600000', updatedAt: '2026-10-30T07:30:00Z', marketDate: '2026-10-29', data: { detail: { code: 'sh600000', price: 10 }, dailyAdjusted: { bars: [] } } });
  writeJson(path.join(data, 'combat-kline.json'), {
    schemaVersion: 1, updatedAt: '2026-10-30T07:30:00Z', marketDate: '2026-10-29',
    stocks: { sh600000: { bars: [{ time: '2026-10-29' }] } }
  });
  writeJson(path.join(data, 'research-scores.json'), {
    schemaVersion: 1, updatedAt: '2026-10-30T07:30:00Z', marketDate: '2026-10-29',
    scores: { sh600000: { percent: 80 } }
  });
  writeJson(path.join(data, 'sector-monthly.json'), {
    schemaVersion: 1, updatedAt: '2026-10-30T07:30:00Z', marketDate: '2026-10-29',
    stocks: { sh600000: { m1: 1 } }
  });
  fs.writeFileSync(path.join(root, 'research-score.js'), 'module.exports = {};');
  return { root, data };
}

test('builds manifest metadata, record counts and freshness', () => {
  const env = fixture();
  try {
    const result = buildManifest({ dataDir: env.data, now: '2026-10-30T08:00:00Z',
      startedAt: '2026-10-30T07:59:00Z', completedAt: '2026-10-30T08:00:00Z', writeSummary: false });
    assert.equal(result.manifest.schemaVersion, 1);
    assert.match(result.manifest.builderVersion, /^[a-f0-9]{64}$/);
    assert.equal(Object.keys(result.manifest.caches).length, 6);
    assert.equal(result.manifest.caches['combat-kline'].recordCount, 1);
    assert.equal(result.manifest.caches['combat-kline'].freshness, 'fresh');
    assert.equal(result.health.status, 'healthy');
    assert.equal(result.health.durationMs, 60000);
    assert.equal(result.health.contentReuseRate, 0);
    assert.ok(fs.existsSync(path.join(env.data, 'cache', 'manifest.json')));
    assert.ok(fs.existsSync(path.join(env.data, 'monitoring', 'latest.json')));
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});


test('uses the pipeline start timestamp when measuring the complete cache build', () => {
  const env = fixture();
  const previous = process.env.CACHE_BUILD_STARTED_AT;
  process.env.CACHE_BUILD_STARTED_AT = '2026-10-30T07:59:00.000Z';
  try {
    const result = buildManifest({
      dataDir: env.data,
      completedAt: '2026-10-30T08:00:00.000Z',
      writeSummary: false
    });
    assert.equal(result.health.durationMs, 60000);
  } finally {
    if (previous === undefined) delete process.env.CACHE_BUILD_STARTED_AT;
    else process.env.CACHE_BUILD_STARTED_AT = previous;
    fs.rmSync(env.root, { recursive: true, force: true });
  }
});

test('unchanged cache content is reused without rewriting manifest', () => {
  const env = fixture();
  try {
    const first = buildManifest({ dataDir: env.data, now: '2026-10-30T08:00:00Z', writeSummary: false });
    const file = path.join(env.data, 'cache', 'manifest.json');
    const before = fs.readFileSync(file, 'utf8');
    const second = buildManifest({ dataDir: env.data, now: '2026-10-30T09:00:00Z',
      startedAt: '2026-10-30T08:59:00Z', completedAt: '2026-10-30T09:00:00Z', writeSummary: false });
    assert.equal(second.health.reusedCount, 6);
    assert.equal(second.health.contentReuseRate, 100);
    assert.equal(second.manifest.generatedAt, first.manifest.generatedAt);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.equal(second.manifestChanged, false);
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});

test('marks stale read models when their market date trails the quote snapshot', () => {
  const env = fixture();
  try {
    const file = path.join(env.data, 'stock-quotes.json');
    const quotes = JSON.parse(fs.readFileSync(file, 'utf8'));
    quotes.marketDate = '2026-10-30';
    writeJson(file, quotes);
    const result = buildManifest({ dataDir: env.data, writeSummary: false });
    assert.equal(result.manifest.caches['combat-kline'].freshness, 'stale');
    assert.equal(result.health.status, 'stale');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).marketDate, '2026-10-30');
  } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
});
