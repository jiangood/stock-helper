const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/router.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');

test('路由模块可作为原生 ES Module 加载', async () => {
  const router = await import(moduleUrl);
  assert.equal(typeof router.createRouter, 'function');
  assert.equal(typeof router.resolveRoute, 'function');
});

test('根路径和 Hash 路由解析正确', async () => {
  const { resolveRoute } = await import(moduleUrl);
  assert.equal(resolveRoute({ pathname: '/' }).name, 'stocks');
  assert.equal(resolveRoute({ pathname: '/index.html' }).name, 'stocks');
  assert.equal(resolveRoute({ hash: '#/market' }).name, 'market');
  assert.equal(resolveRoute({ hash: '#/products' }).name, 'products');
  assert.equal(resolveRoute({ hash: '#/health' }).name, 'health');
});

test('个股代码规范化并拒绝非法代码', async () => {
  const { normalizeStockCode, resolveRoute } = await import(moduleUrl);
  assert.equal(normalizeStockCode('600519'), 'sh600519');
  assert.equal(normalizeStockCode('002408'), 'sz002408');
  assert.equal(normalizeStockCode('SZ002408'), 'sz002408');
  assert.equal(normalizeStockCode('abc'), null);
  assert.deepEqual(resolveRoute({ hash: '#/stock/002408' }).params, { code: 'sz002408' });
  assert.equal(resolveRoute({ hash: '#/stock/not-a-code' }).name, 'not-found');
});

test('旧 HTML 地址兼容映射到对应页面', async () => {
  const { resolveRoute } = await import(moduleUrl);
  assert.equal(resolveRoute({ pathname: '/market.html' }).name, 'market');
  assert.equal(resolveRoute({ pathname: '/products.html' }).name, 'products');
  assert.equal(resolveRoute({ pathname: '/health.html' }).name, 'health');
  assert.deepEqual(
    resolveRoute({ pathname: '/stock.html', search: '?code=sz002408' }).params,
    { code: 'sz002408' }
  );
  assert.equal(resolveRoute({ pathname: '/stock.html', search: '' }).name, 'not-found');
});

test('Router 只监听一次 hashchange，并支持停止与重新启动', async () => {
  const { createRouter } = await import(moduleUrl);
  const listeners = new Map();
  const fakeWindow = {
    location: { pathname: '/', search: '', hash: '' },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); }
  };
  const changes = [];
  const router = createRouter({ window: fakeWindow, onRouteChange: next => changes.push(next.name) });
  router.start();
  router.start();
  assert.deepEqual(changes, ['stocks']);
  fakeWindow.location.hash = '#/market';
  listeners.get('hashchange')();
  assert.deepEqual(changes, ['stocks', 'market']);
  router.stop();
  assert.equal(listeners.has('hashchange'), false);
  router.start();
  assert.equal(listeners.has('hashchange'), true);
});
