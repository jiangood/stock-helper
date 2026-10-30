#!/usr/bin/env node
'use strict';

// Build compact per-stock bundles for the detail page plus a lightweight peer valuation index.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const LIMITS = { dailyAdjusted: 250, dailyRaw: 250, weeklyAdjusted: 200, monthlyAdjusted: 240 };

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return fallback; }
}
function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function getBars(cache, key, limit) {
  const value = cache && cache[key];
  return value && Array.isArray(value.bars) ? value.bars.slice(-limit) : [];
}
function writeStable(file, payload) {
  const previous = readJson(file, null);
  const stable = value => {
    if (!isObject(value)) return value;
    const copy = JSON.parse(JSON.stringify(value));
    delete copy.updatedAt;
    return copy;
  };
  if (previous && JSON.stringify(stable(previous)) === JSON.stringify(stable(payload))) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(payload) + '\n', { encoding: 'utf8', flag: 'w' });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
  return true;
}
function buildFile(options) {
  const opts = options || {};
  const dataDir = opts.dataDir || DATA;
  const stocks = opts.stocks || readJson(path.join(dataDir, 'stocks.json'), []);
  const quotes = opts.quotes || readJson(path.join(dataDir, 'stock-quotes.json'), {});
  const sourceDir = opts.cacheDir || path.join(dataDir, 'stock-cache');
  const outputDir = opts.outputDir || path.join(dataDir, 'cache', 'stocks');
  const indexFile = opts.indexFile || path.join(dataDir, 'cache', 'stock-details.json');
  const updatedAt = opts.updatedAt || new Date().toISOString();
  const marketDate = opts.marketDate || quotes.marketDate || null;
  const quoteMap = quotes.quotes || {};
  const bundles = [];
  const details = {};

  (Array.isArray(stocks) ? stocks : []).forEach(stock => {
    const code = String(stock && stock.code || '').trim().toLowerCase();
    if (!/^(sh|sz)\d{6}$/.test(code)) return;
    const source = readJson(path.join(sourceDir, code + '.json'), null);
    const quote = quoteMap[code] || {};
    const sourceDetail = source && isObject(source.detail) ? source.detail : {};
    if (!Object.keys(sourceDetail).length && !Object.keys(quote).length) return;

    const detail = Object.assign({}, quote, sourceDetail);
    detail.code = detail.code || code;
    detail.name = detail.name || stock.name || code.slice(2);
    if (detail.price === undefined || detail.price === null) detail.price = quote.price === undefined ? null : quote.price;
    if (detail.peTtm === undefined || detail.peTtm === null) {
      detail.peTtm = detail.pe ?? quote.peTtm ?? quote.pe ?? null;
    }
    if (detail.pb === undefined || detail.pb === null) detail.pb = quote.pb === undefined ? null : quote.pb;

    const data = {
      detail,
      dailyAdjusted: { bars: getBars(source, 'dailyAdjusted', LIMITS.dailyAdjusted) },
      dailyRaw: { bars: getBars(source, 'dailyRaw', LIMITS.dailyRaw) },
      weeklyAdjusted: { bars: getBars(source, 'weeklyAdjusted', LIMITS.weeklyAdjusted) },
      monthlyAdjusted: { bars: getBars(source, 'monthlyAdjusted', LIMITS.monthlyAdjusted) }
    };
    bundles.push({
      file: path.join(outputDir, code + '.json'),
      payload: { schemaVersion: 1, cacheType: 'stock-detail', code, updatedAt, marketDate, data }
    });
    details[code] = {
      code,
      name: detail.name,
      price: detail.price === undefined ? null : detail.price,
      peTtm: detail.peTtm,
      pb: detail.pb
    };
  });

  const minimum = Math.max(1, Math.ceil((Array.isArray(stocks) ? stocks.length : 0) * 0.7));
  if (bundles.length < minimum) {
    throw new Error('Stock detail cache coverage below 70% (' + bundles.length + '/' +
      (Array.isArray(stocks) ? stocks.length : 0) + '); refusing to publish partial detail caches.');
  }

  fs.mkdirSync(outputDir, { recursive: true });
  let changedFiles = 0;
  bundles.forEach(item => { if (writeStable(item.file, item.payload)) changedFiles += 1; });

  const activeFiles = new Set(bundles.map(item => path.basename(item.file)));
  fs.readdirSync(outputDir, { withFileTypes: true }).forEach(entry => {
    if (entry.isFile() && entry.name.endsWith('.json') && !activeFiles.has(entry.name)) {
      fs.rmSync(path.join(outputDir, entry.name), { force: true });
    }
  });

  const index = {
    schemaVersion: 1,
    cacheType: 'stock-detail-index',
    updatedAt,
    marketDate,
    sourceUpdatedAt: quotes.updatedAt || null,
    details
  };
  const indexChanged = writeStable(indexFile, index);
  const totalBytes = bundles.reduce((sum, item) => sum + fs.statSync(item.file).size, 0);
  console.log('Stock detail caches: ' + bundles.length + '/' + stocks.length +
    ' bundles; ' + Object.keys(details).length + ' peer records; ' + totalBytes +
    ' bytes; ' + (changedFiles + (indexChanged ? 1 : 0)) + ' files changed.');
  return {
    bundleCount: bundles.length,
    indexCount: Object.keys(details).length,
    changedFiles: changedFiles + (indexChanged ? 1 : 0),
    totalBytes,
    marketDate
  };
}

if (require.main === module) {
  try { buildFile(); }
  catch (error) {
    console.error('Stock detail cache build failed: ' + (error.stack || error.message));
    process.exitCode = 1;
  }
}
module.exports = { LIMITS, buildFile, getBars, writeStable };
