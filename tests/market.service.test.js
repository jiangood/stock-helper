const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadService() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/market.service.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('行情数据服务使用 no-store 并校验三类缓存结构', async () => {
  const service = await loadService();
  const payloads = {
    'data/sector-monthly.json': { marketDate: '2026-10-30', stocks: {} },
    'data/global-assets-data.json': { updatedAt: '2026-10-31T00:00:00Z', assets: [] },
    'data/business-data.json': { schemaVersion: 1, items: {} }
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => payloads[url] };
  };

  await service.fetchSectorMonthly({ fetchImpl });
  await service.fetchGlobalAssets({ fetchImpl });
  await service.fetchBusinessData({ fetchImpl });

  assert.deepEqual(calls.map(call => call.url), [
    'data/sector-monthly.json',
    'data/global-assets-data.json',
    'data/business-data.json'
  ]);
  assert.ok(calls.every(call => call.options.cache === 'no-store'));
});

test('行情数据服务拒绝错误响应和不兼容的数据结构', async () => {
  const service = await loadService();
  await assert.rejects(
    service.fetchSectorMonthly({ fetchImpl: async () => ({ ok: false, status: 503 }) }),
    /HTTP 503/
  );
  await assert.rejects(
    service.fetchGlobalAssets({ fetchImpl: async () => ({ ok: true, json: async () => ({ assets: {} }) }) }),
    /全球资产行情数据格式不正确/
  );
  await assert.rejects(
    service.fetchBusinessData({ fetchImpl: async () => ({ ok: true, json: async () => null }) }),
    /商品供需数据格式不正确/
  );
});

test('全球资产历史序列按日期排序、过滤无效报价并限制数量', async () => {
  const service = await loadService();
  const points = service.normalizeDailyHistory([
    { date: '2026-10-03', close: 103 },
    { date: 'invalid', close: 100 },
    { date: '2026-10-01', close: 101 },
    { date: '2026-10-02', close: 0 },
    { date: '2026-10-04', close: '104' }
  ], 2);
  assert.deepEqual(points, [
    { date: '2026-10-03', close: 103 },
    { date: '2026-10-04', close: 104 }
  ]);
});

test('行情格式化不把缺失数据渲染为零', async () => {
  const service = await loadService();
  assert.equal(service.formatMarketPercent(null), '—');
  assert.equal(service.formatMarketPercent(1.236), '+1.24%');
  assert.equal(service.formatMarketNumber(undefined), '—');
  assert.equal(service.formatMarketNumber(1234.567), '1,234.57');
});
