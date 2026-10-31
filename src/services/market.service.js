const MARKET_DATA_FILES = {
  sectors: 'data/sector-monthly.json',
  globalAssets: 'data/global-assets-data.json',
  business: 'data/business-data.json'
};

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

export function formatMarketPercent(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  const number = Number(value);
  return (number > 0 ? '+' : '') + number.toFixed(2) + '%';
}

export function formatMarketNumber(value, digits = 2) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  });
}

export function normalizeDailyHistory(history, limit = 200) {
  if (!Array.isArray(history)) return [];
  const points = history.filter(point =>
    point && /^\d{4}-\d{2}-\d{2}$/.test(String(point.date)) &&
    point.close != null && Number.isFinite(Number(point.close)) && Number(point.close) > 0
  ).map(point => ({ date: point.date, close: Number(point.close) }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const count = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 200;
  return count ? points.slice(-count) : [];
}
