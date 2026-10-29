const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const reports = require('../data/research-reports.json');
const stocks = require('../data/stocks.json');

test('研报评分表：每只股票都有分数、日期与来源', () => {
  const codes = Object.keys(reports.reports);
  assert.ok(codes.length > 20, '研报评分表不应为空');
  for (const code of codes) {
    const item = reports.reports[code];
    assert.match(code, /^(sh|sz)\d{6}$/, code + ' 代码格式错误');
    assert.ok(typeof item.name === 'string' && item.name.length > 0, code + ' 缺少名称');
    assert.ok(item.score > 0 && item.score <= 100, code + ' 分数应在 0-100');
    assert.match(item.date, /^\d{4}-\d{2}-\d{2}$/, code + ' 日期格式应为 YYYY-MM-DD');
    assert.ok(!Number.isNaN(new Date(item.date + 'T00:00:00').getTime()), code + ' 日期无效');
    assert.ok(typeof item.source === 'string' && item.source.length > 4, code + ' 缺少来源文件');
  }
});

test('研报评分表：代码不重复，且都在股票池内', () => {
  const codes = Object.keys(reports.reports);
  assert.equal(new Set(codes).size, codes.length, '代码不得重复');
  const pool = new Set(stocks.map(stock => stock.code));
  const outside = codes.filter(code => !pool.has(code));
  assert.deepEqual(outside, [], '研报评分只统计股票池内的股票');
});

test('研报评分表：备选分数（如中国中冶自制版）字段完整', () => {
  Object.entries(reports.reports).forEach(([code, item]) => {
    (item.alternates || []).forEach(alt => {
      assert.ok(alt.score > 0 && alt.score <= 100, code + ' 备选分数越界');
      assert.match(alt.date, /^\d{4}-\d{2}-\d{2}$/, code + ' 备选日期格式错误');
      assert.ok(alt.source, code + ' 备选来源缺失');
    });
  });
});

test('研报分档表覆盖 0-100 全区间', () => {
  const bands = reports.bands.slice().sort((a, b) => b.min - a.min);
  assert.equal(bands[bands.length - 1].min, 0, '最后一档应从 0 起');
  const label = value => bands.find(band => value >= band.min).label;
  assert.equal(label(95), '绝佳买入机会');
  assert.equal(label(85), '稀有买入机会');
  assert.equal(label(75), '合理买入机会');
  assert.equal(label(60), '等待区间');
});
