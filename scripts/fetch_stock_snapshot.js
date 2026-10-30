#!/usr/bin/env node
'use strict';

// Build same-origin, last-known-good snapshots for the value-investing UI.
// This script runs in GitHub Actions; browser pages must never call quote providers.
const fs = require('node:fs');
const path = require('node:path');
const StockQuotes = require('../quotes.js');
const sectorMonthly = require('./build_sector_monthly.js');
const researchScores = require('./build_research_scores.js');
const combatKline = require('./build_combat_kline.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA, 'stock-cache');
const QUOTES_FILE = path.join(DATA, 'stock-quotes.json');
const INDEX_FILE = path.join(DATA, 'index-cache.json');
const INDEX_CODES = ['sh000001', 'sz399001', 'sz399006'];
const MIN_QUOTE_COVERAGE = 0.8;
const MAX_CONCURRENCY = 4;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}
function writeIfChanged(file, payload, ignoreVolatileTime = false) {
  const previous = readJson(file, null);
  const comparable = value => {
    if (!value || typeof value !== 'object') return value;
    const clone = JSON.parse(JSON.stringify(value));
    delete clone.updatedAt;
    if (ignoreVolatileTime) {
      const strip = obj => {
        if (!obj || typeof obj !== 'object') return;
        delete obj.time;
        if (obj.quotes && typeof obj.quotes === 'object') Object.values(obj.quotes).forEach(strip);
        if (obj.details && typeof obj.details === 'object') Object.values(obj.details).forEach(strip);
        if (obj.detail) strip(obj.detail);
      };
      strip(clone);
    }
    return clone;
  };
  if (previous && JSON.stringify(comparable(previous)) === JSON.stringify(comparable(payload))) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return true;
}
async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { output[index] = await fn(items[index], index); }
      catch (error) { output[index] = { error: error && error.message ? error.message : String(error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}
function validBars(result, min = 10) {
  return !!(result && Array.isArray(result.bars) && result.bars.length >= min &&
    result.bars.every(bar => bar && Number(bar.open) > 0 && Number(bar.close) > 0 &&
      Number(bar.high) > 0 && Number(bar.low) > 0));
}
function quoteCode(code) { return StockQuotes.normalizeCode(code); }
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

async function main() {
  // Scheduled and code-push runs must not publish intraday snapshots.
  // Manual workflow_dispatch is an explicit operator override for backfills.
  if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Shanghai', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).map(part => [part.type, part.value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    if (parts.weekday === 'Sat' || parts.weekday === 'Sun' || minutes < 15 * 60 + 15) {
      console.log('Skipping stock collection before the China close window; the existing cache remains untouched.');
      return;
    }
  }

  const stocks = readJson(path.join(DATA, 'stocks.json'), []);
  if (!Array.isArray(stocks) || stocks.length === 0) throw new Error('data/stocks.json is missing or invalid');

  const codes = Array.from(new Set([
    ...stocks.map(item => quoteCode(item && item.code)).filter(Boolean)
  ]));
  const allCodes = Array.from(new Set([...codes, ...INDEX_CODES]));
  const client = new StockQuotes.Client({
    timeout: 12000,
    retries: 1,
    cacheTTL: 0,
    onError: error => console.warn('[quote SDK]', error.code, error.message)
  });

  const previousQuotes = readJson(QUOTES_FILE, { quotes: {} });
  console.log('Fetching snapshot for ' + codes.length + ' stock codes and ' + INDEX_CODES.length + ' indices.');
  let freshQuotes = {};
  try { freshQuotes = await client.fetch(allCodes, { force: true }); }
  catch (error) { console.error('Bulk quote fetch failed:', error.message); }

  const quotes = { ...(previousQuotes.quotes || {}) };
  Object.assign(quotes, freshQuotes);
  const freshStockCount = codes.filter(code => freshQuotes[code] && Number(freshQuotes[code].price) > 0).length;
  const coverage = freshStockCount / Math.max(codes.length, 1);
  console.log('Fresh stock quote coverage: ' + freshStockCount + '/' + codes.length + ' (' + Math.round(coverage * 100) + '%).');
  if (coverage < MIN_QUOTE_COVERAGE && Object.keys(previousQuotes.quotes || {}).length === 0) {
    throw new Error('Initial quote coverage too low (' + Math.round(coverage * 100) + '%); refusing to publish an incomplete first snapshot.');
  }
  if (Object.keys(quotes).length === 0) throw new Error('No fresh or cached quotes; preserving previous data.');

  const updatedAt = new Date().toISOString();
  const marketDate = Object.values(freshQuotes).map(q => q && q.time)
    .filter(Boolean).map(t => {
      const n = Number(t);
      const d = new Date(n > 1e12 ? n : n * 1000);
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }).filter(Boolean).sort().pop() || previousQuotes.marketDate || null;
  const chinaDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  const marketDateIsCurrent = !!marketDate && marketDate === chinaDate;
  const quotePayload = {
    schemaVersion: 1,
    updatedAt,
    marketDate,
    source: 'Eastmoney/Tencent via GitHub Actions',
    status: coverage >= MIN_QUOTE_COVERAGE && marketDateIsCurrent ? 'ok' : 'stale',
    quotes
  };
  if (coverage >= MIN_QUOTE_COVERAGE && !marketDateIsCurrent) {
    const changed = writeIfChanged(QUOTES_FILE, quotePayload, true);
    console.log(changed ? 'Marked quote snapshot stale.' : 'No new China market date; quote snapshot unchanged.');
    // 行情日未推进时缓存不变，但仍刷新板块月线汇总，确保文件存在且与缓存一致。
    sectorMonthly.buildFile({ stocks, marketDate, updatedAt, cacheDir: CACHE_DIR });
    combatKline.buildFile({ stocks, marketDate, updatedAt, cacheDir: CACHE_DIR });
    console.log('Skipping detail and K-line collection because the provider has not published a quote for today in China.');
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const results = await mapLimit(codes, MAX_CONCURRENCY, async code => {
    const file = path.join(CACHE_DIR, code + '.json');
    const previous = readJson(file, {});
    let detail = previous.detail || null;
    let dailyAdjusted = previous.dailyAdjusted || null;
    let dailyRaw = previous.dailyRaw || null;
    let weeklyAdjusted = previous.weeklyAdjusted || null;
    let weeklyFetchedFor = previous.weeklyFetchedFor || null;
    let monthlyAdjusted = previous.monthlyAdjusted || null;
    let monthlyFetchedFor = previous.monthlyFetchedFor || null;
    let detailFresh = false;

    try {
      const value = await client.fetchDetail(code, { force: true });
      if (value && Number(value.price) > 0) {
        detail = value;
        detailFresh = true;
      }
    } catch (error) {
      console.warn(code + ': detail unavailable; ' + (detail ? 'keeping cache' : 'will omit detail') + ' (' + error.message + ')');
    }

    const dayResults = await Promise.allSettled([
      client.fetchKline(code, { period: 'day', count: 250, adjust: 'qfq', force: true }),
      client.fetchKline(code, { period: 'day', count: 250, adjust: 'none', force: true })
    ]);
    if (dayResults[0].status === 'fulfilled' && validBars(dayResults[0].value)) dailyAdjusted = dayResults[0].value;
    else console.warn(code + ': adjusted daily K-line unavailable; keeping cache if present.');
    if (dayResults[1].status === 'fulfilled' && validBars(dayResults[1].value)) dailyRaw = dayResults[1].value;
    else console.warn(code + ': raw daily K-line unavailable; keeping cache if present.');

    const nowWeek = isoWeekKey();
    if (!weeklyAdjusted || weeklyFetchedFor !== nowWeek) {
      try {
        const value = await client.fetchKline(code, { period: 'week', count: 200, adjust: 'qfq', force: true });
        if (validBars(value, 6)) {
          weeklyAdjusted = value;
          weeklyFetchedFor = nowWeek;
        }
      } catch (error) {
        console.warn(code + ': weekly K-line unavailable; keeping cache if present (' + error.message + ')');
      }
    }

    // 月线也要跟着最新行情日刷新，否则当月那根月 K 整月停留在月初，板块月线强弱会滞后。
    if (!monthlyAdjusted || monthlyFetchedFor !== chinaDate) {
      try {
        const value = await client.fetchKline(code, { period: 'month', count: 240, adjust: 'qfq', force: true });
        if (validBars(value, 6)) {
          monthlyAdjusted = value;
          monthlyFetchedFor = chinaDate;
        }
      } catch (error) {
        console.warn(code + ': monthly K-line unavailable; keeping cache if present (' + error.message + ')');
      }
    }

    if (!detail && !dailyAdjusted && !dailyRaw && !monthlyAdjusted) return { code, skipped: true };
    const payload = {
      schemaVersion: 1,
      code,
      updatedAt,
      detail,
      dailyAdjusted,
      dailyRaw,
      weeklyAdjusted,
      weeklyFetchedFor,
      monthlyAdjusted,
      monthlyFetchedFor
    };
    const changed = writeIfChanged(file, payload, true);
    return { code, changed, detailFresh, hasDaily: !!dailyAdjusted, hasMonthly: !!monthlyAdjusted };
  });

  const good = results.filter(item => item && !item.error && !item.skipped);
  console.log('Stock caches: ' + good.length + '/' + codes.length + ' available; ' + good.filter(item => item.changed).length + ' changed.');
  if (good.length < Math.ceil(codes.length * 0.7)) {
    throw new Error('Too few valid stock caches; preserving existing data where possible.');
  }

  const quoteChanged = writeIfChanged(QUOTES_FILE, quotePayload, true);
  console.log(quoteChanged ? 'Updated data/stock-quotes.json' : 'Quotes unchanged; kept previous snapshot.');

  const previousIndex = readJson(INDEX_FILE, { monthly: {} });
  const monthly = { ...(previousIndex.monthly || {}) };
  await mapLimit(INDEX_CODES, 2, async code => {
    if (monthly[code] && monthly[code].fetchedFor === chinaDate) return;
    try {
      const value = await client.fetchKline(code, { period: 'month', count: 24, adjust: 'none', force: true });
      if (validBars(value, 6)) monthly[code] = { ...value, fetchedFor: chinaDate };
    } catch (error) {
      console.warn(code + ': index monthly history unavailable; keeping cache (' + error.message + ')');
    }
  });
  const indexPayload = { schemaVersion: 1, updatedAt, monthly };
  const indexChanged = writeIfChanged(INDEX_FILE, indexPayload, true);
  console.log(indexChanged ? 'Updated data/index-cache.json' : 'Index history unchanged; kept previous snapshot.');

  // Derived page read models are normally built by the dedicated static-cache workflow.
  // Keep the default enabled for local/manual runs; source collection Actions set SKIP_DERIVED=1.
  if (process.env.SKIP_DERIVED !== '1') {
    // Sector summary: monthly returns only; the page never downloads every stock cache.
    sectorMonthly.buildFile({ stocks, marketDate, updatedAt, cacheDir: CACHE_DIR });

    // Machine scores: precomputed summary for the home and detail pages.
    researchScores.buildFile({ stocks, marketDate, updatedAt, cacheDir: CACHE_DIR });

    // Combat page: latest 120 adjusted daily bars for the whole stock pool.
    combatKline.buildFile({ stocks, marketDate, updatedAt, cacheDir: CACHE_DIR });
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
