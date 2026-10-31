const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadAppModule() {
  const root = path.join(__dirname, '..');
  const routerSource = fs.readFileSync(path.join(root, 'src/router.js'), 'utf8');
  const routerUrl = 'data:text/javascript;base64,' + Buffer.from(routerSource).toString('base64');
  const appSource = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8')
    .replace("'./router.js'", "'" + routerUrl + "'");
  return import('data:text/javascript;base64,' + Buffer.from(appSource).toString('base64'));
}

function createFakeEnvironment() {
  const listeners = new Map();
  const documentLike = {
    createElement() {
      return {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        textContent: ''
      };
    }
  };
  const root = {
    ownerDocument: documentLike,
    children: [],
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  };
  const windowLike = {
    document: documentLike,
    location: { pathname: '/', search: '', hash: '' },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name) { listeners.delete(name); },
    reportError(error) { throw error; }
  };
  return { root, windowLike, listeners };
}

test('SPA 应用按路由挂载页面并清理上一个页面', async () => {
  const { createApp } = await loadAppModule();
  const env = createFakeEnvironment();
  const calls = [];
  const pages = {
    stocks: async () => ({
      mount() { calls.push('stocks:mount'); return () => calls.push('stocks:cleanup'); },
      unmount() { calls.push('stocks:unmount'); }
    }),
    market: async () => ({
      mount() { calls.push('market:mount'); },
      unmount() { calls.push('market:unmount'); }
    })
  };
  const app = createApp({ root: env.root, window: env.windowLike, pages });
  app.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['stocks:mount']);

  env.windowLike.location.hash = '#/market';
  env.listeners.get('hashchange')();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['stocks:mount', 'stocks:cleanup', 'stocks:unmount', 'market:mount']);

  await app.stop();
  assert.deepEqual(calls.slice(-1), ['market:unmount']);
  assert.equal(env.listeners.has('hashchange'), false);
});

test('缺失页面显示可访问的未找到状态', async () => {
  const { createApp } = await loadAppModule();
  const env = createFakeEnvironment();
  const app = createApp({ root: env.root, window: env.windowLike });
  app.start();
  await new Promise(resolve => setImmediate(resolve));
  env.windowLike.location.hash = '#/unknown';
  env.listeners.get('hashchange')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.root.children[0].textContent, '页面不存在');
  await app.stop();
});
