'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const sector = require('../scripts/build_sector_monthly.js');

const MONTHS = [
  '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
  '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'
];

function monthlyBars(closes) {
  return closes.map((close, index) => ({
    time: MONTHS[index] + '-28',
    open: close,
    close,
    high: close,
    low: close,
    volume: 1000
  }));
}

test('shiftMonth 跨年回退', () => {
  assert.equal(sector.shiftMonth('2026-10', -1), '2026-09');
  assert.equal(sector.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(sector.shiftMonth('2026-10', -12), '2025-10');
  assert.equal(sector.shiftMonth('2026-03', -6), '2025-09');
  assert.equal(sector.shiftMonth('bad', -1), null);
});

test('monthlyReturns 按月末收盘计算近1/3/6/12个月涨跌幅', () => {
  const closes = MONTHS.map((_, index) => 100 + index * 10);
  const values = sector.monthlyReturns(sector.seriesFromMonthlyBars(monthlyBars(closes)));
  assert.equal(values.month, '2026-10');
  assert.equal(values.close, 220);
  assert.equal(values.months, 13);
  assert.equal(values.m1, 4.76);   // 220 / 210 - 1
  assert.equal(values.m3, 15.79);  // 220 / 190 - 1
  assert.equal(values.m6, 37.5);   // 220 / 160 - 1
  assert.equal(values.m12, 120);   // 220 / 100 - 1
});

test('缺少基准月份时返回 null，而不是 0', () => {
  const closes = MONTHS.slice(1).map((_, index) => 200 + index);
  const values = sector.monthlyReturns(sector.seriesFromMonthlyBars(monthlyBars(closes)));
  assert.equal(values.m1, 0.48);   // 211 / 210 - 1
  assert.equal(values.m12, null, '注册前的月份不能被当成 0 涨跌');
  assert.ok(values.m3 != null);
});

test('日线聚合成月线时取每月最后一个收盘', () => {
  const daily = [
    { time: '2026-08-30', close: 10 },
    { time: '2026-08-31', close: 12 },
    { time: '2026-09-30', close: 15 },
    { time: '2026-10-09', close: 18 },
    { time: '2026-10-29', close: 20 }
  ];
  const series = sector.seriesFromDailyBars(daily);
  assert.deepEqual(series, [
    { month: '2026-08', close: 12 },
    { month: '2026-09', close: 15 },
    { month: '2026-10', close: 20 }
  ]);
  const values = sector.monthlyReturns(series);
  assert.equal(values.m1, 33.33); // 20 / 15 - 1
  assert.equal(values.m3, null);
});

test('月线覆盖到当月时优先用月线，落后于当月时改用日线聚合', () => {
  const fresh = {
    monthlyAdjusted: { bars: monthlyBars([10, 11, 12]) },
    dailyAdjusted: { bars: [
      { time: '2026-05-29', close: 90 },
      { time: '2026-06-30', close: 99 }
    ] }
  };
  const monthly = sector.stockMonthly(fresh, '2026-12');
  assert.equal(monthly.source, 'daily', '月线落后于当月时不能混用两套复权基准');
  assert.equal(monthly.close, 99);
  assert.equal(monthly.m1, 10); // 99 / 90 - 1

  const current = sector.stockMonthly({
    monthlyAdjusted: { bars: monthlyBars(MONTHS.map((_, index) => 100 + index * 10)) },
    dailyAdjusted: { bars: [] }
  }, '2026-10');
  assert.equal(current.source, 'monthly');
  assert.equal(current.m12, 120);
});

test('buildPayload 只保留有至少两个月收盘的股票', () => {
  const caches = {
    sh600111: { monthlyAdjusted: { bars: monthlyBars([100, 120, 130]) } },
    sz000001: { monthlyAdjusted: { bars: monthlyBars([100]) } },
    sh600000: {}
  };
  const payload = sector.buildPayload({
    stocks: [
      { code: 'sh600111' },
      { code: 'sz000001' },
      { code: 'sh600000' },
      { code: 'bad-code' }
    ],
    marketDate: '2025-12-31',
    updatedAt: '2026-01-01T00:00:00.000Z',
    readCache: code => caches[code] || null
  });
  assert.deepEqual(Object.keys(payload.stocks), ['sh600111']);
  assert.equal(payload.marketDate, '2025-12-31');
  assert.equal(payload.stocks.sh600111.months, 3);
  assert.equal(payload.stocks.sh600111.m1, 8.33); // 130 / 120 - 1
});
