'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('核心 JavaScript 文件均可通过语法解析', () => {
  const files = [
    'croc.js',
    'research-score.js',
    'quotes.js',
    'static-quotes.js',
    'scripts/fetch_stock_snapshot.js',
    'scripts/build_sector_monthly.js',
    'scripts/build_research_scores.js',
    'scripts/build_product_comparison.js',
    'scripts/build_stock_detail_cache.js',
    'scripts/build_cache_manifest.js',
    'scripts/monthly_kline.js',
    'pinyin.js',
    'indicators.js',
    'stock.js',
    'products.js',
    'business.js',
    'stock-dashboard.js'
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' 语法错误');
  }
});
