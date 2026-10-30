(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const formatBytes = value => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };
  const formatTime = value => {
    if (!value) return '未知';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleString('zh-CN');
  };
  const setText = (id, value) => { const node = byId(id); if (node) node.textContent = value; };
  async function load() {
    try {
      const responses = await Promise.all([
        fetch('data/cache/manifest.json', { cache: 'no-store' }),
        fetch('data/monitoring/latest.json', { cache: 'no-store' })
      ]);
      const failed = responses.find(response => !response.ok);
      if (failed) throw new Error('HTTP ' + failed.status);
      const values = await Promise.all(responses.map(response => response.json()));
      const manifest = values[0], health = values[1];
      if (manifest.schemaVersion !== 1 || !manifest.caches || health.schemaVersion !== 1) {
        throw new Error('缓存监控文件结构不兼容');
      }
      setText('healthy', health.healthyCount + ' / ' + health.cacheCount);
      setText('duration', Number.isFinite(health.durationMs) ? (health.durationMs / 1000).toFixed(2) + ' 秒' : '—');
      setText('reuse', Number.isFinite(health.contentReuseRate) ? health.contentReuseRate + '%' : '—');
      setText('bytes', formatBytes(health.totalBytes));
      setText('updated', '行情日期：' + (manifest.marketDate || '未知') + ' · 最近成功发布：' + formatTime(health.generatedAt));
      const list = byId('cache-list');
      if (!list) return;
      list.textContent = '';
      Object.entries(manifest.caches).forEach(([id, item]) => {
        const row = document.createElement('div');
        row.className = 'cache';
        const detail = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = id;
        const meta = document.createElement('small');
        meta.textContent = '日期 ' + (item.marketDate || '未知') + ' · ' + item.recordCount + ' 条 · ' + formatBytes(item.bytes);
        detail.append(name, meta);
        const badge = document.createElement('span');
        badge.className = 'status ' + (item.status || 'unknown');
        badge.textContent = item.status === 'healthy' ? '正常' : (item.status === 'stale' ? '过期' : '未知');
        row.append(detail, badge);
        list.append(row);
      });
    } catch (error) {
      setText('healthy', '不可用');
      const list = byId('cache-list');
      if (list) list.textContent = '缓存监控读取失败：' + error.message;
      setText('updated', '请检查 GitHub Actions 最近一次成功的缓存构建。');
    }
  }
  load();
})();
