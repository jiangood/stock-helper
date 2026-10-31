'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sector = require('../scripts/build_sector_monthly.js');

function dailyBars(count, start = 100, step = 1) {
  const first = new Date('2026-01-01T00:00:00Z');
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first.getTime() + index * 86400000).toISOString().slice(0, 10);
    const close = start + index * step;
    return { time: date, open: close, close, high: close, low: close, volume: 1000 };
  });
}

test('dailyReturns 使用最近最多 201 个交易日数据计算日线窗口', () => {
  const bars = dailyBars(240, 100, 1);
  const values = sector.dailyReturns(bars);
  assert.equal(values.bars, 201);
  assert.equal(values.date, bars[239].time);
  assert.equal(values.close, 339);
  assert.equal(values.d1, 0.3);
  assert.equal(values.d5, 1.5);
  assert.equal(values.d20, 6.27);
  assert.equal(values.d60, 21.51);
  assert.equal(values.d120, 54.79);
  assert.equal(values.d200, 143.88);
});

test('日线数据不足时不伪造长周期涨跌幅', () => {
  const values = sector.dailyReturns(dailyBars(30, 100, 1));
  assert.equal(values.d1, 0.78);
  assert.equal(values.d5, 4.03);
  assert.equal(values.d20, 18.35);
  assert.equal(values.d60, null);
  assert.equal(values.d120, null);
  assert.equal(values.d200, null);
});

test('无效日期、非正收盘价会被排除', () => {
  const bars = dailyBars(4);
  bars.push({ time: 'not-a-date', close: 999 });
  bars.push({ time: '2026-02-01', close: 0 });
  const values = sector.dailyReturns(bars);
  assert.equal(values.bars, 4);
  assert.equal(values.close, 103);
});

test('stockDaily 只使用复权日线，不回退月线', () => {
  const cache = {
    monthlyAdjusted: { bars: [{ time: '2026-01-31', close: 999 }] },
    dailyAdjusted: { bars: dailyBars(25) }
  };
  const values = sector.stockDaily(cache);
  assert.equal(values.source, 'daily');
  assert.equal(values.bars, 25);
  assert.equal(values.d20, 19.23);
  assert.equal(sector.stockDaily({ monthlyAdjusted: { bars: dailyBars(25) } }), null);
});

test('buildPayload 仅收录具有有效日线历史的股票', () => {
  const caches = {
    sh600111: { dailyAdjusted: { bars: dailyBars(40, 100, 2) } },
    sz000001: { dailyAdjusted: { bars: dailyBars(1) } },
    sh600000: { monthlyAdjusted: { bars: dailyBars(40) } }
  };
  const payload = sector.buildPayload({
    stocks: [{ code: 'sh600111' }, { code: 'sz000001' }, { code: 'sh600000' }, { code: 'bad-code' }],
    marketDate: '2026-02-09',
    updatedAt: '2026-02-10T00:00:00.000Z',
    readCache: code => caches[code] || null
  });
  assert.deepEqual(Object.keys(payload.stocks), ['sh600111']);
  assert.equal(payload.marketDate, '2026-02-09');
  assert.equal(payload.stocks.sh600111.d20, 28.99);
});
