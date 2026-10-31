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
    this.hidden = false;
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  replaceChildren(...nodes) { this.children = nodes; }
}

async function loadPage() {
  const root = path.join(__dirname, '..');
  const serviceSource = fs.readFileSync(path.join(root, 'src/services/cache-health.service.js'), 'utf8');
  const serviceUrl = 'data:text/javascript;base64,' + Buffer.from(serviceSource).toString('base64');
  const pageSource = fs.readFileSync(path.join(root, 'src/pages/health.page.js'), 'utf8')
    .replace("'../services/cache-health.service.js'", "'" + serviceUrl + "'");
  return import('data:text/javascript;base64,' + Buffer.from(pageSource).toString('base64'));
}

function findText(node, text) {
  if (node.textContent === text) return node;
  for (const child of node.children || []) {
    const found = findText(child, text);
    if (found) return found;
  }
  return null;
}

test('健康页以 DOM 节点渲染缓存指标并能卸载', async () => {
  const { mount } = await loadPage();
  const originalFetch = global.fetch;
  global.fetch = async url => ({
    ok: true,
    json: async () => url.includes('manifest')
      ? { schemaVersion: 1, marketDate: '2026-10-30', caches: { quotes: { marketDate: '2026-10-30', recordCount: 10, bytes: 1024, status: 'healthy' } } }
      : { schemaVersion: 1, healthyCount: 1, cacheCount: 1, durationMs: 1200, contentReuseRate: 90, totalBytes: 1024, generatedAt: '2026-10-30T10:00:00Z' }
  });
  const documentLike = { createElement: tag => new FakeNode(tag) };
  const root = { ownerDocument: documentLike, children: [], replaceChildren(...nodes) { this.children = nodes; } };
  try {
    const cleanup = mount({ root });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(root.children.length, 1);
    assert.ok(findText(root, '系统健康'));
    assert.ok(findText(root, '1 / 1'));
    assert.ok(findText(root, 'quotes'));
    cleanup();
    assert.equal(root.children.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
