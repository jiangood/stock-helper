let config = {};
let stocks = [];
let currentSort = "profit";
let priceMap = {};
let selectedStock = null;

const $ = id => document.getElementById(id);

function formatTime(ts) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function updateClock() {
  $("currentTime").textContent = formatTime(Date.now());
}

function showToast(msg, type) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + type + " show";
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove("show"), 2500);
}

function checkPassword() {
  const input = $("passwordInput");
  const err = $("passwordError");
  if (input.value === (config.password || "")) {
    $("passwordOverlay").style.display = "none";
    $("appContent").style.display = "block";
    init();
  } else {
    err.style.display = "block";
    input.value = "";
    input.focus();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("passwordInput").addEventListener("keydown", e => {
    if (e.key === "Enter") checkPassword();
  });
});

function closeDetail() {
  $("detailPanel").classList.remove("show");
  selectedStock = null;
  document.querySelectorAll("tbody tr.selected").forEach(el => el.classList.remove("selected"));
}

async function loadConfig() {
  try {
    const [cfg, stk] = await Promise.all([
      fetch("config.json", { signal: AbortSignal.timeout(5000) }).then(r => {
        if (!r.ok) throw new Error("config.json HTTP " + r.status);
        return r.json();
      }),
      fetch("stocks.json", { signal: AbortSignal.timeout(5000) }).then(r => {
        if (!r.ok) throw new Error("stocks.json HTTP " + r.status);
        return r.json();
      }),
    ]);
    config = cfg;
    stocks = stk;
  } catch (e) {
    showToast("❌ 加载失败: " + e.message, "error");
    config = {};
    stocks = [];
  }
}

async function fetchPrices() {
  const codes = stocks.map(s => s.code).join(",");
  if (!codes) return {};
  const proxy = config.cors_proxy || "";
  const url = proxy + encodeURIComponent("https://hq.sinajs.cn/list=" + codes);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    return parseSinaPrices(text);
  } catch (e) {
    if (e.name === "TimeoutError") throw new Error("请求超时");
    throw new Error("获取价格失败: " + e.message);
  }
}

function parseSinaPrices(text) {
  const map = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/hq_str_(sh|sz|hk)(\d+)/);
    if (!m) continue;
    const code = m[1] + m[2];
    const start = trimmed.indexOf('"');
    const end = trimmed.lastIndexOf('"');
    if (start === -1 || end === -1 || start >= end) continue;
    const parts = trimmed.substring(start + 1, end).split(",");
    if (parts.length < 4) continue;
    const prevClose = parseFloat(parts[2]);
    const price = parseFloat(parts[3]);
    if (isNaN(price) || isNaN(prevClose) || prevClose === 0) continue;
    const change = price - prevClose;
    map[code] = { price, change, change_percent: (change / prevClose) * 100 };
  }
  return map;
}

function sortStocks(stocks, prices) {
  const copy = [...stocks];
  copy.sort((a, b) => {
    const pA = prices[a.code];
    const pB = prices[b.code];
    const profitA = calcProfit(a, pA);
    const profitB = calcProfit(b, pB);
    if (currentSort === "group_profit") {
      const gA = a.group || "";
      const gB = b.group || "";
      if (gA !== gB) return gA.localeCompare(gB, "zh");
    }
    return profitA - profitB;
  });
  return copy;
}

function calcProfit(stock, price) {
  const entry = stock.entry_price;
  if (!entry || entry <= 0 || !price) return 0;
  return ((price.price - entry) / entry) * 100;
}

