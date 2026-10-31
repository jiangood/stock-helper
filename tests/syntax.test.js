const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('应用 JavaScript 文件均可通过语法解析', () => {
  for (const file of ['croc.js', 'research-score.js', 'quotes.js', 'static-quotes.js', 'scripts/fetch_stock_snapshot.js', 'scripts/build_sector_monthly.js', 'scripts/build_research_scores.js', 'pinyin.js', 'indicators.js', 'stock.js', 'business.js', 'stock-dashboard.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' 语法错误');
  }
});

test('网页行情入口只使用同源静态缓存适配器', () => {
  for (const file of ['index.html', 'stock.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /<script src="static-quotes\.js"><\/script>/, file + ' 未加载静态行情适配器');
    assert.doesNotMatch(html, /<script src="quotes\.js"><\/script>/, file + ' 仍加载外部行情 SDK');
  }
  const adapter = fs.readFileSync(path.join(root, 'static-quotes.js'), 'utf8');
  assert.doesNotMatch(adapter, /push2(?:delay|his)?\.eastmoney\.com|qt\.gtimg\.cn|ifzq\.gtimg\.cn/, '浏览器静态适配器不应包含外部行情源');
});

test('首页内嵌 JavaScript 均可通过语法解析', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
  // 首页可以完全使用外部脚本；仅在存在内嵌脚本时检查其语法。
  scripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: 'index.html:inline-script-' + index }),
      '首页内嵌脚本 #' + index + ' 语法错误'
    );
  });
});


test('首页不展示已移除的年初价、纪律和机器评分列', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const key of ['yearInit', 'screen', 'researchMachine']) {
    assert.doesNotMatch(html, new RegExp('data-sort="' + key + '"'), key + ' 不应再有表头');
  }
  assert.match(html, /data-sort="researchReport"/);
  assert.match(html, /data-sort="researchDate"/);
});


test('首页脚本使用版本化 URL，避免浏览器继续执行旧缓存', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('stock-dashboard.js?v='), '首页 dashboard 脚本必须带版本参数');
});

test('研报评分 null 不参与数值渲染和筛选', () => {
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  assert.ok(dashboard.includes('report.score == null || !Number.isFinite(report.score)'), '研报评分必须排除 null');
  assert.equal(/(^|[^.])isFinite\(report\.score\)/m.test(dashboard), false);
  assert.equal(dashboard.includes('Number.Number.isFinite'), false);
});


test('首页工具栏仅保留搜索框，分组列紧跟股票名称且名称列不显示价格区间状态', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  const toolbarStart = html.indexOf('<div id="stock-toolbar"');
  const toolbarEnd = html.indexOf('<main id="stocks-pane"', toolbarStart);
  const toolbar = html.slice(toolbarStart, toolbarEnd);
  assert.ok(toolbar.includes('id="search-input"'));
  assert.doesNotMatch(toolbar, /stock-count|board-summary|group-filter|status-filter|<select/);
  const nameColumn = html.indexOf('id="th-name"');
  const groupColumn = html.indexOf('id="th-group"');
  const priceColumn = html.indexOf('id="th-price"');
  assert.ok(nameColumn >= 0 && groupColumn > nameColumn && priceColumn > groupColumn, '名称、分组、价格列顺序不正确');
  assert.match(dashboard, /function statusHtml/);
  const statusStart = dashboard.indexOf('function statusHtml(');
  const statusEnd = dashboard.indexOf('function flagHtml(', statusStart);
  assert.ok(statusStart >= 0 && statusEnd > statusStart, '未找到名称列状态渲染函数');
  const statusFunction = dashboard.slice(statusStart, statusEnd);
  assert.doesNotMatch(statusFunction, /接近重仓|重仓区|入场区|高于入场|待确认/);
  assert.match(dashboard, /<td>\\$\\{stock\\.group/);
  assert.doesNotMatch(dashboard, /\\$\\('(group-filter|status-filter)'\\)/);
});
