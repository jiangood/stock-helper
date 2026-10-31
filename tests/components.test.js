const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadModule(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

class FakeElement {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.hidden = false;
    this.className = '';
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(child) { this.children.push(child); }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  removeEventListener(name) { delete this.listeners[name]; }
  querySelector(selector) { return selector === '[data-loading-text]' ? this.loadingLabel || null : null; }
}

test('导航组件使用 Hash 链接并标记当前页面', async () => {
  const { createNavigation } = await loadModule('src/components/navigation.component.js');
  const documentLike = { createElement: tag => new FakeElement(tag) };
  const nav = createNavigation({ document: documentLike, activeRoute: 'market' });
  assert.equal(nav.getAttribute('aria-label'), '主导航');
  assert.equal(nav.children.length, 4);
  assert.equal(nav.children[1].href, '#/market');
  assert.equal(nav.children[1].getAttribute('aria-current'), 'page');
  assert.equal(nav.children[0].getAttribute('aria-current'), null);
});

test('主题切换保留手动选择并清理事件监听', async () => {
  const { createThemeSwitcher } = await loadModule('src/components/theme-switcher.component.js');
  const root = new FakeElement('html');
  const button = new FakeElement('button');
  const store = { value: 'dark', getItem() { return this.value; }, setItem(key, value) { this.value = value; } };
  const mediaListeners = {};
  const media = { matches: false, addEventListener(name, callback) { mediaListeners[name] = callback; }, removeEventListener(name) { delete mediaListeners[name]; } };
  const switcher = createThemeSwitcher({ button, document: { documentElement: root }, window: { matchMedia: () => media }, storage: store });
  assert.equal(root.getAttribute('data-bs-theme'), 'dark');
  button.listeners.click();
  assert.equal(root.getAttribute('data-bs-theme'), 'light');
  assert.equal(store.value, 'light');
  switcher.destroy();
  assert.equal(button.listeners.click, undefined);
  assert.equal(mediaListeners.change, undefined);
});

test('主题切换器在 localStorage 不可用时仍可运行', async () => {
  const { createThemeSwitcher } = await loadModule('src/components/theme-switcher.component.js');
  const root = new FakeElement('html');
  const button = new FakeElement('button');
  const windowLike = { matchMedia: () => ({ matches: true }) };
  Object.defineProperty(windowLike, 'localStorage', { get() { throw new Error('blocked'); } });
  const switcher = createThemeSwitcher({ button, document: { documentElement: root }, window: windowLike });
  assert.equal(root.getAttribute('data-bs-theme'), 'dark');
  switcher.destroy();
});

test('Toast 使用 textContent，加载状态同步 aria-busy', async () => {
  const { showToast, hideToast } = await loadModule('src/components/toast.component.js');
  const { setLoading } = await loadModule('src/components/loading.component.js');
  const toast = new FakeElement();
  showToast(toast, '<img src=x onerror=alert(1)>', 'success');
  assert.equal(toast.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(toast.getAttribute('role'), 'status');
  assert.match(toast.className, /alert-success/);
  hideToast(toast);
  assert.equal(toast.hidden, true);

  const loading = new FakeElement();
  loading.loadingLabel = new FakeElement('span');
  setLoading(loading, true, '正在加载');
  assert.equal(loading.getAttribute('aria-busy'), 'true');
  assert.equal(loading.loadingLabel.textContent, '正在加载');
  setLoading(loading, false);
  assert.equal(loading.hidden, true);
});


test('密码门禁支持校验注入、焦点限制和会话记忆', async () => {
  const { mountPasswordGate } = await loadModule('src/components/password-gate.component.js');
  class GateElement extends FakeElement {
    constructor(tag = 'div') { super(tag); this.style = {}; this.value = ''; this.checked = false; this.inert = false; }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
    querySelectorAll() { return [first, last]; }
  }
  const background = new GateElement('main');
  const gate = new GateElement('div');
  const form = new GateElement('form');
  const input = new GateElement('input');
  const remember = new GateElement('input');
  const error = new GateElement('div');
  const first = new GateElement('input');
  const last = new GateElement('button');
  remember.checked = false;
  const body = { children: [background, gate], style: {} };
  const local = new Map();
  const session = new Map();
  const store = map => ({ getItem(key) { return map.get(key) || null; }, setItem(key, value) { map.set(key, value); }, removeItem(key) { map.delete(key); } });
  const documentLike = { body, activeElement: first, defaultView: {} };
  const cleanup = mountPasswordGate({
    gate, form, input, remember, error, document: documentLike,
    storage: store(local), session: store(session),
    verifyPassword: value => value === 'valid'
  });
  assert.equal(background.hasAttribute('inert'), true);
  assert.equal(body.style.overflow, 'hidden');
  input.value = 'wrong';
  form.listeners.submit({ preventDefault() {} });
  assert.equal(error.style.display, 'block');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  input.value = 'valid';
  form.listeners.submit({ preventDefault() {} });
  assert.equal(gate.style.display, 'none');
  assert.equal(session.get('stock-helper-unlocked'), '1');
  assert.equal(background.hasAttribute('inert'), false);
  assert.equal(body.style.overflow, '');
  cleanup();
  assert.equal(gate.listeners.keydown, undefined);
});
