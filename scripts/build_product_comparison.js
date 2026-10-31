#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
const stocks = readJson('data/stocks.json');
const mapping = readJson('data/stock-products.json').byCode || {};
const business = readJson('data/business-data.json');
const fundamentals = readJson('data/fundamentals.json');
const companyProducts = readJson('data/company-products.json').products || [];
const outputPath = path.join(ROOT, 'data/product-comparison.json');

function validPoint(point) {
  return point && /^\d{4}-\d{2}(?:-\d{2})?$/.test(String(point.date || '')) &&
    Number.isFinite(Number(point.value)) && Number(point.value) > 0;
}
function monthKey(date) { return String(date).slice(0, 7); }
const MONTHLY_BAR_LIMIT = 200;
function monthlyLast(points) {
  const byMonth = new Map();
  (Array.isArray(points) ? points : []).forEach((point) => {
    if (!validPoint(point)) return;
    const month = monthKey(point.date);
    const old = byMonth.get(month);
    if (!old || point.date > old.date) byMonth.set(month, { month, date: point.date, value: Number(point.value) });
  });
  return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)).slice(-MONTHLY_BAR_LIMIT);
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
  return monthlyLast(bars.map((bar) => {
    const time = String(bar.time || '').trim();
    // 月 K 缓存同时存在 YYYY-MM 与 YYYY-MM-DD 两种合法格式；统一保留月份粒度。
    return { date: time.length === 7 && time[4] === '-' ? time : time.slice(0, 10), value: Number(bar.close) };
  }))
    .map((point) => ({ ...point, source }));
}
function productMonthly(item) {
  if (!item) return [];

  // Prefer the provider's native monthly OHLC close series. The business-data
  // collector already stores long-range monthlyKlines for continuous futures;
  // using only the 200-point daily spot series silently reduced history to ~7 months.
  const monthlyBars = item.monthlyKlines && Array.isArray(item.monthlyKlines.series)
    ? item.monthlyKlines.series : [];
  const monthlyPoints = monthlyLast(monthlyBars.map((bar) => ({
    date: bar.date,
    value: Number(bar.close)
  })));
  if (monthlyPoints.length >= 2) return monthlyPoints;

  // Fallback to daily spot/futures observations only when native monthly bars
  // are unavailable. monthlyLast keeps the last real observation in each month.
  const series = Array.isArray(item.series) ? item.series : [];
  const points = series.map((point) => ({
    date: point.date,
    value: Number(point.spot) > 0 ? Number(point.spot) : Number(point.futures)
  }));
  return monthlyLast(points);
}
function commodityMonthly(item) {
  if (!item) return { points: [], source: null, note: null };
  const itemName = String(item.name || '').trim();
  const candidates = companyProducts.filter((product) => {
    const sameName = String(product.productName || '').trim() === itemName;
    // A company's disclosed segment name may be broader than the market item
    // (e.g. "橡胶产品销售" vs. "天然橡胶"). The maintained marketItemId is the
    // explicit, reviewed link to the corresponding commodity price proxy.
    const sameMarketItem = Boolean(item.id) && product.marketItemId === item.id;
    return (sameName || sameMarketItem) &&
      Array.isArray(product.priceSeries) && product.priceSeries.length >= 2;
  }).sort((a, b) => b.priceSeries.length - a.priceSeries.length);
  if (candidates.length) {
    const selected = candidates[0];
    const points = monthlyLast(selected.priceSeries.map((point) => ({
      date: point.date || (point.month ? point.month + '-01' : ''),
      value: Number(point.price) / (item.id === 'live-hog' ? 1000 : 1)
    })));
    if (points.length >= 2) return {
      points,
      source: selected.priceKind || selected.priceSource || item.source || null,
      note: item.id === 'live-hog' ? [selected.priceNote, '生猪期货原始报价为元/吨，展示时已换算为元/公斤（÷1000）。'].filter(Boolean).join(' ') : (selected.priceNote || null)
    };
  }
  return {
    points: productMonthly(item),
    source: item.monthlyKlines && item.monthlyKlines.source || item.source || null,
    note: item.monthlyKlines && item.monthlyKlines.priceType === 'main-continuous-futures'
      ? '期货主力连续价格仅作商品价格参考，不等于企业实际采购到厂价；连续合约换月可能产生价差。'
      : null
  };
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
function latestSourceTimestamp() {
  const timestamps = [business.updatedAt];
  stocks.forEach((stock) => {
    if (!stock || !stock.code) return;
    const file = path.join(ROOT, 'data', 'stock-cache', stock.code + '.json');
    if (!fs.existsSync(file)) return;
    try {
      const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cache.updatedAt) timestamps.push(cache.updatedAt);
    } catch (_) { /* a malformed stock cache is handled as missing history */ }
  });
  const valid = timestamps.map((value) => Date.parse(value)).filter(Number.isFinite);
  return valid.length ? new Date(Math.max(...valid)).toISOString() : null;
}
function buildCommodityCards(productItems) {
  const grouped = new Map();
  Object.entries(mapping).forEach(([code, meta]) => {
    if (!meta || (!meta.marketItemId && !meta.costItemIds && !meta.additionalMarketItemIds)) return;
    const itemIds = [meta.marketItemId].concat(meta.additionalMarketItemIds || [], meta.costItemIds || []).filter(Boolean);
    const stock = stocks.find((item) => item.code === code);
    if (stock) itemIds.forEach((itemId) => { if (!grouped.has(itemId)) grouped.set(itemId, []); grouped.get(itemId).push({ stock, meta }); });
  });
  return Array.from(grouped.entries()).map(([itemId, related]) => {
    const market = productItems[itemId] || null;
    const marketMeta = related[0] && related[0].meta || {};
    const productName = market && market.name || (itemId === 'corn' ? '玉米' : itemId === 'soybean-meal' ? '豆粕' : (marketMeta.marketItemId === itemId ? marketMeta.productName : itemId));
    const productHistory = commodityMonthly(market);
    const productPoints = productHistory.points;
    const stocksWithHistory = related.map(({ stock, meta }) => {
      const history = stockMonthly(stock.code);
      const fundamental = fundamentals.stocks && fundamentals.stocks[stock.code] || {};
      const isCostInput = (meta.costItemIds || []).includes(itemId);
      const disclosedProduct = companyProducts
        .filter((product) => product.stockCode === stock.code && product.marketItemId === itemId &&
          product.ratioBasis === 'product' && product.revenueRatio !== null && product.revenueRatio !== undefined && Number.isFinite(Number(product.revenueRatio)))
        .sort((a, b) => String(b.reportDate || '').localeCompare(String(a.reportDate || '')))[0];
      const mappedItemCount = [meta.marketItemId].concat(meta.additionalMarketItemIds || [], meta.costItemIds || []).filter(Boolean).length;
      const fallbackRatio = mappedItemCount === 1 && fundamental.mainRatio !== null &&
        fundamental.mainRatio !== undefined && Number.isFinite(Number(fundamental.mainRatio))
        ? Number(fundamental.mainRatio) : null;
      const itemMainRatio = isCostInput ? null : disclosedProduct
        ? Number(disclosedProduct.revenueRatio) : fallbackRatio;
      return {
        code: stock.code, name: stock.name, group: stock.group || '',
        role: isCostInput ? 'consumer' : (meta.role || 'unknown'),
        roleLabel: isCostInput ? '成本端' : meta.role === 'producer' ? '产品端' : meta.role === 'consumer' ? '成本端' : meta.role === 'mixed' ? '多因素' : '待核实',
        mainRatio: itemMainRatio,
        source: history.length ? history[history.length - 1].source : null,
        history
      };
    });
    // 只保留主营产品收入占比达到 50% 的关联公司；占比未知时暂时保留，避免因数据缺失误删。
    // 成本端指标不属于主营产品收入占比口径，继续作为独立成本参考展示。
    const qualifiedStocks = stocksWithHistory.filter((stock) =>
      stock.role === 'consumer' || stock.mainRatio === null || stock.mainRatio >= 0.5
    );
    if (!qualifiedStocks.length) return null;
    const availableStocks = qualifiedStocks.filter((stock) => stock.history.length);
    const hasProductHistory = productPoints.length > 0;
    const stockOnlyMonths = !hasProductHistory
      ? Array.from(new Set(qualifiedStocks.flatMap((stock) => stock.history.map((point) => point.month)))).sort().slice(-MONTHLY_BAR_LIMIT)
      : [];
    const commonMonths = hasProductHistory
      ? productPoints.map((point) => point.month).filter((month) =>
          availableStocks.every((stock) => stock.history.some((point) => point.month === month))
        ).sort().slice(-MONTHLY_BAR_LIMIT)
      : stockOnlyMonths;
    const productMap = new Map(productPoints.map((point) => [point.month, point]));
    const firstMonth = commonMonths[0];
    const productBase = firstMonth && productMap.get(firstMonth) ? productMap.get(firstMonth).value : null;
    const productSeries = commonMonths.length >= 2 && productBase > 0 ? commonMonths.map((month) => ({
      month,
      index: Number((productMap.get(month).value / productBase * 100).toFixed(2)),
      price: Number(productMap.get(month).value.toFixed(4))
    })) : [];
    const stockSeries = qualifiedStocks.map((stock) => {
      const historyMap = new Map(stock.history.map((point) => [point.month, point]));
      const base = hasProductHistory
        ? (firstMonth && historyMap.get(firstMonth) ? historyMap.get(firstMonth).value : null)
        : (stock.history.length ? stock.history[0].value : null);
      const values = commonMonths.length >= 2 && base > 0 ? commonMonths.map((month) => {
        const point = historyMap.get(month);
        return {
          month,
          index: point ? Number((point.value / base * 100).toFixed(2)) : null,
          price: point ? Number(point.value.toFixed(4)) : null
        };
      }) : [];
      const validValues = values.filter((point) => point.price !== null);
      const first = validValues[0], last = validValues[validValues.length - 1];
      return {
        code: stock.code, name: stock.name, group: stock.group, role: stock.role,
        roleLabel: stock.roleLabel, mainRatio: stock.mainRatio, source: stock.source,
        latestDate: stock.history.length ? stock.history[stock.history.length - 1].date : null,
        latestClose: stock.history.length ? stock.history[stock.history.length - 1].value : null,
        changePct: first && last ? pct(first.price, last.price) : null,
        values
      };
    });
    const latestProduct = productPoints[productPoints.length - 1] || null;
    // 即使没有足够历史序列，也保留采集器提供的最新有效现货/参考报价。
    const marketLatest = market && [market.latestSpot, market.latest].map(Number).find((value) => Number.isFinite(value) && value > 0);
    const latestPrice = latestProduct ? latestProduct.value : (marketLatest === undefined ? null : marketLatest);
    const ready = hasProductHistory && commonMonths.length >= 2 && qualifiedStocks.every((stock) => stock.history.length > 0);
    const stockOnlyReady = !hasProductHistory && stockSeries.some((stock) => stock.values.filter((point) => point.price !== null).length >= 2);
    return {
      id: itemId, name: productName, unit: market && market.unit || (itemId === 'corn' || itemId === 'soybean-meal' ? '元/吨' : (marketMeta.marketItemId === itemId ? marketMeta.unit : '')) || '',
      source: productHistory.source || null, sourceNote: productHistory.note || null, sourceUrl: market && market.sourceUrl || null,
      latestPrice,
      latestDate: latestProduct ? latestProduct.date : market && market.latestDate || null,
      productChange: productSeries.length >= 2 ? pct(productSeries[0].price, productSeries[productSeries.length - 1].price) : null,
      months: commonMonths, productSeries, stocks: stockSeries,
      status: ready ? 'ready' : stockOnlyReady ? 'stock-only' : 'pending',
      note: [productHistory.note].concat(related.map(({ meta }) => meta.note).filter(Boolean))
        .concat(stockOnlyReady ? ['商品历史月线尚未接入；图表仅展示关联股票前复权月K，各股票分别以自身首月归一化为100，不代表商品与股票价格比较。'] : [])
        .filter(Boolean).join(' ')
    };
  }).filter(Boolean).sort((a, b) => {
    // 商品列表先按关联公司的行业周期观察顺序排列：化工优先；
    // 同一行业优先级内，再按历史数据覆盖度排序，避免把覆盖度误当成周期位置。
    const cyclePriority = (card) => {
      // 用户重点关注的生猪与民爆周期品种单独前置，避免被农业/民爆大类排序压后。
      const itemPriorities = { 'live-hog': 1, 'industrial-explosives': 2 };
      if (Object.prototype.hasOwnProperty.call(itemPriorities, card.id)) return itemPriorities[card.id];
      const priorities = {
        '化工': 0, '农药': 3, '农业': 4, '有色': 5, '稀土钨': 6,
        '贵金属': 7, '钢铁': 8, '能源': 9, '新材料': 10, '轻工': 11,
        '食品': 12, '动保': 13, '民爆': 14, '装备': 15, '军工': 16
      };
      const groups = (card.stocks || []).map((stock) => stock.group).filter(Boolean);
      return groups.length
        ? Math.min(...groups.map((group) => Object.prototype.hasOwnProperty.call(priorities, group) ? priorities[group] : 99))
        : 99;
    };
    const leftPriority = cyclePriority(a), rightPriority = cyclePriority(b);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    // 同行业内保留原有排序：可用历史序列更多、覆盖月份更广的排前面。
    const coverage = (card) => {
      const series = [card.productSeries].concat((card.stocks || []).map((stock) => stock.values || []));
      const available = series.filter((points) => Array.isArray(points) && points.length >= 2);
      return {
        seriesCount: available.length,
        pointCount: available.reduce((total, points) => total + points.length, 0),
        hasLatestQuote: card.latestPrice !== null && card.latestPrice !== undefined
      };
    };
    const left = coverage(a), right = coverage(b);
    if (left.seriesCount !== right.seriesCount) return right.seriesCount - left.seriesCount;
    if (left.pointCount !== right.pointCount) return right.pointCount - left.pointCount;
    if (left.hasLatestQuote !== right.hasLatestQuote) return Number(right.hasLatestQuote) - Number(left.hasLatestQuote);
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}
function build() {
  const productItems = business.items || {};
  const cards = stocks.filter((stock) => stock && stock.code).map((stock) => {
    const meta = mapping[stock.code] || {};
    const fundamental = fundamentals.stocks && fundamentals.stocks[stock.code] || {};
    const productName = meta.productName || fundamental.mainItem || '主营产品映射待核实';
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
      productName,
      mainRatio: fundamental.mainRatio !== null && fundamental.mainRatio !== undefined && Number.isFinite(Number(fundamental.mainRatio)) && Number(fundamental.mainRatio) >= 0 && Number(fundamental.mainRatio) <= 1 ? Number(fundamental.mainRatio) : null,
      mainBasis: fundamental.mainBasis || null,
      fundamentalDate: fundamental.mainDate || null,
      marketItemId: meta.marketItemId || null,
      productUnit: market && market.unit || null,
      role, roleLabel, note: meta.note || (fundamental.mainItem ? '主营构成参考公开基本面数据；该产品对应的公开月度报价尚未核实或接入。' : '尚未完成主营产品映射，暂不生成商品价格比较。'),
      productSource: market && market.source || null,
      productSourceUrl: market && market.sourceUrl || null,
      productDate: pSeries.length ? pSeries[pSeries.length - 1].date : null,
      stockDate: sSeries.length ? sSeries[sSeries.length - 1].date : null,
      stockSeriesSource: sSeries.length ? sSeries[sSeries.length - 1].source : null,
      productChange, stockChange, divergence,
      series: comparison.series,
      status: productName === '主营产品映射待核实' ? 'mapping-pending' : !market ? 'product-series-pending' : comparison.status
    };
  });
  const commodityCards = buildCommodityCards(productItems);
  const payload = {
    schemaVersion: 2,
    generatedAt: latestSourceTimestamp(),
    marketDate: business.updatedAt || null,
    stockCount: cards.length,
    mappedCount: cards.filter((card) => card.productName !== '主营产品映射待核实').length,
    comparableCount: cards.filter((card) => card.status === 'ready').length,
    commodityCount: commodityCards.length,
    commodityCards,
    cards
  };
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + '\n');
  console.log('Built product comparison:', payload.comparableCount + '/' + payload.stockCount, 'stock cards;', payload.commodityCards.length, 'commodity cards.');
  return payload;
}
if (require.main === module) build();
module.exports = { build, monthlyLast, normalizedComparison, productMonthly, stockMonthly };
