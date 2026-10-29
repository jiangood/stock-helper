'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateStocks, validateQuotes, validateBars, validateFundamentals
} = require('../scripts/validate_stock_data');

const stocks = [
  { name: '示例A', group: '测试', code: 'sh600000', entry: 10, heavy: 9, tp1: null, tp2: null, yearInit: null, prevChg: null },
  { name: '示例B', group: '测试', code: 'sz000001', entry: 12, heavy: 11, tp1: 15, tp2: 18, yearInit: 10, prevChg: 1.2 }
];

test('stock master validates required fields and unique codes', () => {
  assert.equal(validateStocks(stocks).size, 2);
  assert.throws(() => validateStocks([...stocks, stocks[0]]), /duplicate stock code/);
  assert.throws(() => validateStocks([{ ...stocks[0], code: '600000' }]), /code is invalid/);
  assert.throws(() => validateStocks([{ ...stocks[0], entry: NaN }]), /finite or null/);
});

test('quote snapshot validates schema, prices, finite metrics and coverage', () => {
  const payload = {
    schemaVersion: 1, status: 'ok', marketDate: '2026-10-29',
    quotes: {
      sh600000: { code: 'sh600000', price: 10.2, pe: null, pb: 1.1 },
      sz000001: { code: 'sz000001', price: 12.3, pe: 8.2, pb: 0.9 }
    }
  };
  assert.equal(validateQuotes(payload, new Set(['sh600000', 'sz000001'])).coverage, 1);
  assert.throws(() => validateQuotes({ ...payload, quotes: { sh600000: { price: 0 } } }, new Set(['sh600000', 'sz000001'])), /invalid price/);
  assert.throws(() => validateQuotes({ ...payload, quotes: { sh600000: { code: 'sz000001', price: 10 } } }, new Set(['sh600000'])), /mismatch/);
  assert.throws(() => validateQuotes({ ...payload, quotes: { sh600000: { price: 10 } } }, new Set(['sh600000', 'sz000001'])), /coverage below 70%/);
});

test('K-line bars reject malformed OHLC and accept valid bars', () => {
  const valid = [{ time: '2026-10-29', open: 10, close: 11, high: 12, low: 9, volume: 100 }];
  assert.equal(validateBars(valid, 'fixture'), 1);
  assert.throws(() => validateBars([{ ...valid[0], high: 10.5 }], 'fixture'), /inconsistent OHLC/);
  assert.throws(() => validateBars([{ ...valid[0], close: Infinity }], 'fixture'), /positive finite/);
});

test('fundamentals retain explicit nulls but reject unknown classifications and invalid annuals', () => {
  const payload = { stocks: {
    sh600000: { ownerType: 'province', mainRatio: 1.2, mainBasis: 'product', annual: [{ date: '2025-12-31', yoy: -12.5, value: null }] },
    sz000001: { ownerType: null, mainRatio: null, annual: [] }
  } };
  assert.equal(validateFundamentals(payload, new Set(['sh600000', 'sz000001'])), 2);
  assert.throws(() => validateFundamentals({ stocks: { sh600000: { ownerType: 'unknown' } } }), /ownerType/);
  assert.throws(() => validateFundamentals({ stocks: { sh600000: { annual: [{ date: '2025-06-30' }] } } }), /annual date/);
});
