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
  const now = new Date();
  const timeStr = formatTime(now);
  const dateStr = now.toLocaleDateString("zh-CN", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  if ($("currentTime")) $("currentTime").textContent = timeStr;
  if ($("marketTime")) $("marketTime").textContent = timeStr;
  if ($("marketDate")) $("marketDate").textContent = dateStr;
}

function showToast(msg, type) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast " + type + " show";
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove("show"), 2500);
}

async function checkAccess() {
  await loadConfig();
  const params = new URLSearchParams(window.location.search);
  if (params.get("random") === config.password) {
    $("publicPage").style.display = "none";
    $("appContent").style.display = "block";
    init();
  } else {
    renderQuotes();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  checkAccess();
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
  const emCodes = stocks.map(s => {
    const prefix = s.code.startsWith("sh") ? "1." : "0.";
    return prefix + s.code.slice(2);
  }).join(",");
  const url = `https://push2delay.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${emCodes}&fields=f2,f3,f4,f12`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return parseEastMoneyPrices(data);
  } catch (e) {
    if (e.name === "TimeoutError") throw new Error("请求超时");
    throw new Error("获取价格失败: " + e.message);
  }
}

function parseEastMoneyPrices(data) {
  const map = {};
  if (!data.data || !data.data.diff) return map;
  for (const item of data.data.diff) {
    const price = item.f2;
    const change = item.f4;
    const changePercent = item.f3;
    const codeNum = item.f12;
    if (price == null || change == null) continue;
    const stock = stocks.find(s => s.code.endsWith(codeNum));
    if (!stock) continue;
    map[stock.code] = { price, change, change_percent: changePercent };
  }
  return map;
}

const QUOTES = [
  { text: "别人贪婪时我恐惧，别人恐惧时我贪婪", author: "巴菲特" },
  { text: "价格是你付出的，价值是你得到的", author: "巴菲特" },
  { text: "投资最重要的不是智商，而是性情", author: "巴菲特" },
  { text: "在别人悲观时买入，在别人乐观时卖出", author: "格雷厄姆" },
  { text: "投资是预测艺术与风险管理科学的结合", author: "彼得·林奇" },
  { text: "不要试图预测市场，而是准备好应对各种情况", author: "约翰·博格尔" },
  { text: "复利是世界第八大奇迹", author: "爱因斯坦" },
  { text: "股市是经济的晴雨表，但短期来看是投票机", author: "格雷厄姆" },
  { text: "成功的投资需要耐心、纪律和独立思考", author: "查理·芒格" },
  { text: "买股票就是买公司的一部分", author: "巴菲特" },
  { text: "风险来自你不知道自己在做什么", author: "巴菲特" },
  { text: "投资中最重要的是安全边际", author: "格雷厄姆" },
];

function renderQuotes() {
  const grid = $("quoteGrid");
  if (!grid) return;
  const shuffled = [...QUOTES].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 6);
  grid.innerHTML = selected.map(q =>
    `<div class="quote-card">
      <div class="quote-text">"${q.text}"</div>
      <div class="quote-author">—— ${q.author}</div>
    </div>`
  ).join("");
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

async function init() {
  await refreshPrices();
  setInterval(refreshPrices, 60000);
}
