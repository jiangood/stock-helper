import { normalizeStockCode } from '../router.js';
import {
  fetchProductComparison,
  formatProductMoney,
  formatProductPercent
} from '../services/products.service.js';

const ECHARTS_URL = 'https://registry.npmmirror.com/echarts/5.5.1/files/dist/echarts.min.js';
let chartLibraryPromise = null;

function ensureECharts(documentLike, windowLike) {
  if (windowLike.echarts) return Promise.resolve(windowLike.echarts);
  if (chartLibraryPromise) return chartLibraryPromise;
  chartLibraryPromise = new Promise((resolve, reject) => {
    const script = documentLike.createElement('script');
    script.src = ECHARTS_URL;
    script.async = true;
    script.onload = () => windowLike.echarts
      ? resolve(windowLike.echarts)
      : reject(new Error('图表组件加载后未提供 ECharts'));
    script.onerror = () => reject(new Error('图表组件加载失败'));
    documentLike.head.append(script);
  }).catch(error => {
    chartLibraryPromise = null;
    throw error;
  });
  return chartLibraryPromise;
}

function createElement(documentLike, tag, className, text) {
  const element = documentLike.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function tone(value) {
  const number = Number(value);
  return number > 0 ? 'product-positive' : number < 0 ? 'product-negative' : '';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function buildChartOption(card, windowLike) {
  const series = [{
    name: String(card.name || '商品') + '（商品）',
    type: 'line',
    smooth: false,
    showSymbol: false,
    lineStyle: { width: 2.5 },
    data: card.productSeries.map(point => ({
      value: Number(point.index),
      actualPrice: point.price,
      actualUnit: card.unit || '商品价格'
    }))
  }];

  for (const stock of card.stocks || []) {
    if (!Array.isArray(stock.values) || stock.values.length < 2) continue;
    series.push({
      name: String(stock.name || stock.code || '关联股票'),
      type: 'line',
      smooth: false,
      showSymbol: false,
      lineStyle: { width: 2 },
      data: stock.values.map(point => ({
        value: Number(point.index),
        actualPrice: point.price,
        actualUnit: '元/股'
      }))
    });
  }

  const compact = windowLike.matchMedia &&
    windowLike.matchMedia('(max-width:575px)').matches;

  return {
    animation: false,
    grid: compact
      ? { left: 42, right: 10, top: 12, bottom: 48, containLabel: true }
      : { left: 52, right: 18, top: 38, bottom: 34, containLabel: true },
    legend: compact
      ? {
          type: 'scroll', orient: 'horizontal', left: 8, right: 8, bottom: 2,
          itemGap: 9, itemWidth: 12, itemHeight: 8, pageButtonItemGap: 4,
          pageIconSize: 9, textStyle: { fontSize: 10, color: 'inherit' },
          formatter: name => name.length > 5 ? name.slice(0, 5) + '…' : name
        }
      : { top: 2, textStyle: { fontSize: 11, color: 'inherit' } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter(params) {
        if (!Array.isArray(params) || !params.length) return '';
        const month = escapeHtml(params[0].axisValue);
        const rows = params.map(item => {
          const point = item.data || {};
          const actual = point.actualPrice;
          const price = actual == null
            ? '暂无真实价格'
            : Number(actual).toLocaleString('zh-CN', {
                maximumFractionDigits: point.actualUnit === '元/股' ? 3 : 2
              }) + ' ' + escapeHtml(point.actualUnit || '');
          return (item.marker || '') + escapeHtml(item.seriesName) + '：' + price +
            ' <span style="color:#888">（相对指数 ' +
            Number(item.value).toFixed(2) + '，起点=100）</span>';
        });
        return '<strong>' + month + '</strong><br>' + rows.join('<br>');
      }
    },
    xAxis: {
      type: 'category',
      data: Array.isArray(card.months) ? card.months : [],
      boundaryGap: false,
      axisLabel: { fontSize: 10, hideOverlap: true }
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { fontSize: 10, formatter: value => Number(value).toFixed(0) },
      name: '相对指数（共同起点=100）',
      nameTextStyle: { fontSize: 9 },
      splitLine: { lineStyle: { type: 'dashed', opacity: 0.35 } }
    },
    series
  };
}

function renderCard(documentLike, card, index) {
  const article = createElement(documentLike, 'article', 'commodity-card');
  const header = createElement(documentLike, 'div', 'commodity-head');
  const titleGroup = createElement(documentLike, 'div');
  titleGroup.append(
    createElement(documentLike, 'div', 'commodity-title', card.name || '未命名商品'),
    createElement(documentLike, 'div', 'product-meta',
      (card.id || '—') + ' · ' + (card.unit || '') + ' · 商品数据 ' + (card.latestDate || '—'))
  );
  header.append(titleGroup, createElement(
    documentLike,
    'span',
    'product-status' + (card.status === 'ready' ? ' sync' : ''),
    card.status === 'ready' ? '数据齐全' : '部分数据缺失'
  ));
  article.append(header);

  const metrics = createElement(documentLike, 'div', 'commodity-metrics');
  const metricItems = [
    ['商品最新参考价', formatProductMoney(card.latestPrice) + ' ' + (card.unit || '')],
    ['共同月线区间（最多 200 根）', card.months && card.months.length ? card.months.length + ' 根月线' : '—'],
    ['商品区间变化', formatProductPercent(card.productChange)]
  ];
  metricItems.forEach(([label, value], metricIndex) => {
    const item = createElement(documentLike, 'div');
    item.append(
      createElement(documentLike, 'div', 'product-metric-label', label),
      createElement(documentLike, 'div',
        'product-metric-value' + (metricIndex === 2 ? ' ' + tone(card.productChange) : ''),
        value)
    );
    metrics.append(item);
  });
  article.append(metrics);

  const hasChart = Array.isArray(card.productSeries) && card.productSeries.length >= 2;
  let chartNode = null;
  if (hasChart) {
    chartNode = createElement(documentLike, 'div', 'product-chart');
    chartNode.id = 'commodity-chart-' + index;
    chartNode.setAttribute('role', 'img');
    chartNode.setAttribute('aria-label',
      (card.name || '商品') + '及关联股票归一化月线，悬停查看真实价格');
    article.append(chartNode);
  } else {
    article.append(createElement(documentLike, 'div', 'product-empty',
      '商品与关联股票暂无足够的共同月份，暂不绘图。'));
  }

  article.append(createElement(documentLike, 'div', 'commodity-stocks-title', '关联股票月线'));
  const stocks = Array.isArray(card.stocks) ? card.stocks : [];
  stocks.forEach(stock => {
    const row = createElement(documentLike, 'div', 'commodity-stock');
    const top = createElement(documentLike, 'div');
    const code = normalizeStockCode(stock.code);
    if (code) {
      const link = createElement(documentLike, 'a',
        'commodity-stock-name text-body text-decoration-none', stock.name || code);
      link.href = '#/stock/' + encodeURIComponent(code);
      top.append(link);
    } else {
      top.append(createElement(documentLike, 'span', 'commodity-stock-name', stock.name || '未知股票'));
    }
    const role = (stock.roleLabel || '关联观察') +
      (stock.mainRatio != null && Number.isFinite(Number(stock.mainRatio))
        ? ' · 主营占比 ' + (Number(stock.mainRatio) * 100).toFixed(1) + '%'
        : '');
    top.append(createElement(documentLike, 'span', 'product-meta ms-2', role));
    row.append(top, createElement(documentLike, 'div', 'commodity-stock-meta',
      (stock.latestClose != null
        ? '最新复权月收 ' + formatProductMoney(stock.latestClose) + ' 元'
        : '暂无月线') + ' · ' + (stock.latestDate || '—') +
      ' · 区间 ' + formatProductPercent(stock.changePct)));
    article.append(row);
  });

  const sources = [...new Set(stocks.map(stock => stock.source || '缺少月K'))].join(' / ');
  const note = '图表以商品与关联股票共同可用的首个月份为统一起点，全部设为 100；悬停可查看对应月份真实价格及相对指数；商品使用' +
    (card.source || '可用商品参考价') + '，股票使用' + sources + '。' +
    (card.note || '') + ' 商品价格不等同于公司实际售价，关联关系也不代表利润必然同向变化。';
  article.append(createElement(documentLike, 'div', 'product-note', note));
  return { article, chartNode, card };
}

export function mount({
  root,
  window: windowLike = window,
  fetchImpl = fetch,
  loadChartLibrary = () => ensureECharts(root.ownerDocument, windowLike)
} = {}) {
  const documentLike = root.ownerDocument;
  const controller = new AbortController();
  const page = createElement(documentLike, 'main', 'container-fluid px-3 py-3');
  const heading = createElement(documentLike, 'div',
    'd-flex align-items-end justify-content-between flex-wrap gap-2');
  const titleGroup = createElement(documentLike, 'div');
  titleGroup.append(
    createElement(documentLike, 'h1', 'panel-title page-title mb-1', '商品'),
    createElement(documentLike, 'div', 'panel-subtitle',
      '最近 200 根月线；商品与关联股票以共同首月为基准（100），比较相对涨跌，悬停查看真实价格')
  );
  const updated = createElement(documentLike, 'div', 'panel-subtitle', '正在读取静态数据…');
  heading.append(titleGroup, updated);
  page.append(heading);

  const cardsNode = createElement(documentLike, 'div', 'product-grid');
  cardsNode.setAttribute('aria-live', 'polite');
  cardsNode.append(createElement(documentLike, 'div', 'product-empty', '正在加载商品数据…'));
  page.append(cardsNode);
  page.append(createElement(documentLike, 'p', 'product-note mt-3',
    '图表统一月份横轴，商品与所有有数据的关联股票以共同可用首月为统一基准（100），展示此后相对涨跌幅；悬停任一月份可查看真实价格、单位及相对指数。商品月价按当月最后一个有效报价聚合，股票使用复权月 K 收盘价；当月数据可能尚未收盘。数据不足时保留卡片并明确提示，不插值、不估算。商品价格不是上市公司实际销售均价，关联股票也可能受其他产品、成本、库存、产能利用率和市场估值影响；仅供研究参考，不构成投资建议。'));
  root.replaceChildren(page);

  let mounted = true;
  let charts = [];
  const onResize = () => charts.forEach(chart => {
    try { chart.resize(); } catch (error) {}
  });
  windowLike.addEventListener('resize', onResize);

  async function load() {
    try {
      const payload = await fetchProductComparison({
        fetchImpl,
        signal: controller.signal
      });
      if (!mounted || controller.signal.aborted) return;
      const cards = payload.commodityCards;
      updated.textContent = '数据生成：' +
        (payload.generatedAt
          ? new Date(payload.generatedAt).toLocaleString('zh-CN', { hour12: false })
          : '未知') + ' · ' + cards.length + ' 个商品';
      cardsNode.replaceChildren();
      if (!cards.length) {
        cardsNode.append(createElement(documentLike, 'div', 'product-empty', '没有符合条件的商品'));
        return;
      }

      const rendered = cards.map((card, index) => renderCard(documentLike, card, index));
      rendered.forEach(item => cardsNode.append(item.article));
      if (!rendered.some(item => item.chartNode)) return;

      try {
        const chartLibrary = await loadChartLibrary();
        if (!mounted || controller.signal.aborted) return;
        rendered.forEach(item => {
          if (!item.chartNode || !Array.isArray(item.card.productSeries) ||
              item.card.productSeries.length < 2) return;
          const chart = chartLibrary.init(item.chartNode);
          chart.setOption(buildChartOption(item.card, windowLike));
          charts.push(chart);
        });
      } catch (chartError) {
        if (mounted && !controller.signal.aborted) {
          rendered.forEach(item => {
            if (item.chartNode) item.chartNode.textContent = '图表组件暂不可用，商品与股票数据仍可查看。';
          });
        }
      }
    } catch (error) {
      if (!mounted || controller.signal.aborted) return;
      updated.textContent = '商品月线数据读取失败';
      cardsNode.replaceChildren(createElement(documentLike, 'div', 'product-empty',
        '商品月线数据暂不可用：' + error.message + '。'));
    }
  }

  load();
  return () => {
    mounted = false;
    controller.abort();
    windowLike.removeEventListener('resize', onResize);
    charts.forEach(chart => {
      try { chart.dispose(); } catch (error) {}
    });
    charts = [];
    root.replaceChildren();
  };
}
