'use strict';

// Aggregate forward-adjusted daily bars into calendar-month OHLCV bars.
// This is a fallback only when the provider's native adjusted monthly series is absent.
function aggregateDailyToMonthly(dailyBars, limit = 240) {
  if (!Array.isArray(dailyBars)) return [];
  const sorted = dailyBars
    .filter(bar => bar && /^\\d{4}-\\d{2}-\\d{2}$/.test(String(bar.time || '')) &&
      ['open', 'high', 'low', 'close'].every(key => Number.isFinite(Number(bar[key])) && Number(bar[key]) > 0))
    .slice()
    .sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const months = new Map();
  for (const bar of sorted) {
    const month = String(bar.time).slice(0, 7);
    let item = months.get(month);
    if (!item) {
      item = { time: month, open: Number(bar.open), high: Number(bar.high),
        low: Number(bar.low), close: Number(bar.close), volume: 0 };
      if (Number.isFinite(Number(bar.amount))) item.amount = 0;
      months.set(month, item);
    }
    item.high = Math.max(item.high, Number(bar.high));
    item.low = Math.min(item.low, Number(bar.low));
    item.close = Number(bar.close);
    if (Number.isFinite(Number(bar.volume))) item.volume += Number(bar.volume);
    if (item.amount !== undefined && Number.isFinite(Number(bar.amount))) item.amount += Number(bar.amount);
  }
  return Array.from(months.values()).slice(-Math.max(1, Number(limit) || 240));
}

module.exports = { aggregateDailyToMonthly };