function render() {
  const sorted = sortStocks(stocks, priceMap);
  const tbody = $("stockTableBody");
  let html = "";
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const p = priceMap[s.code];
    const currentPrice = p ? p.price : null;
    const entry = s.entry_price;
    const target = s.target_price;
    let profit = null;
    if (entry && entry > 0 && currentPrice !== null) {
      profit = ((currentPrice - entry) / entry) * 100;
    }
    const priceStr = currentPrice !== null ? currentPrice.toFixed(2) : "-";
    const entryStr = entry !== null ? entry.toFixed(2) : "-";
    const targetStr = target !== null ? target.toFixed(2) : "-";
    let profitStr = "-";
    let profitClass = "";
    if (profit !== null) {
      profitStr = (profit >= 0 ? "+" : "") + profit.toFixed(2) + "%";
      profitClass = profit >= 0 ? "profit-up" : "profit-down";
    }
    html += `<tr onclick="showDetail('${s.code}')" data-code="${s.code}">
      <td>${i + 1}</td>
      <td><span class="stock-name">${s.name}</span></td>
      <td class="text-right">${priceStr}</td>
      <td class="text-right">${entryStr}</td>
      <td class="text-right">${targetStr}</td>
      <td class="text-right ${profitClass}">${profitStr}</td>
      <td>${s.group ? '<span class="tag">' + s.group + '</span>' : '<span class="text-muted">-</span>'}</td>
      <td>${s.remark || "-"}</td>
    </tr>`;
  }
  tbody.innerHTML = html;
  $("sortInfo").textContent = "📊 排序: " + (currentSort === "profit" ? "盈亏" : "分组+盈亏");
  if (selectedStock && priceMap[selectedStock]) renderDetail(selectedStock);
}

function showDetail(code) {
  selectedStock = code;
  document.querySelectorAll("tbody tr.selected").forEach(el => el.classList.remove("selected"));
  const row = document.querySelector(`tbody tr[data-code="${code}"]`);
  if (row) row.classList.add("selected");
  renderDetail(code);
}

function renderDetail(code) {
  const stock = stocks.find(s => s.code === code);
  if (!stock) return;
  const p = priceMap[code];
  $("detailPanel").classList.add("show");
  $("detailName").textContent = stock.name + " 详情";
  const currentPrice = p ? p.price : null;
  const change = p ? p.change : null;
  const changePercent = p ? p.change_percent : null;
  let profit = null;
  if (stock.entry_price && stock.entry_price > 0 && currentPrice !== null) {
    profit = ((currentPrice - stock.entry_price) / stock.entry_price) * 100;
  }
  const items = [
    { label: "股票代码", value: stock.code },
    { label: "当前价", value: currentPrice !== null ? currentPrice.toFixed(2) : "-" },
    { label: "涨跌额", value: change !== null ? (change >= 0 ? "+" : "") + change.toFixed(2) : "-" },
    { label: "涨跌幅", value: changePercent !== null ? (changePercent >= 0 ? "+" : "") + changePercent.toFixed(2) + "%" : "-" },
    { label: "推荐买入价", value: stock.entry_price !== null ? stock.entry_price.toFixed(2) : "-" },
    { label: "目标价", value: stock.target_price !== null ? stock.target_price.toFixed(2) : "-" },
    { label: "盈亏", value: profit !== null ? (profit >= 0 ? "+" : "") + profit.toFixed(2) + "%" : "-" },
    { label: "分组", value: stock.group || "-" },
    { label: "备注", value: stock.remark || "-" },
  ];
  $("detailGrid").innerHTML = items.map(item =>
    `<div class="detail-item"><div class="label">${item.label}</div><div class="value">${item.value}</div></div>`
  ).join("");
}

function toggleSort() {
  currentSort = currentSort === "profit" ? "group_profit" : "profit";
  render();
  showToast("已切换为 " + (currentSort === "profit" ? "盈亏排序" : "分组+盈亏排序"), "info");
}

async function refreshPrices() {
  const btn = document.querySelector(".btn-primary");
  btn.textContent = "⏳ 获取中...";
  btn.disabled = true;
  try {
    priceMap = await fetchPrices();
    render();
    const count = Object.keys(priceMap).length;
    showToast("✅ 已更新 " + count + " 只股票价格", "success");
    $("updateInfo").textContent = "⏱ 上次更新: " + formatTime(Date.now());
  } catch (e) {
    showToast("❌ " + e.message, "error");
  } finally {
    btn.textContent = "🔄 刷新价格";
    btn.disabled = false;
  }
}

updateClock();
setInterval(updateClock, 1000);
$("appContent").style.display = "none";

async function init() {
  await loadConfig();
  await refreshPrices();
  setInterval(refreshPrices, 60000);
}
