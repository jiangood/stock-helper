const MARKET_DATA_FILES = {
  sectors: 'data/sector-monthly.json',
  globalAssets: 'data/global-assets-data.json',
  business: 'data/business-data.json',
  stocks: 'data/stocks.json',
  stockQuotes: 'data/stock-quotes.json'
};

export const GLOBAL_ASSETS = [
  { id: 'gold', name: '黄金', symbol: 'XAUUSD=X', kind: '贵金属', unit: 'USD/盎司' },
  { id: 'bitcoin', name: '比特币', symbol: 'BTC-USD', kind: '加密资产', unit: 'USD' },
  { id: 'ethereum', name: '以太坊', symbol: 'ETH-USD', kind: '加密资产', unit: 'USD' },
  { id: 'nikkei225', name: '日经 225', symbol: '^N225', kind: '海外指数', unit: '指数点' },
  { id: 'nasdaq100', name: '纳斯达克 100', symbol: '^NDX', kind: '海外指数', unit: '指数点' },
  { id: 'sp500', name: '标普 500', symbol: '^GSPC', kind: '海外指数', unit: '指数点' },
  { id: 'vix', name: 'VIX 恐慌指数', symbol: '^VIX', kind: '波动率指标', unit: '指数点' },
  { id: 'usdcny', name: '美元兑人民币', symbol: 'CNY=X', kind: '外汇', unit: 'CNY/USD' }
];

async function fetchJson(path, { fetchImpl = fetch, signal } = {}) {
  const response = await fetchImpl(path, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(path + ' HTTP ' + response.status);
  return response.json();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function fetchSectorMonthly(options = {}) {
  const payload = await fetchJson(MARKET_DATA_FILES.sectors, options);
  if (!isRecord(payload) || !isRecord(payload.stocks)) {
    throw new Error('板块日线数据格式不正确');
  }
  return payload;
}

export async function fetchGlobalAssets(options = {}) {
  const payload = await fetchJson(MARKET_DATA_FILES.globalAssets, options);
  if (!isRecord(payload) || !Array.isArray(payload.assets)) {
    throw new Error('全球资产行情数据格式不正确');
  }
  return payload;
}

export async function fetchBusinessData(options = {}) {
  const payload = await fetchJson(MARKET_DATA_FILES.business, options);
  if (!isRecord(payload) || !isRecord(payload.items)) {
    throw new Error('商品供需数据格式不正确');
  }
  return payload;
}

export async function fetchStocks(options = {}) {
  const payload = await fetchJson(MARKET_DATA_FILES.stocks, options);
  if (!Array.isArray(payload)) throw new Error('股票清单数据格式不正确');
  return payload.filter(stock => isRecord(stock) && stock.code && stock.name);
}

export async function fetchStockQuotes(options = {}) {
  const payload = await fetchJson(MARKET_DATA_FILES.stockQuotes, options);
  if (!isRecord(payload) || !isRecord(payload.quotes)) {
    throw new Error('股票行情快照格式不正确');
  }
  return payload;
}

function numeric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function formatMarketPercent(value) {
  const number = numeric(value);
  if (number === null) return '—';
  return (number > 0 ? '+' : '') + number.toFixed(2) + '%';
}

export function formatMarketNumber(value, digits = 2) {
  const number = numeric(value);
  if (number === null) return '—';
  return number.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

export function formatAssetPrice(value, id) {
  const number = numeric(value);
  if (number === null || number <= 0) return '—';
  const digits = id === 'bitcoin' ? 0 : id === 'usdcny' ? 4 : 2;
  return number.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function formatQuoteDate(value) {
  if (!value) return '报价日期未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '报价日期未知';
  return '报价日期：' + date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  });
}

export function formatFetchTime(value) {
  if (!value) return '数据抓取时间未知';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '数据抓取时间未知';
  return '数据抓取：' + date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false
  }) + '（北京时间）';
}

export function normalizeDailyHistory(history, limit = 200) {
  if (!Array.isArray(history)) return [];
  const points = history.filter(point =>
    point && /^\d{4}-\d{2}-\d{2}$/.test(String(point.date)) &&
    numeric(point.close) !== null && Number(point.close) > 0
  ).map(point => ({ date: point.date, close: Number(point.close) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const count = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 200;
  return count ? points.slice(-count) : [];
}

// Keep the same zone boundaries and invalid-plan handling as Croc.zoneOf().
export function classifyMarketZone(stock, price) {
  const current = numeric(price);
  if (current === null || current <= 0 || !stock) return 'unknown';
  const heavy = numeric(stock.heavy);
  const entry = numeric(stock.entry);
  if (heavy !== null && entry !== null && heavy > entry) {
    return current <= entry ? 'entry' : 'above';
  }
  if (heavy !== null && current <= heavy) return 'heavy';
  if (entry !== null && current <= entry) return 'entry';
  return entry !== null ? 'above' : 'unknown';
}

const PERIODS = ['d1', 'd5', 'd20', 'd60', 'd120', 'd200'];

export function buildSectorGroups(stocks, quotes, sectorPayload) {
  const stats = sectorPayload && isRecord(sectorPayload.stocks) ? sectorPayload.stocks : {};
  const groups = new Map();
  (Array.isArray(stocks) ? stocks : []).forEach(stock => {
    const key = stock.group || '未分类';
    if (!groups.has(key)) {
      groups.set(key, {
        name: key, count: 0, covered: 0, up: 0, down: 0, zone: 0,
        periods: Object.fromEntries(PERIODS.map(period => [period, 0])),
        counts: Object.fromEntries(PERIODS.map(period => [period, 0])),
        leaders: []
      });
    }
    const group = groups.get(key);
    group.count += 1;
    const quote = quotes && quotes[stock.code];
    if (quote && numeric(quote.price) > 0) {
      const zone = classifyMarketZone(stock, quote.price);
      if (zone === 'heavy' || zone === 'entry') group.zone += 1;
    }
    const item = stats[stock.code];
    if (!item || !isRecord(item)) return;
    const daily = numeric(item.d1);
    if (daily !== null) {
      group.covered += 1;
      if (daily > 0) group.up += 1;
      else if (daily < 0) group.down += 1;
    }
    PERIODS.forEach(period => {
      const value = numeric(item[period]);
      if (value === null) return;
      group.periods[period] += value;
      group.counts[period] += 1;
    });
    const twentyDay = numeric(item.d20);
    if (twentyDay !== null) group.leaders.push({
      name: stock.name, code: stock.code, change: twentyDay
    });
  });
  return Array.from(groups.values()).map(group => {
    PERIODS.forEach(period => {
      group.periods[period] = group.counts[period]
        ? group.periods[period] / group.counts[period] : null;
    });
    group.avg = group.periods.d20;
    group.leaders.sort((left, right) => right.change - left.change);
    return group;
  }).sort((left, right) =>
    (right.avg == null ? -999 : right.avg) - (left.avg == null ? -999 : left.avg)
  );
}

export function summarizeSectorCoverage(stocks, sectorPayload) {
  const stats = sectorPayload && sectorPayload.stocks ? sectorPayload.stocks : {};
  return (Array.isArray(stocks) ? stocks : []).filter(stock =>
    stats[stock.code] && numeric(stats[stock.code].d20) !== null
  ).length;
}
