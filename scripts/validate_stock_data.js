#!/usr/bin/env node
'use strict';

// Validate the published stock data contract before GitHub Actions commits it.
// This is deliberately read-only: validation must never repair or invent market data.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CODE_RE = /^(sh|sz)\d{6}$/;
const FINITE_FIELDS = ['price', 'prevClose', 'change', 'todayChange', 'pe', 'pb',
  'totalCap', 'floatCap', 'divYield', 'high52', 'low52'];

function fail(message) { throw new Error(message); }
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(path.relative(ROOT, file) + ': invalid JSON (' + error.message + ')'); }
}
function finiteOrNull(value) { return value === null || value === undefined || (typeof value === 'number' && Number.isFinite(value)); }

function validateStocks(stocks) {
  if (!Array.isArray(stocks) || !stocks.length) fail('data/stocks.json must be a non-empty array');
  const seen = new Set();
  stocks.forEach((stock, index) => {
    const label = 'data/stocks.json[' + index + ']';
    if (!isObject(stock)) fail(label + ' must be an object');
    if (typeof stock.name !== 'string' || !stock.name.trim()) fail(label + '.name is required');
    if (typeof stock.group !== 'string' || !stock.group.trim()) fail(label + '.group is required');
    if (typeof stock.code !== 'string' || !CODE_RE.test(stock.code)) fail(label + '.code is invalid: ' + stock.code);
    if (seen.has(stock.code)) fail('duplicate stock code: ' + stock.code);
    seen.add(stock.code);
    ['yearInit', 'entry', 'heavy', 'tp1', 'tp2', 'prevChg'].forEach(key => {
      if (!finiteOrNull(stock[key])) fail(label + '.' + key + ' must be finite or null');
    });
  });
  return seen;
}

function validateQuotes(payload, stockCodes) {
  if (!isObject(payload) || !isObject(payload.quotes)) fail('data/stock-quotes.json must contain a quotes object');
  if (payload.schemaVersion !== 1) fail('data/stock-quotes.json schemaVersion must be 1');
  if (!['ok', 'stale'].includes(payload.status)) fail('data/stock-quotes.json status must be ok or stale');
  if (payload.marketDate !== null && payload.marketDate !== undefined &&
      (typeof payload.marketDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(payload.marketDate))) {
    fail('data/stock-quotes.json marketDate must be YYYY-MM-DD or null');
  }
  const quotes = payload.quotes;
  Object.keys(quotes).forEach(code => {
    if (!CODE_RE.test(code)) fail('invalid quote key: ' + code);
    const quote = quotes[code];
    if (!isObject(quote)) fail('quote ' + code + ' must be an object');
    if (quote.code && quote.code !== code) fail('quote code/key mismatch: ' + code);
    if (!(typeof quote.price === 'number' && Number.isFinite(quote.price) && quote.price > 0)) {
      fail('quote ' + code + ' has invalid price');
    }
    FINITE_FIELDS.forEach(key => {
      if (!finiteOrNull(quote[key])) fail('quote ' + code + '.' + key + ' must be finite or null');
    });
  });
  const covered = [...stockCodes].filter(code => quotes[code] && quotes[code].price > 0).length;
  const coverage = covered / stockCodes.size;
  if (coverage < 0.7) fail('stock quote coverage below 70%: ' + covered + '/' + stockCodes.size);
  return { quoteCount: Object.keys(quotes).length, coverage };
}

function validateBars(bars, label) {
  if (bars === null || bars === undefined) return 0;
  if (!Array.isArray(bars)) fail(label + ' must be an array or null');
  bars.forEach((bar, index) => {
    const item = label + '[' + index + ']';
    if (!isObject(bar)) fail(item + ' must be an object');
    if (!(typeof bar.time === 'string' && bar.time.length >= 7) &&
        !(typeof bar.time === 'number' && Number.isFinite(bar.time))) fail(item + '.time is invalid');
    ['open', 'close', 'high', 'low'].forEach(key => {
      if (!(typeof bar[key] === 'number' && Number.isFinite(bar[key]) && bar[key] > 0)) {
        fail(item + '.' + key + ' must be a positive finite number');
      }
    });
    if (bar.high < Math.max(bar.open, bar.close, bar.low) ||
        bar.low > Math.min(bar.open, bar.close, bar.high)) fail(item + ' has inconsistent OHLC values');
    if (bar.volume !== undefined && !finiteOrNull(bar.volume)) fail(item + '.volume must be finite or null');
  });
  return bars.length;
}

