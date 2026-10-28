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


test('ST 股票不能通过纪律全过筛选', () => {
  const result = Croc.screen(
    { name: 'ST 测试股', code: 'sz000001' },
    { price: 5, pe: 10, pb: 0.9, totalCap: 2e10 }
  );
  assert.equal(result.allPass, false);
  assert.ok(result.failed.some(item => item.key === 'st'));
});

test('TTM 亏损股票不能通过纪律全过筛选', () => {
  const result = Croc.screen(
    { name: '测试亏损股', code: 'sz000001' },
    { price: 5, pe: -3, pb: 0.9, totalCap: 2e10 }
  );
  assert.equal(result.allPass, false);
  assert.ok(result.failed.some(item => item.key === 'loss'));
});


test('股票池保持 67 只且新增的易普力保留在列表中', () => {
  const stocks = require('../stocks.json');
  assert.equal(stocks.length, 67);
  assert.ok(stocks.some(stock => stock.code === 'sz002096' && stock.name === '易普力'));
  const codes = stocks.map(stock => stock.code);
  assert.equal(new Set(codes).size, codes.length, '股票代码不得重复');
  assert.ok(codes.every(code => /^(sh|sz)\d{6}$/.test(code)), '股票代码格式应为 sh/sz + 6 位数字');
});


test('统一买入资格闸门：ST、亏损和未知 PE 均禁止给出买入资格', () => {
  assert.equal(Croc.buyEligibility({ name: 'ST 测试股' }, { pe: 8 }).eligible, false);
  assert.match(Croc.buyEligibility({ name: '测试亏损股' }, { pe: -1 }).reason, /亏损/);
  assert.match(Croc.buyEligibility({ name: '盈利未知股' }, { pe: null }).reason, /缺失/);
  assert.equal(Croc.buyEligibility({ name: '正常测试股' }, { pe: 8 }).eligible, true);
});

test('全过且买点筛选不把 ST 或未知盈利股纳入', () => {
  const quote = { price: 4, pe: 10, pb: 0.8, totalCap: 1e10 };
  const st = { name: 'ST 测试股', code: 'sz000001', entry: 5, heavy: 4 };
  assert.equal(Croc.matchStatus(st, quote, 'screenbuy'), false);
  const unknown = { name: '未知盈利股', code: 'sz000002', entry: 5, heavy: 4 };
  const unknownQuote = { ...quote, pe: null };
  assert.equal(Croc.matchStatus(unknown, unknownQuote, 'screenbuy'), false);
});
