'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
global.TechInd = require('../indicators.js');
require('../trade-signals.js');
const Signals = global.StockTradeSignals;

test('add-signal score includes RSI and MACD confirmations', () => {
  const bars = Array.from({ length: 120 }, (_, i) => {
    const close = 20 + i * 0.03 + Math.sin(i / 3) * 1.5;
    return { open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 1000 + i * 2 };
  });
  const result = Signals.evaluateAdd(bars[bars.length - 1].close, { heavy: bars[bars.length - 1].close }, bars);
  assert.equal(result.scoreMax, 5);
  assert.ok(result.score >= 0 && result.score <= 5);
  assert.ok(result.confirmations);
  assert.equal(typeof result.confirmations.rsi, 'boolean');
  assert.equal(typeof result.confirmations.macd, 'boolean');
  assert.ok(Number.isFinite(result.rsi));
  assert.ok(result.macd && Number.isFinite(result.macd.dif));
  assert.ok(result.reasons.some(reason => reason.includes('RSI(14)')));
  assert.ok(result.reasons.some(reason => reason.includes('MACD')));
});
