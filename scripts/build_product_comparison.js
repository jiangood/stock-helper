#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
const stocks = readJson('data/stocks.json');
const mapping = readJson('data/stock-products.json').byCode || {};
const business = readJson('data/business-data.json');
const outputPath = path.join(ROOT, 'data/product-comparison.json');

function validPoint(point) {
  return point && /^\d{4}-\d{2}-\d{2}$/.test(String(point.date || '')) &&
    Number.isFinite(Number(point.value)) && Number(point.value) > 0;
}
function monthKey(date) { return String(date).slice(0, 7); }
function monthlyLast(points) {
  const byMonth = new Map();
  (Array.isArray(points) ? points : []).forEach((point) => {
    if (!validPoint(point)) return;
    const month = monthKey(point.date);
    const old = byMonth.get(month);
    if (!old || point.date > old.date) byMonth.set(month, { month, date: point.date, value: Number(point.value) });
  });
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
}
function stockMonthly(code) {
  const file = path.join(ROOT, 'data', 'stock-cache', code + '.json');
  if (!fs.existsSync(file)) return [];
  let cache;
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
  let bars = cache.monthlyAdjusted && Array.isArray(cache.monthlyAdjusted.bars) ? cache.monthlyAdjusted.bars : [];
  let source = '月K';
  if (bars.length < 2) {
    bars = cache.weeklyAdjusted && Array.isArray(cache.weeklyAdjusted.bars) ? cache.weeklyAdjusted.bars : [];
    source = '周K月末收盘聚合';
  }
  return monthlyLast(bars.map((bar) => ({ date: String(bar.time || '').slice(0, 10), value: Number(bar.close) })))
    .map((point) => ({ ...point, source }));
}
function productMonthly(item) {
  if (!item) return [];
  const series = Array.isArray(item.series) ? item.series : [];
  const points = series.map((point) => ({
    date: point.date,
    value: Number(point.spot) > 0 ? Number(point.spot) : Number(point.futures)
  }));
  return monthlyLast(points);
}
function normalizedComparison(productPoints, stockPoints) {
  const p = new Map(productPoints.map((point) => [point.month, point]));
  const s = new Map(stockPoints.map((point) => [point.month, point]));
  const months = Array.from(p.keys()).filter((month) => s.has(month)).sort();
  if (months.length < 2) return { months, series: [], status: 'insufficient-history' };
  const first = months[0];
  const pBase = p.get(first).value, sBase = s.get(first).value;
  if (!(pBase > 0 && sBase > 0)) return { months, series: [], status: 'invalid-base' };
  const series = months.map((month) => ({
    month,
    productIndex: Number((p.get(month).value / pBase * 100).toFixed(2)),
    stockIndex: Number((s.get(month).value / sBase * 100).toFixed(2)),
    productPrice: Number(p.get(month).value.toFixed(4)),
    stockClose: Number(s.get(month).value.toFixed(4))
  }));
  return { months, series, status: 'ready' };
}
function pct(first, last) {
  return first > 0 && last > 0 ? Number(((last / first - 1) * 100).toFixed(2)) : null;
}
function build() {
  const productItems = business.items || {};
  const cards = stocks.filter((stock) => stock && stock.code).map((stock) => {
    const meta = mapping[stock.code] || {};
    const market = meta.marketItemId ? productItems[meta.marketItemId] : null;
    const pSeries = productMonthly(market);
    const sSeries = stockMonthly(stock.code);
    const comparison = normalizedComparison(pSeries, sSeries);
    const first = comparison.series[0], last = comparison.series[comparison.series.length - 1];
    const productChange = first && last ? pct(first.productIndex, last.productIndex) : null;
    const stockChange = first && last ? pct(first.stockIndex, last.stockIndex) : null;
    let divergence = '数据不足';
    if (productChange !== null && stockChange !== null) {
      if (productChange * stockChange < 0) divergence = '方向背离';
      else if (Math.abs(productChange - stockChange) >= 15) divergence = '涨跌幅差异较大';
      else divergence = '走势大致同步';
    }
    const role = ['producer', 'consumer', 'mixed'].includes(meta.role) ? meta.role : 'unknown';
    const roleLabel = role === 'producer' ? '产品端' : role === 'consumer' ? '成本端' : role === 'mixed' ? '多因素' : '待核实';
    return {
      code: stock.code, name: stock.name, group: stock.group || '',
      productName: meta.productName || '主营产品映射待核实',
      marketItemId: meta.marketItemId || null,
      productUnit: market && market.unit || null,
      role, roleLabel, note: meta.note || '尚未完成主营产品与公开报价品种的核实，暂不生成商品价格比较。',
      productSource: market && market.source || null,
      productSourceUrl: market && market.sourceUrl || null,
      productDate: pSeries.length ? pSeries[pSeries.length - 1].date : null,
      stockDate: sSeries.length ? sSeries[sSeries.length - 1].date : null,
      stockSeriesSource: sSeries.length ? sSeries[sSeries.length - 1].source : null,
      productChange, stockChange, divergence,
      series: comparison.series,
      status: !meta.productName ? 'mapping-pending' : !market ? 'product-series-pending' : comparison.status
    };
  });
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    marketDate: business.updatedAt || null,
    stockCount: cards.length,
    mappedCount: cards.filter((card) => card.productName !== '主营产品映射待核实').length,
    comparableCount: cards.filter((card) => card.status === 'ready').length,
    cards
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
  console.log('Built product comparison:', payload.comparableCount + '/' + payload.stockCount, 'cards comparable;', payload.mappedCount, 'product mappings.');
  return payload;
}
if (require.main === module) build();
module.exports = { build, monthlyLast, normalizedComparison, productMonthly, stockMonthly };
