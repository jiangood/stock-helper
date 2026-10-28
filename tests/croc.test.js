const test = require('node:test');
const assert = require('node:assert/strict');
const Croc = require('../croc.js');

test('200 亿市值边界在评估和纪律筛选中保持一致', () => {
  const stock = { name: '测试股', code: 'sz000001', entry: 5, heavy: 4 };
  const quote = { price: 5, pe: 10, pb: 0.9, totalCap: 2e10 };

  assert.equal(Croc.evaluate(stock, quote).smallCap, true);
  const result = Croc.screen(stock, quote);
  const capCheck = result.checks.find(item => item.key === 'cap');
  assert.equal(capCheck.ok, true);
});

test('股票池体检会提示缺少计划复核日期', () => {
  const result = Croc.health([
    { name: '测试股', code: 'sz000001', entry: 5, heavy: 4 }
  ]);
  assert.ok(result.issues.some(item => item.text.includes('缺少计划更新时间')));
});

test('股票池体检会提示格式错误的计划日期', () => {
  const result = Croc.health([
    { name: '测试股', code: 'sz000001', entry: 5, heavy: 4, updDate: '2026-02-31' }
  ]);
  assert.ok(result.issues.some(item => item.text.includes('不是有效日期')));
});

test('股票池体检会提示超过 180 天未复核的计划价格', () => {
  const result = Croc.health([
    { name: '测试股', code: 'sz000001', entry: 5, heavy: 4, updDate: '2000-01-01' }
  ]);
  assert.ok(result.issues.some(item => item.text.includes('未复核')));
});
