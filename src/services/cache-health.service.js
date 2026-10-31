const CACHE_FILES = ['data/cache/manifest.json', 'data/monitoring/latest.json'];

export async function fetchCacheHealth({ fetchImpl = fetch, signal } = {}) {
  const responses = await Promise.all(CACHE_FILES.map(url => fetchImpl(url, {
    cache: 'no-store',
    signal
  })));
  const failed = responses.find(response => !response.ok);
  if (failed) throw new Error('HTTP ' + failed.status);

  const [manifest, health] = await Promise.all(responses.map(response => response.json()));
  if (!manifest || manifest.schemaVersion !== 1 ||
      !manifest.caches || typeof manifest.caches !== 'object' || Array.isArray(manifest.caches) ||
      !health || health.schemaVersion !== 1) {
    throw new Error('缓存监控文件结构不兼容');
  }
  return { manifest, health };
}

export function formatCacheBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

export function formatCacheTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN');
}
