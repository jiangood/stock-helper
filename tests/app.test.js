const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('SPA 应用入口通过路由模块协调页面生命周期', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(source, /import \{ createRouter \} from '\.\/router\.js'/);
  assert.match(source, /page\.mount/);
  assert.match(source, /activePage\.unmount/);
  assert.match(source, /activeCleanup/);
  assert.match(source, /router\.stop\(\)/);
  assert.match(source, /renderQueue/);
});