function validateStockCaches(stockCodes) {
  let files = 0;
  let bars = 0;
  for (const code of stockCodes) {
    const file = path.join(DATA, 'stock-cache', code + '.json');
    if (!fs.existsSync(file)) continue;
    const cache = readJson(file);
    if (!isObject(cache)) fail('stock cache ' + code + ' must be an object');
    if (cache.code && cache.code !== code) fail('stock cache code mismatch: ' + code);
    if (cache.schemaVersion !== undefined && cache.schemaVersion !== 1) fail('unsupported stock cache schema: ' + code);
    files += 1;
    ['dailyAdjusted', 'dailyRaw', 'weeklyAdjusted', 'monthlyAdjusted'].forEach(key => {
      const series = cache[key];
      bars += validateBars(series && series.bars, 'stock-cache/' + code + '.json ' + key + '.bars');
    });
    if (cache.detail && cache.detail.price !== null && cache.detail.price !== undefined &&
        !(Number.isFinite(cache.detail.price) && cache.detail.price > 0)) {
      fail('stock cache ' + code + ' has invalid detail.price');
    }
  }
  if (files < Math.ceil(stockCodes.size * 0.7)) {
    fail('stock cache coverage below 70%: ' + files + '/' + stockCodes.size);
  }
  return { cacheFiles: files, bars };
}

function validateCombatSnapshot(payload, stockCodes) {
  if (!isObject(payload) || payload.schemaVersion !== 1 || !isObject(payload.stocks)) {
    fail('data/combat-kline.json must contain schemaVersion 1 and stocks object');
  }
  if (payload.barLimit !== 120) fail('data/combat-kline.json barLimit must be 120');
  let covered = 0;
  let bars = 0;
  Object.entries(payload.stocks).forEach(([code, value]) => {
    if (!stockCodes.has(code) || !isObject(value)) fail('invalid combat K-line record: ' + code);
    if (!Array.isArray(value.bars) || !value.bars.length || value.bars.length > payload.barLimit) {
      fail('combat K-line ' + code + '.bars must contain 1..120 bars');
    }
    bars += validateBars(value.bars, 'combat-kline/' + code + '.bars');
    covered += 1;
  });
  if (covered < Math.ceil(stockCodes.size * 0.7)) {
    fail('combat K-line coverage below 70%: ' + covered + '/' + stockCodes.size);
  }
  return { stocks: covered, bars };
}

function validateFundamentals(payload, stockCodes) {
  if (!isObject(payload) || !isObject(payload.stocks)) fail('data/fundamentals.json must contain stocks object');
  Object.entries(payload.stocks).forEach(([code, value]) => {
    if (!CODE_RE.test(code) || !isObject(value)) fail('invalid fundamentals record: ' + code);
    if (value.ownerType != null && !['central', 'province', 'city', 'other'].includes(value.ownerType)) {
      fail('fundamentals ' + code + ' has invalid ownerType');
    }
    if (value.mainRatio != null && !(typeof value.mainRatio === 'number' && Number.isFinite(value.mainRatio))) {
      fail('fundamentals ' + code + ' has invalid mainRatio');
    }
    if (value.mainBasis != null && !['product', 'industry'].includes(value.mainBasis)) {
      fail('fundamentals ' + code + ' has invalid mainBasis');
    }
    if (value.annual != null && !Array.isArray(value.annual)) fail('fundamentals ' + code + '.annual must be an array');
    (value.annual || []).forEach((item, index) => {
      if (!isObject(item) || typeof item.date !== 'string' || !/^\d{4}-12-31$/.test(item.date)) {
        fail('fundamentals ' + code + '.annual[' + index + '] has invalid annual date');
      }
      ['yoy', 'value'].forEach(key => {
        if (!finiteOrNull(item[key])) fail('fundamentals ' + code + '.annual[' + index + '].' + key + ' must be finite or null');
      });
    });
  });
  return Object.keys(payload.stocks).length;
}

