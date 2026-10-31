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


test('首页不展示已移除的年初价、纪律、机器评分和独立研报日期列', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const key of ['yearInit', 'screen', 'researchMachine', 'researchDate']) {
    assert.doesNotMatch(html, new RegExp('data-sort="' + key + '"'), key + ' 不应再有表头');
  }
  assert.match(html, /data-sort="researchReport"/);
});


test('首页脚本使用版本化 URL，避免浏览器继续执行旧缓存', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
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


test('首页工具栏仅保留搜索框，分组列位于倒数第三且名称列不显示价格区间状态', () => {
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
  assert.ok(nameColumn >= 0 && priceColumn > nameColumn && groupColumn > priceColumn, '分组列应位于倒数第三列之前的主体列之后');
  assert.match(dashboard, /function statusHtml/);
  const statusStart = dashboard.indexOf('function statusHtml(');
  const statusEnd = dashboard.indexOf('function flagHtml(', statusStart);
  assert.ok(statusStart >= 0 && statusEnd > statusStart, '未找到名称列状态渲染函数');
  const statusFunction = dashboard.slice(statusStart, statusEnd);
  assert.doesNotMatch(statusFunction, /接近重仓|重仓区|入场区|高于入场|待确认/);
  assert.ok(dashboard.indexOf('<td class="stacked-cell">${researchReportHtml(stock)}</td>') < dashboard.indexOf('<td>${stock.group'), '分组单元格应位于研报评分之后');
  assert.ok(dashboard.indexOf('<td>${stock.group') < dashboard.indexOf('<td>${aliasHtml}'), '分组单元格应位于别名之前');
  assert.equal(dashboard.includes("$('group-filter')") || dashboard.includes("$('status-filter')"), false);
});

test('首页表格每行数据单元格数量与表头一致', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
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


test('首页月线盈亏颜色以入场价为唯一基准：盈利红、亏损绿、持平或缺失灰', () => {
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  const start = dashboard.indexOf('function monthlyTrendHtml(stock)');
  const end = dashboard.indexOf('\nfunction statusHtml(', start);
  assert.ok(start >= 0 && end > start, '未找到首页月线渲染函数');
  const renderer = dashboard.slice(start, end);
  assert.match(renderer, /currentPrice > entry[\s\S]*monthly-trend-profit/);
  assert.match(renderer, /currentPrice < entry[\s\S]*monthly-trend-loss/);
  assert.match(renderer, /当前价等于入场价，盈亏持平/);
  assert.match(renderer, /monthly-trend-neutral/);
  assert.doesNotMatch(renderer, /stock\.tp1|takeProfit|monthly-trend-above-target/);
});


test('商品页手机端趋势图横向铺满且按容器尺寸自适应', () => {
  const html = fs.readFileSync(path.join(root, 'products.html'), 'utf8');
  const products = fs.readFileSync(path.join(root, 'products.js'), 'utf8');
  assert.ok(html.includes('#product-cards{margin-left:-16px;margin-right:-16px'));
  assert.ok(html.includes('.product-chart{height:230px;width:calc(100% + 16px);margin-left:-8px;margin-right:-8px'));
  assert.ok(products.includes("new ResizeObserver(function(){try{chart.resize();}catch(e){}})"));
  assert.ok(products.includes('observer.observe(node)'));
  assert.ok(products.includes('observer.disconnect()'));
});


test('商品页趋势图不显示 Tooltip 悬浮提示', () => {
  const products = fs.readFileSync(path.join(root, 'products.js'), 'utf8');
  assert.doesNotMatch(products, /tooltip\s*:/i);
});


test('商品页趋势图隐藏水平网格线', () => {
  const products = fs.readFileSync(path.join(root, 'products.js'), 'utf8');
  assert.match(products, /splitLine:\{show:false\}/);
  assert.doesNotMatch(products, /splitLine:\{lineStyle:/);
});


test('商品页趋势图下方显示商品最高、最低、期初和当前价格', () => {
  const products = fs.readFileSync(path.join(root, 'products.js'), 'utf8');
  assert.match(products, /function productSummaryHtml\(series,unit\)/);
  for (const label of ['最高 ', '最低 ', '期初 ', '当前 ']) assert.ok(products.includes(label), '缺少价格统计：' + label);
  assert.match(products, /productSummaryHtml\(card\.productSeries,card\.unit\)/);
  assert.match(products, /point\.price!=null&&Number\.isFinite\(Number\(point\.price\)\)/);
});


test('商品页关联股票也显示最高、最低、期初和当前价格', () => {
  const products = fs.readFileSync(path.join(root, 'products.js'), 'utf8');
  assert.match(products, /productSummaryHtml\(stock\.values,'元\/股'\)/);
  assert.match(products, /commodity-stock[\s\S]*productSummaryHtml\(stock\.values,'元\/股'\)/);
});


test('商品趋势图不显示重叠的价格关键点标注', () => {
  const products = fs.readFileSync(path.join(root, 'products.js'), 'utf8');
  assert.doesNotMatch(products, /keyPriceMarks|markPoint/);
  assert.ok(products.includes('productSummaryHtml(card.productSeries,card.unit)'));
  assert.ok(products.includes('<table class="product-summary"'));
  assert.ok(products.includes('productSummaryHtml(stock.values,\'元/股\')'));
});
