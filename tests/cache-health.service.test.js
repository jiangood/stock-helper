const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadService() {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/cache-health.service.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('缓存健康服务以 no-store 读取两个静态文件并校验结构', async () => {
  const { fetchCacheHealth } = await loadService();
  const calls = [];
  const payloads = [
    { schemaVersion: 1, marketDate: '2026-10-30', caches: {} },
    { schemaVersion: 1, healthyCount: 1, cacheCount: 1 }
  ];
  const result = await fetchCacheHealth({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => payloads[url.includes('manifest') ? 0 : 1] };
    }
  });
  assert.equal(result.manifest.marketDate, '2026-10-30');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.options.cache === 'no-store'));
});

test('缓存健康服务拒绝错误 HTTP 和不兼容 schema', async () => {
  const { fetchCacheHealth } = await loadService();
  await assert.rejects(
    fetchCacheHealth({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/
  );
  let index = 0;
  await assert.rejects(
    fetchCacheHealth({ fetchImpl: async () => ({ ok: true, json: async () => (++index === 1 ? {} : { schemaVersion: 1 }) }) }),
    /结构不兼容/
  );
});

test('缓存健康格式化函数处理非法值和边界', async () => {
  const { formatCacheBytes, formatCacheTime } = await loadService();
  assert.equal(formatCacheBytes(-1), '—');
  assert.equal(formatCacheBytes(1024), '1.0 KB');
  assert.equal(formatCacheBytes(1024 * 1024), '1.00 MB');
  assert.equal(formatCacheTime('not-a-date'), '未知');
});
