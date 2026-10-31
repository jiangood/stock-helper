export async function fetchProductComparison({ fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl('data/product-comparison.json', {
    cache: 'no-store',
    signal
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.commodityCards)) {
    throw new Error('商品月线数据格式不正确，请等待缓存任务重建');
  }
  return payload;
}

export function formatProductPercent(value) {
  const number = Number(value);
  if (value == null || value === '' || !Number.isFinite(number)) return '—';
  return (number > 0 ? '+' : '') + number.toFixed(2) + '%';
}

export function formatProductMoney(value) {
  const number = Number(value);
  return value == null || !Number.isFinite(number)
    ? '—'
    : number.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
