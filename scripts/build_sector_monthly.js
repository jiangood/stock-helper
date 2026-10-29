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

/**
 * Monthly returns relative to the last point in the series.
 * m1 is month-to-date when the last bar belongs to the current market month.
 * Missing base months return null instead of 0 so the page can flag thin data.
 */
function monthlyReturns(series) {
  const points = Array.isArray(series) ? series.filter(point =>
    point && monthKey(point.month) && Number(point.close) > 0) : [];
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const byMonth = new Map(points.map(point => [point.month, point.close]));
  const pct = monthsBack => {
    const base = byMonth.get(shiftMonth(last.month, -monthsBack));
    if (!(Number(base) > 0)) return null;
    return round((last.close / Number(base) - 1) * 100);
  };
  return {
    month: last.month,
    close: round(last.close),
    m1: pct(1),
    m3: pct(3),
    m6: pct(6),
    m12: pct(12),
    months: points.length
  };
}

/**
 * Pick the cleanest month series for one cached stock:
 * monthly bars when they already reach the market month, otherwise daily bars
 * aggregated by month (mixing both series would break the adjustment baseline).
 */
function stockMonthly(cache, marketMonth) {
  if (!cache || typeof cache !== 'object') return null;
  const monthly = seriesFromMonthlyBars(cache.monthlyAdjusted && cache.monthlyAdjusted.bars);
  const latestMonthly = monthly.length ? monthly[monthly.length - 1].month : null;
  if (latestMonthly && marketMonth && latestMonthly >= marketMonth) {
    const values = monthlyReturns(monthly);
    return values ? Object.assign({ source: 'monthly' }, values) : null;
  }
  const daily = seriesFromDailyBars(cache.dailyAdjusted && cache.dailyAdjusted.bars);
  const values = monthlyReturns(daily);
  return values ? Object.assign({ source: 'daily' }, values) : null;
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
    const values = stockMonthly(readCache(code), marketMonth);
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
  const changed = writePayload(file, payload);
  console.log('Sector monthly: ' + Object.keys(payload.stocks).length + '/' + stocks.length +
    ' stocks with monthly returns; ' + (changed ? 'updated' : 'unchanged') + ' ' + path.relative(ROOT, file) + '.');
  return { payload, changed };
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
  monthlyReturns,
  stockMonthly,
  buildPayload,
  buildFile,
  writePayload
};

if (require.main === module) main();
