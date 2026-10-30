const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('应用 JavaScript 文件均可通过语法解析', () => {
  for (const file of ['croc.js', 'research-score.js', 'quotes.js', 'static-quotes.js', 'scripts/fetch_stock_snapshot.js', 'scripts/build_sector_monthly.js', 'scripts/build_research_scores.js', 'pinyin.js', 'indicators.js', 'stock.js', 'business.js']) {
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


test('首页机器评分、研报评分和研报日期为独立可排序列', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  for (const key of ['researchMachine', 'researchReport', 'researchDate']) {
    assert.match(html, new RegExp('data-sort="' + key + '"'), key + ' 缺少独立表头');
    assert.match(dashboard, new RegExp("case '" + key + "'"), key + ' 缺少独立排序值');
  }
  assert.match(dashboard, /function researchMachineHtml/);
  assert.match(dashboard, /function researchReportHtml/);
  assert.match(dashboard, /function researchDateHtml/);
  assert.doesNotMatch(html, /data-sort="research"/);
});


test('首页机器评分遇到 null 缺失值时不崩溃且不伪造零分', () => {
  const dashboard = fs.readFileSync(path.join(root, 'stock-dashboard.js'), 'utf8');
  const machineHtml = dashboard.match(/function researchMachineHtml\\(stock\\) \\{[\\s\\S]*?\\n\\}/);
  const formatScore = dashboard.match(/function fmtScore\\(value\\) \\{[\\s\\S]*?\\n\\}/);
  assert.ok(machineHtml, '未找到机器评分渲染函数');
  assert.ok(formatScore, '未找到评分项格式化函数');

  const context = {
    researchScores: {},
    RESEARCH: { totalMax: 32, bands: [] },
    esc: value => String(value).replace(/[&<>"]/g, ''),
    Number
  };
  vm.runInNewContext(machineHtml[0] + '\\n' + formatScore[0], context);

  context.researchScores.nullPercent = {
    points: 38.2, max: 56, percent: null, items: { focus: null }
  };
  assert.match(
    context.researchMachineHtml({ code: 'nullPercent' }),
    /—/,
    '百分制分数为 null 时应显示缺失标记，不得调用 toFixed'
  );

  context.researchScores.partial = {
    points: 38.2, max: 56, percent: 68.2, band: 'mid',
    items: { owner: 10, focus: null, profit: 8.5, cap: 6.1, consolidation: 4, bottom: 5.7, volume: 4.4 }
  };
  const html = context.researchMachineHtml({ code: 'partial' });
  assert.match(html, /68\\.2/);
  assert.match(html, /主营 —\\/9/, '缺失的单项评分应显示 —，不能被格式化成 0.0');
});
