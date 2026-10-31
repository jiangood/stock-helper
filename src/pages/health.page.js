import { fetchCacheHealth, formatCacheBytes, formatCacheTime } from '../services/cache-health.service.js';

function createElement(documentLike, tag, className, text) {
  const element = documentLike.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

export function mount({ root }) {
  const documentLike = root.ownerDocument;
  const controller = new AbortController();
  const page = createElement(documentLike, 'main', 'container-xxl py-3');
  const header = createElement(documentLike, 'header', 'd-flex align-items-center justify-content-between flex-wrap gap-3 mb-3');
  const heading = createElement(documentLike, 'div');
  heading.append(
    createElement(documentLike, 'h1', 'h4 mb-1', '系统健康'),
    createElement(documentLike, 'p', 'text-body-secondary small mb-0', '大鱼池 · 静态缓存监控')
  );
  const home = createElement(documentLike, 'a', 'btn btn-sm btn-outline-secondary', '返回自选');
  home.href = '#/stocks';
  header.append(heading, home);
  page.append(header);

  const metricDefinitions = [
    ['healthy', '缓存健康', '读取中'],
    ['duration', '最近缓存发布耗时', '—'],
    ['reuse', '内容复用率', '—'],
    ['bytes', '缓存总大小', '—']
  ];
  const metricGrid = createElement(documentLike, 'section', 'row g-3 mb-3');
  const metrics = {};
  for (const [key, label, initial] of metricDefinitions) {
    const column = createElement(documentLike, 'div', 'col-12 col-sm-6 col-xl-3');
    const card = createElement(documentLike, 'article', 'card h-100');
    const body = createElement(documentLike, 'div', 'card-body');
    body.append(createElement(documentLike, 'div', 'text-body-secondary small', label));
    metrics[key] = createElement(documentLike, 'div', 'fs-3 fw-semibold mt-1', initial);
    body.append(metrics[key]);
    card.append(body);
    column.append(card);
    metricGrid.append(column);
  }
  page.append(metricGrid);

  const detailCard = createElement(documentLike, 'section', 'card');
  const detailBody = createElement(documentLike, 'div', 'card-body');
  detailBody.append(createElement(documentLike, 'h2', 'h6', '缓存明细'));
  const cacheList = createElement(documentLike, 'div', 'd-grid gap-3');
  const updated = createElement(documentLike, 'p', 'text-body-secondary small mt-3 mb-0', '正在读取缓存清单…');
  detailBody.append(cacheList, updated);
  detailCard.append(detailBody);
  page.append(detailCard);

  const workflow = createElement(documentLike, 'a', 'd-inline-block small mt-3', '查看缓存构建记录与失败日志');
  workflow.href = 'https://github.com/jiangood/stock-helper/actions/workflows/build-static-cache.yml';
  workflow.target = '_blank';
  workflow.rel = 'noopener noreferrer';
  page.append(workflow);
  page.append(createElement(documentLike, 'p', 'text-body-secondary small mt-2',
    '内容复用率表示缓存文件内容未变化的比例，不等同于 CDN 命中率。页面读取失败会明确显示，不会回退到浏览器旧数据。'));

  root.replaceChildren(page);

  let mounted = true;
  async function load() {
  try {
    const { manifest, health } = await fetchCacheHealth({ signal: controller.signal });
    if (!mounted || controller.signal.aborted) return;
    metrics.healthy.textContent = health.healthyCount + ' / ' + health.cacheCount;
    metrics.duration.textContent = Number.isFinite(health.durationMs) ? (health.durationMs / 1000).toFixed(2) + ' 秒' : '—';
    metrics.reuse.textContent = Number.isFinite(health.contentReuseRate) ? health.contentReuseRate + '%' : '—';
    metrics.bytes.textContent = formatCacheBytes(health.totalBytes);
    updated.textContent = '行情日期：' + (manifest.marketDate || '未知') + ' · 最近成功发布：' + formatCacheTime(health.generatedAt);

    for (const [id, item] of Object.entries(manifest.caches)) {
      const row = createElement(documentLike, 'div', 'd-flex align-items-center justify-content-between gap-3 border-bottom pb-2');
      const detail = createElement(documentLike, 'div', 'min-w-0');
      detail.append(
        createElement(documentLike, 'strong', 'd-block', id),
        createElement(documentLike, 'small', 'text-body-secondary', '日期 ' + (item.marketDate || '未知') + ' · ' + item.recordCount + ' 条 · ' + formatCacheBytes(item.bytes))
      );
      const statusLabel = item.status === 'healthy' ? '正常' : item.status === 'stale' ? '过期' : '未知';
      const badge = createElement(documentLike, 'span', 'badge rounded-pill text-bg-' + (item.status === 'healthy' ? 'success' : item.status === 'stale' ? 'danger' : 'warning'), statusLabel);
      row.append(detail, badge);
      cacheList.append(row);
    }
  } catch (error) {
    if (!mounted || controller.signal.aborted) return;
    metrics.healthy.textContent = '不可用';
    cacheList.textContent = '缓存监控读取失败：' + error.message;
    updated.textContent = '请检查 GitHub Actions 最近一次成功的缓存构建。';
  }
  }

  load();
  return () => {
    mounted = false;
    controller.abort();
    root.replaceChildren();
  };
}
