const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('应用 JavaScript 文件均可通过语法解析', () => {
  for (const file of ['croc.js', 'quotes.js', 'pinyin.js', 'indicators.js', 'stock.js', 'business.js', 'sw.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' 语法错误');
  }
});

test('首页内嵌 JavaScript 均可通过语法解析', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  assert.ok(scripts.length > 0, '应找到首页内嵌脚本');
  scripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: 'index.html:inline-script-' + index }),
      '首页内嵌脚本 #' + index + ' 语法错误'
    );
  });
});
