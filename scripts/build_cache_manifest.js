#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const MANIFEST_FILE = path.join(DATA, 'cache', 'manifest.json');
const HEALTH_FILE = path.join(DATA, 'monitoring', 'latest.json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(path.relative(ROOT, file) + ': ' + error.message); }
}
function listFiles(target) {
  if (!fs.existsSync(target)) return [];
  if (fs.statSync(target).isFile()) return [target];
  return fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => listFiles(path.join(target, entry.name)));
}
function sourceFingerprint(relativePaths, dataDir) {
  const base = dataDir || DATA;
  const records = [];
  relativePaths.forEach(relative => {
    listFiles(path.join(base, relative)).forEach(file => records.push({
      path: path.relative(base, file).split(path.sep).join('/'),
      sha256: sha256(fs.readFileSync(file))
    }));
  });
  if (!records.length) throw new Error('No source files found: ' + relativePaths.join(', '));
  return sha256(JSON.stringify(records));
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = JSON.stringify(value, null, 2) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  const temp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
  return true;
}
function fileMetadata(relativePath, dataDir) {
  const raw = fs.readFileSync(path.join(dataDir || DATA, relativePath));
  const payload = JSON.parse(raw.toString('utf8'));
  return { payload, bytes: raw.length, dataVersion: sha256(raw), generatedAt: payload.generatedAt || payload.updatedAt || null };
}
function buildManifest(options) {
  const opts = options || {};
  const dataDir = opts.dataDir || DATA;
  const monitorDir = opts.monitoringDir || path.join(dataDir, 'monitoring');
  const manifestFile = opts.manifestFile || path.join(dataDir, 'cache', 'manifest.json');
  const healthFile = opts.healthFile || path.join(monitorDir, 'latest.json');
  const startedAt = opts.startedAt || new Date().toISOString();
  const previous = fs.existsSync(manifestFile) ? readJson(manifestFile) : null;
  const quotes = readJson(path.join(dataDir, 'stock-quotes.json'));
  const marketDate = quotes.marketDate || null;
  const definitions = [
    { id: 'market-quotes', type: 'market-snapshot', file: 'stock-quotes.json', sources: ['stock-quotes.json'],
      count: p => Object.keys(p.quotes || {}).length, freshness: p => p.status === 'ok' ? 'fresh' : 'stale' },
    { id: 'combat-kline', type: 'page-read-model', file: 'combat-kline.json', sources: ['stocks.json', 'stock-cache'],
      count: p => Object.keys(p.stocks || {}).length, freshness: p => p.marketDate && marketDate ? (p.marketDate === marketDate ? 'fresh' : 'stale') : 'unknown' },
    { id: 'research-scores', type: 'page-read-model', file: 'research-scores.json', sources: ['stocks.json', 'fundamentals.json', 'stock-cache', '../research-score.js'],
      count: p => Object.keys(p.scores || {}).length, freshness: p => p.marketDate && marketDate ? (p.marketDate === marketDate ? 'fresh' : 'stale') : 'unknown' },
    { id: 'sector-monthly', type: 'page-read-model', file: 'sector-monthly.json', sources: ['stocks.json', 'stock-quotes.json', 'stock-cache'],
      count: p => Object.keys(p.stocks || {}).length, freshness: p => p.marketDate && marketDate ? (p.marketDate === marketDate ? 'fresh' : 'stale') : 'unknown' }
  ];
  const caches = {};
  let totalBytes = 0, reusedCount = 0, staleCount = 0, unknownCount = 0;
  definitions.forEach(def => {
    const meta = fileMetadata(def.file, dataDir);
    const sourceVersion = sourceFingerprint(def.sources, dataDir);
    const freshness = def.freshness(meta.payload);
    const status = freshness === 'stale' ? 'stale' : (freshness === 'unknown' ? 'unknown' : 'healthy');
    const old = previous && previous.caches && previous.caches[def.id];
    if (old && old.dataVersion === meta.dataVersion) reusedCount += 1;
    if (status === 'stale') staleCount += 1;
    if (status === 'unknown') unknownCount += 1;
    totalBytes += meta.bytes;
    caches[def.id] = {
      cacheType: def.type, path: 'data/' + def.file,
      generatedAt: meta.generatedAt, quoteSnapshotUpdatedAt: quotes.updatedAt || null,
      marketDate: meta.payload.marketDate || marketDate, recordCount: def.count(meta.payload),
      bytes: meta.bytes, dataVersion: meta.dataVersion, sourceVersion, freshness, status
    };
  });
  const changed = !previous || JSON.stringify(previous.caches) !== JSON.stringify(caches);
  const generatedAt = changed ? (opts.now || new Date().toISOString()) : previous.generatedAt;
  const manifest = { schemaVersion: 1, generatedAt, marketDate, caches };
  const completedAt = opts.completedAt || new Date().toISOString();
  const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs :
    Math.max(0, Date.parse(completedAt) - Date.parse(startedAt));
  const cacheCount = definitions.length;
  const health = {
    schemaVersion: 1, status: staleCount ? 'stale' : (unknownCount ? 'degraded' : 'healthy'),
    generatedAt: completedAt, manifestGeneratedAt: generatedAt, marketDate, durationMs,
    cacheCount, healthyCount: cacheCount - staleCount - unknownCount, staleCount, unknownCount,
    reusedCount, contentReuseRate: cacheCount ? Number((reusedCount / cacheCount * 100).toFixed(1)) : 0,
    totalBytes, caches: Object.entries(caches).map(([id, v]) => ({
      id, status: v.status, freshness: v.freshness, recordCount: v.recordCount, bytes: v.bytes
    }))
  };
  const manifestChanged = atomicWrite(manifestFile, manifest);
  const healthChanged = manifestChanged || !fs.existsSync(healthFile) ? atomicWrite(healthFile, health) : false;
  if (opts.writeSummary !== false && process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## Static cache build', '', '- Status: **' + health.status + '**',
      '- Market date: ' + (marketDate || 'unknown'), '- Duration: ' + durationMs + ' ms',
      '- Healthy caches: ' + health.healthyCount + '/' + cacheCount,
      '- Content reuse: ' + health.contentReuseRate + '% (not CDN HIT/MISS)',
      '- Total bytes: ' + totalBytes, '', '| Cache | Status | Records | Bytes |', '| --- | --- | ---: | ---: |',
      ...health.caches.map(v => '| ' + v.id + ' | ' + v.status + ' | ' + v.recordCount + ' | ' + v.bytes + ' |')];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  console.log('Static cache manifest: ' + JSON.stringify(health));
  return { manifest, health, changed: manifestChanged || healthChanged, manifestChanged, healthChanged };
}
if (require.main === module) {
  try { buildManifest(); }
  catch (error) { console.error('Static cache manifest failed: ' + (error.stack || error.message)); process.exitCode = 1; }
}
module.exports = { sha256, sourceFingerprint, atomicWrite, buildManifest };
