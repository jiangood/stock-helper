#!/usr/bin/env node
'use strict';

// Build a compact, purpose-specific read model for the combat page.
// It contains only the latest 120 adjusted daily bars per stock, avoiding
// 60+ downloads of full per-stock files that also contain unrelated histories.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA, 'stock-cache');
const OUTPUT = path.join(DATA, 'combat-kline.json');
const BAR_LIMIT = 120;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function buildPayload(stocks, options) {
  const opts = options || {};
  const cacheDir = opts.cacheDir || CACHE_DIR;
  const result = {};
  (Array.isArray(stocks) ? stocks : []).forEach(stock => {
    const code = String(stock && stock.code || '').toLowerCase();
    if (!/^(sh|sz)\d{6}$/.test(code)) return;
    const cache = readJson(path.join(cacheDir, code + '.json'), null);
    const bars = cache && cache.dailyAdjusted && Array.isArray(cache.dailyAdjusted.bars)
      ? cache.dailyAdjusted.bars.slice(-BAR_LIMIT) : [];
    if (bars.length) result[code] = { bars };
  });
  return {
    schemaVersion: 1,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    marketDate: opts.marketDate || null,
    barLimit: BAR_LIMIT,
    stocks: result
  };
}

function writePayload(file, payload) {
  const previous = readJson(file, null);
  const comparable = value => {
    if (!value || typeof value !== 'object') return value;
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.updatedAt;
    return copy;
  };
  if (previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(payload))) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(payload) + '\n', 'utf8');
  fs.renameSync(temp, file);
  return true;
}

function buildFile(options) {
  const opts = options || {};
  const stocks = opts.stocks || readJson(path.join(DATA, 'stocks.json'), []);
  const quotes = opts.quotes || readJson(opts.quotesFile || path.join(DATA, 'stock-quotes.json'), {});
  const buildOptions = Object.assign({}, opts, { marketDate: opts.marketDate || quotes.marketDate || null });
  const file = opts.file || OUTPUT;
  const payload = buildPayload(stocks, buildOptions);
  if (!Object.keys(payload.stocks).length) {
    const previous = readJson(file, null);
    if (previous && previous.stocks && Object.keys(previous.stocks).length) {
      console.warn('No combat K-line records produced; preserving the previous snapshot.');
      return { payload: previous, changed: false, skipped: true };
    }
    throw new Error('No combat K-line records produced; refusing to publish an empty snapshot.');
  }
  const changed = writePayload(file, payload);
  console.log('Combat K-line snapshot: ' + Object.keys(payload.stocks).length + '/' +
    stocks.length + ' stocks; ' + (changed ? 'updated' : 'unchanged') + '.');
  return { payload, changed, skipped: false };
}

if (require.main === module) {
  try { buildFile(); }
  catch (error) {
    console.error('Combat K-line build failed: ' + (error.stack || error.message));
    process.exitCode = 1;
  }
}

module.exports = { BAR_LIMIT, buildPayload, buildFile };
