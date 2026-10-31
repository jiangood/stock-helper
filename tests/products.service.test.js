const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function loadService() {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/products.service.js'), 'utf8');
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}

test('商品服务以 no-store 读取比较数据并校验结构', async () => {
  const { fetchProductComparison } = await loadService();
  let options;
  const result = await fetchProductComparison({
    fetchImpl: async (url, requestOptions) => {
      options = requestOptions;
      return { ok: true, json: async () => ({ commodityCards: [{ id: 'soda-ash' }] }) };
    }
  });
  assert.equal(result.commodityCards[0].id, 'soda-ash');
  assert.equal(options.cache, 'no-store');
  await assert.rejects(
    fetchProductComparison({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    /格式不正确/
  );
  await assert.rejects(
    fetchProductComparison({ fetchImpl: async () => ({ ok: false, status: 502 }) }),
    /HTTP 502/
  );
});

test('商品格式化函数对缺失和非法值安全降级', async () => {
  const { formatProductMoney, formatProductPercent } = await loadService();
  assert.equal(formatProductMoney(null), '—');
  assert.equal(formatProductPercent('bad'), '—');
  assert.equal(formatProductPercent(1.236), '+1.24%');
});
