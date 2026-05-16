let stocks = [];
let currentSort = "profit";
let priceMap = {};
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
    html += `<tr>
      <td>${i + 1}</td>
      <td><span class="stock-name">${s.name}</span></td>
      <td><span class="stock-code">${s.code}</span></td>
      <td class="text-right ${profitClass}">${profitStr}</td>
      <td class="text-right">${priceStr}</td>
      <td class="text-right">${entryStr}</td>
      <td class="text-right">${targetStr}</td>
      <td>${s.group ? '<span class="tag">' + s.group + '</span>' : '<span class="text-muted">-</span>'}</td>
      <td>${s.remark || "-"}</td>
    </tr>`;
  }
  tbody.innerHTML = html;
  $("sortInfo").textContent = "📊 排序: " + (currentSort === "profit" ? "盈亏" : "分组+盈亏");
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

(async function init() {
  try {
    const res = await fetch("stocks.json", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error("HTTP " + res.status);
    stocks = await res.json();
    await refreshPrices();
    setInterval(refreshPrices, 60000);
  } catch (e) {
    showToast("❌ 加载失败: " + e.message, "error");
    stocks = [];
  }
})();
