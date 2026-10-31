const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('首页名称首列宽度保持紧凑', () => {
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  assert.match(css, /\.stock-table thead th:first-child,[\s\S]*?width: 88px; min-width: 88px; max-width: 88px;/);
});

test('应用 JavaScript 文件均可通过语法解析', () => {
  for (const file of ['croc.js', 'research-score.js', 'quotes.js', 'static-quotes.js', 'scripts/fetch_stock_snapshot.js', 'scripts/build_sector_monthly.js', 'scripts/build_research_scores.js', 'pinyin.js', 'indicators.js', 'stock.js', 'business.js', 'stock-dashboard.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotThrow(() => new vm.Script(source, { filename: file }), file + ' 语法错误');
  }
});

test('网页行情入口只使用同源静态缓存适配器', () => {
  for (const file of ['legacy-stocks.html', 'legacy-stock.html']) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(html, /<script src="static-quotes\.js"><\/script>/, file + ' 未加载静态行情适配器');
    assert.doesNotMatch(html, /<script src="quotes\.js"><\/script>/, file + ' 仍加载外部行情 SDK');
  }
  const adapter = fs.readFileSync(path.join(root, 'static-quotes.js'), 'utf8');
  assert.doesNotMatch(adapter, /push2(?:delay|his)?\.eastmoney\.com|qt\.gtimg\.cn|ifzq\.gtimg\.cn/, '浏览器静态适配器不应包含外部行情源');
});

test('首页内嵌 JavaScript 均可通过语法解析', () => {
  const html = fs.readFileSync(path.join(root, 'legacy-stocks.html'), 'utf8');
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


test('首页不展示已移除的年初价、纪律、机器评分和独立研报日期列', () => {
  const html = fs.readFileSync(path.join(root, 'legacy-stocks.html'), 'utf8');
  for (const key of ['yearInit', 'screen', 'researchMachine', 'researchDate']) {
    assert.doesNotMatch(html, new RegExp('data-sort="' + key + '"'), key + ' 不应再有表头');
  }
  assert.match(html, /data-sort="researchReport"/);
});


test('首页脚本使用版本化 URL，避免浏览器继续执行旧缓存', () => {
  const html = fs.readFileSync(path.join(root, 'legacy-stocks.html'), 'utf8');
  assert.ok(html.includes('stock-dashboard.js?v='), '首页 dashboard 脚本必须带版本参数');
});

test('首页研报日期显示在研报评分下方', () => {
  const css = fs.readFileSync(path.join(root, 'app.css'), 'utf8');
  assert.match(css, /\.score-date\s*\{[^}]*display:\s*block/);
});

test('首页研报日期只显示发布日期，不标注旧或悬浮信息', () => {
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  const start = dashboard.indexOf('function researchDateHtml(');
  const end = dashboard.indexOf('function fmtScore(', start);
  assert.ok(start >= 0 && end > start, '未找到首页研报日期渲染函数');
  const renderer = dashboard.slice(start, end);
  assert.ok(renderer.includes('<span class="score-date">${esc(report.date)}</span>'));
  assert.doesNotMatch(renderer, /旧|title=|monthsSince|text-warning/);
});

test('研报评分 null 不参与数值渲染和筛选', () => {
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  assert.ok(dashboard.includes('report.score == null || !Number.isFinite(report.score)'), '研报评分必须排除 null');
  assert.equal(/(^|[^.])isFinite\(report\.score\)/m.test(dashboard), false);
  assert.equal(dashboard.includes('Number.Number.isFinite'), false);
});


test('首页工具栏仅保留搜索框，分组列紧跟股票名称且名称列不显示价格区间状态', () => {
  const html = fs.readFileSync(path.join(root, 'legacy-stocks.html'), 'utf8');
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
  assert.ok(dashboard.includes('<td>${stock.group'), '分组单元格应紧跟股票名称');
  assert.equal(dashboard.includes("$('group-filter')") || dashboard.includes("$('status-filter')"), false);
});

test('首页表格每行数据单元格数量与表头一致', () => {
  const html = fs.readFileSync(path.join(root, 'legacy-stocks.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  const headerStart = html.indexOf('<thead>');
  const headerEnd = html.indexOf('</thead>', headerStart);
  const rowStart = dashboard.indexOf('function buildRow(stock)');
  const rowEnd = dashboard.indexOf('\nfunction statusHtml(', rowStart);
  assert.ok(headerStart >= 0 && headerEnd > headerStart && rowStart >= 0 && rowEnd > rowStart, '未找到首页表格结构');
  const header = html.slice(headerStart, headerEnd);
  const rowRenderer = dashboard.slice(rowStart, rowEnd);
  const headerCells = (header.match(/<th\b/g) || []).length;
  const bodyCells = (rowRenderer.match(/<td\b/g) || []).length;
  assert.equal(bodyCells, headerCells, '首页表头与每行数据列数必须一致');
  assert.doesNotMatch(rowRenderer, /stock\.yearInit|screenHtml\(|researchMachineHtml\(/, '已移除的列不得残留在行渲染中');
});


test('首页是唯一 SPA 壳，旧多页面入口均转入 Hash 路由', () => {
  const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(shell, /<script type="module" src="src\/main\.js"><\/script>/);
  assert.match(shell, /id="app-view"/);
  assert.doesNotMatch(shell, /stock-dashboard\.js|business\.js|products\.js|stock\.js/);
  for (const [file, route] of [['market.html', '#\\/market'], ['products.html', '#\\/products'], ['health.html', '#\\/health']]) {
    const legacy = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(legacy.includes(route), file + ' 未转入 SPA 路由');
  }
  const stockRedirect = fs.readFileSync(path.join(root, 'stock.html'), 'utf8');
  assert.match(stockRedirect, /URLSearchParams/);
  assert.match(stockRedirect, /\\/stock\\//);
});

test('SPA 页面入口均由独立页面模块承接，旧脚本隔离在桥接页', () => {
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  for (const page of ['stocks', 'market', 'products', 'stock-detail', 'health']) {
    assert.ok(main.includes(page), 'SPA 未注册页面：' + page);
  }
  const bridge = fs.readFileSync(path.join(root, 'src/pages/legacy-page.js'), 'utf8');
  assert.match(bridge, /createElement\\('iframe'\\)|createElement\\("iframe"\\)/);
  assert.match(bridge, /addEventListener\\('click'/);
  assert.doesNotMatch(bridge, /innerHTML/);
});