function validateCacheManifest(manifest) {
  if (!isObject(manifest) || manifest.schemaVersion !== 1 || !isObject(manifest.caches)) {
    fail('data/cache/manifest.json must contain schemaVersion 1 and caches object');
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.builderVersion || '')) fail('cache manifest has invalid builderVersion');
  ['market-quotes', 'combat-kline', 'research-scores', 'sector-monthly'].forEach(id => {
    const item = manifest.caches[id];
    if (!isObject(item)) fail('cache manifest missing entry: ' + id);
    if (typeof item.path !== 'string' || !item.path.startsWith('data/')) fail('cache manifest ' + id + ' has invalid path');
    if (!/^[a-f0-9]{64}$/.test(item.dataVersion || '')) fail('cache manifest ' + id + ' has invalid dataVersion');
    if (!/^[a-f0-9]{64}$/.test(item.sourceVersion || '')) fail('cache manifest ' + id + ' has invalid sourceVersion');
    if (!Number.isInteger(item.bytes) || item.bytes < 0) fail('cache manifest ' + id + ' has invalid bytes');
    if (!Number.isInteger(item.recordCount) || item.recordCount < 0) fail('cache manifest ' + id + ' has invalid recordCount');
    if (!['healthy', 'stale', 'unknown'].includes(item.status)) fail('cache manifest ' + id + ' has invalid status');
  });
  return Object.keys(manifest.caches).length;
}

function validateCacheHealth(health) {
  if (!isObject(health) || health.schemaVersion !== 1) fail('data/monitoring/latest.json schemaVersion must be 1');
  if (!['healthy', 'stale', 'degraded'].includes(health.status)) fail('cache health has invalid status');
  ['cacheCount', 'healthyCount', 'staleCount', 'unknownCount', 'durationMs', 'totalBytes'].forEach(key => {
    if (!(typeof health[key] === 'number' && Number.isFinite(health[key]) && health[key] >= 0)) {
      fail('cache health ' + key + ' must be a non-negative finite number');
    }
  });
  if (health.healthyCount + health.staleCount + health.unknownCount !== health.cacheCount) {
    fail('cache health counts do not add up');
  }
  return true;
}

function validateAll(options) {
  const opts = options || {};
  const stocks = readJson(path.join(DATA, 'stocks.json'));
  const codes = validateStocks(stocks);
  const result = { stocks: codes.size };
  if (!opts.fundamentalsOnly) {
    result.quotes = validateQuotes(readJson(path.join(DATA, 'stock-quotes.json')), codes);
    result.caches = validateStockCaches(codes);
    result.combat = validateCombatSnapshot(readJson(path.join(DATA, 'combat-kline.json')), codes);
  }
  const fundamentalsFile = path.join(DATA, 'fundamentals.json');
  if (fs.existsSync(fundamentalsFile)) {
    result.fundamentals = validateFundamentals(readJson(fundamentalsFile), codes);
  }
  const manifestFile = path.join(DATA, 'cache', 'manifest.json');
  const healthFile = path.join(DATA, 'monitoring', 'latest.json');
  if (!opts.skipCacheManifest && fs.existsSync(manifestFile)) {
    result.cacheManifest = validateCacheManifest(readJson(manifestFile));
    if (!fs.existsSync(healthFile)) fail('data/monitoring/latest.json is missing');
    validateCacheHealth(readJson(healthFile));
  }
  return result;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const result = validateAll({ fundamentalsOnly: args.includes('--fundamentals-only'), skipCacheManifest: args.includes('--skip-cache-manifest') });
    console.log('Stock data validation passed: ' + JSON.stringify(result));
  } catch (error) {
    console.error('Stock data validation failed: ' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { validateStocks, validateQuotes, validateBars, validateStockCaches, validateCombatSnapshot, validateFundamentals, validateCacheManifest, validateCacheHealth, validateAll };
