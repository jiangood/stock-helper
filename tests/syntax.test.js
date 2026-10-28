const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('应用 JavaScript 文件均可通过语法解析', () => {
  for (const file of ['croc.js', 'quotes.js', 'pinyin.js', 'indicators.js', 'stock.js', 'business.js', 'global-assets.js', 'quasar-shell.js', 'stock-dashboard.js', 'sw.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' 语法错误');
  }
});

test('首页引用的本地脚本与内嵌 JavaScript 均可通过语法解析', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const localScripts = scripts
    .map(match => {
      const src = (match[1].match(/\bsrc=["']([^"']+)["']/i) || [])[1];
      return src && !/^https?:\/\//i.test(src) ? src : null;
    })
    .filter(Boolean);
  const inlineScripts = scripts.map(match => match[2].trim()).filter(Boolean);
  assert.ok(localScripts.length > 0, '应找到首页引用的本地脚本');
  localScripts.forEach(src => {
    const file = path.resolve(root, src.replace(/^\.\//, ''));
    assert.ok(fs.existsSync(file), '脚本文件不存在：' + src);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: src }),
      src + ' 语法错误'
    );
  });
  inlineScripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: 'index.html:inline-script-' + index }),
      '首页内嵌脚本 #' + index + ' 语法错误'
    );
  });
});
