#!/usr/bin/env node
'use strict';

// Build the 32-point research score summary consumed by the stock pages.
// The score only covers the four report criteria that can be recomputed from market
// data (market cap / consolidation / monthly-bottom position / bottom volume), so the
// browser never has to read 60+ per-stock caches just to show one column.
const fs = require('node:fs');
const path = require('node:path');
const ResearchScore = require('../research-score.js');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA, 'stock-cache');
const STOCKS_FILE = path.join(DATA, 'stocks.json');
const QUOTES_FILE = path.join(DATA, 'stock-quotes.json');
const FUNDAMENTALS_FILE = path.join(DATA, 'fundamentals.json');
const SCORES_FILE = path.join(DATA, 'research-scores.json');

const CRITERIA = {
  owner: '实际控制人性质：央企 10 分 / 省级国资 9.5 / 地市国资 7.5 / 其他 5.5',
  cap: '总市值 ≤100 亿 10 分，100-200 亿 6.5 分，200 亿以上按对数衰减至 3 分',
  focus: '单一品类主营收入占比 × 10 + 1.5，夹在 2-10 分',
  profit: '最近两个年报扣非净利同比：连续 >100% 满分，亏损或大幅下滑给低分',
  consolidation: '近 36 个月收盘箱体：高度 ≤20% 且高点距今 ≥24 个月得满分',
  bottom: '全历史收盘分位 0.6 + 52 周位置 0.4，位置越低分越高',
  volume: '近 6 个月月均量 ÷ 之前 36 个月月均量，量比 0.6 起算、3.0 满分'
};

const WEIGHTS = ResearchScore.CONFIG.weights;
const TOTAL_MAX = WEIGHTS.cap + WEIGHTS.consolidation + WEIGHTS.bottom + WEIGHTS.volume;

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}

/** 一只股票的评分；数据不足返回 null，不返回 0 分。 */
function scoreOfCache(cache, fundamentals) {
  if (!cache || typeof cache !== 'object') return null;
  const detail = cache.detail || {};
  const fund = fundamentals || {};
  const result = ResearchScore.compute({
    cap: detail.totalCap,
    price: detail.price,
    high52: detail.high52,
    low52: detail.low52,
    daily: cache.dailyAdjusted && cache.dailyAdjusted.bars,
    weekly: cache.weeklyAdjusted && cache.weeklyAdjusted.bars,
    monthly: cache.monthlyAdjusted && cache.monthlyAdjusted.bars,
    ownerType: fund.ownerType,
    mainRatio: fund.mainRatio,
    annual: fund.annual
  });
  if (result.points === null) return null;
  return {
    items: {
      owner: round(result.items.owner, 1),
      cap: round(result.items.cap, 1),
      focus: round(result.items.focus, 1),
      profit: round(result.items.profit, 1),
      consolidation: round(result.items.consolidation, 1),
      bottom: round(result.items.bottom, 1),
      volume: round(result.items.volume, 1)
    },
    points: result.points,
    max: result.max,
    percent: result.percent,
    complete: result.complete,
    band: result.band ? result.band.key : null,
    metrics: {
      ownerType: result.metrics.ownerType,
      owner: fund.owner || null,
      capYi: round(result.metrics.capYi, 0),
      mainRatio: round(result.metrics.mainRatio, 3),
      mainItem: fund.mainItem || null,
      profitYoy: round(result.metrics.profitYoy, 1),
      priorProfitYoy: round(result.metrics.priorProfitYoy, 1),
      boxHeight: round(result.metrics.boxHeight, 3),
      months: result.metrics.months,
      position: round(result.metrics.position, 3),
      pAll: round(result.metrics.pAll, 1),
      p52: round(result.metrics.p52, 1),
      volRatio: round(result.metrics.volRatio, 2)
    }
  };
}

function buildPayload(options) {
  const opts = options || {};
  const stocks = Array.isArray(opts.stocks) ? opts.stocks : [];
  const fundamentals = opts.fundamentals && opts.fundamentals.stocks ? opts.fundamentals.stocks : (opts.fundamentals || {});
  const readCache = typeof opts.readCache === 'function'
    ? opts.readCache
    : code => {
      try { return JSON.parse(fs.readFileSync(path.join(opts.cacheDir || CACHE_DIR, code + '.json'), 'utf8')); }
      catch (_) { return null; }
    };
  const scores = {};
  stocks.forEach(stock => {
    const code = String(stock && stock.code || '').trim().toLowerCase();
    if (!/^(sh|sz)\d{6}$/.test(code)) return;
    const score = scoreOfCache(readCache(code), fundamentals[code]);
    if (score) scores[code] = score;
  });
  return {
    schemaVersion: 1,
    updatedAt: opts.updatedAt || new Date().toISOString(),
    marketDate: opts.marketDate || null,
    totalMax: TOTAL_MAX,
    weights: WEIGHTS,
    bands: ResearchScore.CONFIG.bands.map(band => ({
      key: band.key,
      min: Number.isFinite(band.min) ? band.min : null,
      label: band.label
    })),
    criteria: CRITERIA,
    scores
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

/** Refresh data/research-scores.json from the per-stock caches + fundamentals. */
function buildFile(options) {
  const opts = options || {};
  const stocks = Array.isArray(opts.stocks) ? opts.stocks : readJson(STOCKS_FILE, []);
  const quotes = opts.quotes || readJson(QUOTES_FILE, {});
  const fundamentals = opts.fundamentals || readJson(FUNDAMENTALS_FILE, {});
  const payload = buildPayload({
    stocks,
    fundamentals,
    marketDate: opts.marketDate || quotes.marketDate || null,
    updatedAt: opts.updatedAt,
    cacheDir: opts.cacheDir || CACHE_DIR,
    readCache: opts.readCache
  });
  const file = opts.file || SCORES_FILE;
  if (!Object.keys(payload.scores).length) {
    const previous = readJson(file, null);
    if (previous && previous.scores && Object.keys(previous.scores).length) {
      console.warn('No research scores were produced; preserving the last valid score snapshot.');
      return { payload: previous, changed: false, skipped: true };
    }
    throw new Error('No research scores were produced; refusing to publish an empty score snapshot.');
  }
  const changed = writePayload(file, payload);
  console.log('Research scores: ' + Object.keys(payload.scores).length + '/' + stocks.length +
    ' stocks scored; ' + (changed ? 'updated' : 'unchanged') + ' ' + path.relative(ROOT, file) + '.');
  return { payload, changed, skipped: false };
}

function main() {
  const result = buildFile({});
  if (!Object.keys(result.payload.scores).length) {
    console.warn('No research scores were produced; keeping the previous summary if present.');
  }
}

module.exports = {
  CRITERIA,
  TOTAL_MAX,
  scoreOfCache,
  buildPayload,
  buildFile,
  writePayload
};

if (require.main === module) main();
