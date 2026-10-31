const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

class FakeNode {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.textContent = '';
    this.className = '';
    this.listeners = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
}

async function loadPage() {
  const root = path.join(__dirname, '..');
  const routerSource = fs.readFileSync(path.join(root, 'src/router.js'), 'utf8');
  const serviceSource = fs.readFileSync(path.join(root, 'src/services/products.service.js'), 'utf8');
  const routerUrl = 'data:text/javascript;base64,' + Buffer.from(routerSource).toString('base64');
  const serviceUrl = 'data:text/javascript;base64,' + Buffer.from(serviceSource).toString('base64');
  const source = fs.readFileSync(path.join(root, 'src/pages/products.page.js'), 'utf8')
    .replace("'../router.js'", "'" + routerUrl + "'")
    .replace("'../services/products.service.js'", "'" + serviceUrl + "'");
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

function findNode(node, predicate) {
  if (predicate(node)) return node;
  for (const child of node.children || []) {
    const found = findNode(child, predicate);
    if (found) return found;
  }
  return null;
}

test('商品页安全渲染商品卡片、股票路由链接和月线图', async () => {
  const { mount } = await loadPage();
  const documentLike = { createElement: tag => new FakeNode(tag) };
  const root = { ownerDocument: documentLike, children: [], replaceChildren(...nodes) { this.children = nodes; } };
  const listeners = {};
  const windowLike = {
    addEventListener(name, callback) { listeners[name] = callback; },
    removeEventListener(name) { delete listeners[name]; },
    matchMedia: () => ({ matches: true })
  };
  const chartCalls = [];
  const chartLibrary = {
    init(node) {
      chartCalls.push(node);
      return { setOption(option) { this.option = option; }, resize() {}, dispose() { chartCalls.disposed = true; } };
    }
  };
  const fetchImpl = async (url, options) => ({
    ok: true,
    json: async () => ({
      generatedAt: '2026-10-31T00:00:00Z',
      commodityCards: [{
        id: 'soda-ash',
        name: '纯碱',
        unit: '元/吨',
        latestPrice: 1200,
        status: 'ready',
        months: ['2026-09', '2026-10'],
        productChange: 2.5,
        productSeries: [{ index: 100, price: 1000 }, { index: 102.5, price: 1200 }],
        stocks: [{
          code: 'sz000707', name: '双环科技', values: [{ index: 100, price: 5 }, { index: 110, price: 5.5 }],
          latestClose: 5.5, latestDate: '2026-10', changePct: 10
        }]
      }]
    })
  });
  const cleanup = mount({ root, window: windowLike, fetchImpl, loadChartLibrary: async () => chartLibrary });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.ok(findNode(root, node => node.textContent === '纯碱'));
  const stockLink = findNode(root, node => node.tagName === 'A' && node.href === '#/stock/sz000707');
  assert.ok(stockLink);
  assert.equal(chartCalls.length, 1);
  assert.equal(listeners.resize instanceof Function, true);
  cleanup();
  assert.equal(chartCalls.disposed, true);
  assert.equal(listeners.resize, undefined);
  assert.equal(root.children.length, 0);
});

test('图表组件加载失败时仍保留商品数据卡片', async () => {
  const { mount } = await loadPage();
  const documentLike = { createElement: tag => new FakeNode(tag) };
  const root = { ownerDocument: documentLike, children: [], replaceChildren(...nodes) { this.children = nodes; } };
  const windowLike = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const cleanup = mount({
    root,
    window: windowLike,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        commodityCards: [{
          name: '尿素', months: ['2026-09', '2026-10'],
          productSeries: [{ index: 100, price: 100 }, { index: 101, price: 101 }],
          stocks: []
        }]
      })
    }),
    loadChartLibrary: async () => { throw new Error('CDN unavailable'); }
  });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(findNode(root, node => node.textContent === '尿素'));
  assert.ok(findNode(root, node => node.textContent.includes('图表组件暂不可用')));
  cleanup();
});
