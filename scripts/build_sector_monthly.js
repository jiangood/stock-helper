#!/usr/bin/env node
'use strict';

// Build the small sector-monthly summary consumed by the market page.
// The page must never read 60+ per-stock caches just to rank sectors, so GitHub
// Actions pre-computes monthly returns here and publishes data/sector-monthly.json.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA, 'stock-cache');
const STOCKS_FILE = path.join(DATA, 'stocks.json');
const QUOTES_FILE = path.join(DATA, 'stock-quotes.json');
const SECTOR_FILE = path.join(DATA, 'sector-monthly.json');

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

function monthKey(value) {
  const key = String(value == null ? '' : value).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(key) ? key : null;
}

/** Shift a YYYY-MM key by an arbitrary number of months (handles year rollover). */
function shiftMonth(key, delta) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!match) return null;
  const total = Number(match[1]) * 12 + (Number(match[2]) - 1) + Number(delta || 0);
  return String(Math.floor(total / 12)) + '-' + String((total % 12) + 1).padStart(2, '0');
}

function usableBars(bars) {
  return (Array.isArray(bars) ? bars : []).filter(bar =>
    bar && monthKey(bar.time) && Number(bar.close) > 0);
}

/** Monthly closes straight from the monthly K-line cache (already one point per month). */
function seriesFromMonthlyBars(bars) {
  const byMonth = new Map();
  usableBars(bars).forEach(bar => {
    byMonth.set(monthKey(bar.time), Number(bar.close));
  });
  return Array.from(byMonth.keys()).sort().map(month => ({ month, close: byMonth.get(month) }));
}

/** Aggregate daily closes into month-end closes (used when monthly history is missing). */
function seriesFromDailyBars(bars) {
  const byMonth = new Map();
  usableBars(bars)
    .slice()
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
    .forEach(bar => {
      byMonth.set(monthKey(bar.time), Number(bar.close));
    });
  return Array.from(byMonth.keys()).sort().map(month => ({ month, close: byMonth.get(month) }));
}

/** Daily returns over trading-session windows, based on the latest close. */
function dailyReturns(bars) {
  const points = (Array.isArray(bars) ? bars : []).filter(bar =>
    bar && /^\d{4}-\d{2}-\d{2}$/.test(String(bar.time || '')) && Number(bar.close) > 0
  ).slice().sort((a, b) => String(a.time).localeCompare(String(b.time))).slice(-201);
  if (points.length < 2) return null;
  const last = Number(points[points.length - 1].close);
  const pct = sessions => points.length > sessions ? round((last / Number(points[points.length - 1 - sessions].close) - 1) * 100) : null;
  return { date: points[points.length - 1].time, close: round(last), d1:pct(1), d5:pct(5), d20:pct(20), d60:pct(60), d120:pct(120), d200:pct(200), bars:points.length };
}
function stockDaily(cache) {
  if (!cache || typeof cache !== 'object') return null;
  const values = dailyReturns(cache.dailyAdjusted && cache.dailyAdjusted.bars);
  return values ? Object.assign({source:'daily'}, values) : null;
}
/**
 * Build the payload for every stock that has at least two months of closes.
 * readCache is injectable so tests do not need the real cache directory.
 */
function buildPayload(options) {
  const opts = options || {};
  const stocks = Array.isArray(opts.stocks) ? opts.stocks : [];
  const marketMonth = monthKey(opts.marketDate) || monthKey(new Date().toISOString());
  const readCache = typeof opts.readCache === 'function'
    ? opts.readCache
    : code => {
      try { return JSON.parse(fs.readFileSync(path.join(opts.cacheDir || CACHE_DIR, code + '.json'), 'utf8')); }
      catch (_) { return null; }
    };
  const results = {};
  stocks.forEach(stock => {
    const code = String(stock && stock.code || '').trim().toLowerCase();
    if (!/^(sh|sz)\d{6}$/.test(code)) return;
    const values = stockDaily(readCache(code));
    if (values) results[code] = values;
  });
  return {
    schemaVersion: 1,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    marketDate: opts.marketDate || null,
    stocks: results
  };
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}

function writePayload(file, payload) {
  const previous = readJson(file, null);
  const comparable = value => {
    if (!value || typeof value !== 'object') return value;
    const clone = JSON.parse(JSON.stringify(value));
    delete clone.updatedAt;
    return clone;
  };
  if (previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(payload))) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return true;
}

/** Refresh data/sector-monthly.json from the caches written by fetch_stock_snapshot.js. */
function buildFile(options) {
  const opts = options || {};
  const stocks = Array.isArray(opts.stocks) ? opts.stocks : readJson(STOCKS_FILE, []);
  const quotes = opts.quotes || readJson(QUOTES_FILE, {});
  const payload = buildPayload({
    stocks,
    marketDate: opts.marketDate || quotes.marketDate || null,
    updatedAt: opts.updatedAt,
    cacheDir: opts.cacheDir || CACHE_DIR,
    readCache: opts.readCache
  });
  const file = opts.file || SECTOR_FILE;
  if (!Object.keys(payload.stocks).length) {
    const previous = readJson(file, null);
    if (previous && previous.stocks && Object.keys(previous.stocks).length) {
      console.warn('No daily returns were produced; preserving the last valid sector snapshot.');
      return { payload: previous, changed: false, skipped: true };
    }
    throw new Error('No daily returns were produced; refusing to publish an empty sector snapshot.');
  }
  const changed = writePayload(file, payload);
  console.log('Sector daily: ' + Object.keys(payload.stocks).length + '/' + stocks.length +
    ' stocks with monthly returns; ' + (changed ? 'updated' : 'unchanged') + ' ' + path.relative(ROOT, file) + '.');
  return { payload, changed, skipped: false };
}

function main() {
  const result = buildFile({});
  if (!Object.keys(result.payload.stocks).length) {
    console.warn('No monthly returns were produced; keeping the previous sector summary if present.');
  }
}

module.exports = {
  shiftMonth,
  seriesFromMonthlyBars,
  seriesFromDailyBars,
  dailyReturns,
  stockDaily,
  buildPayload,
  buildFile,
  writePayload
};

if (require.main === module) main();
