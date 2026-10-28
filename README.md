# 股票助手 Stock Helper

**在线查看：** https://jiangood.github.io/stock-helper/

- 首页：股票池监控看板（表格、实时行情、搜索、分组、纪律筛选）
- 个股详情：https://jiangood.github.io/stock-helper/stock.html?code=sz002408

## 本地预览

```bash
python -m http.server 8089
```

打开 http://localhost:8089/

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | 股票池监控看板（Bootstrap 5）：搜索、分组、纪律筛选、破净/八折/ST 旗标、每日简报、股票池体检 |
| `stock.html` `stock.js` | 个股详情页（`?code=sz002408`）：行情、日周月 K、估值与周期位置、跟踪计划、鳄鱼纪律、卖出纪律、资源股估值 |
| `stocks.json` | 股票基础数据（分组 / 别名 / 入场 / 重仓 / 止盈 / 股票池） |
| `croc.js` | 鳄鱼纪律工具：PB 八折、200 亿市值、PE 30 倍、入场/重仓区、连续涨停、月 K 分位、体检与简报 |
| `quotes.js` | 行情 SDK（东方财富 + 腾讯财经，多源降级） |

## 鳄鱼纪律

`croc.js` 把资料里可量化的规则做成页面共用工具：

- **净资产八折**：PB ≤ 0.8 标记「八折」，PB < 1 标记「破净」
- **200 亿市值**：总市值 > 200 亿只做提示，不做硬过滤
- **30 倍估值锚**：PE(TTM) > 30 标为偏高，亏损标为风险
- **不买 ST / 亏损**：首页旗标 + 体检风险清单
- **入场区 / 重仓区**：现价 ≤ 重仓价 / 入场价
- **卖其疯狂**：日 K 连续涨停 ≥ 3 或涨停打开时提示清仓纪律
- **历史分位**：月 K（最多 240 根）价格分位，辅助判断长周期位置

首页 `📋` 弹窗查看每日简报（右上角「复制」一键复制全文）；`🩺` 检查 `stocks.json` 的结构问题（代码重复、买点区间写反、止盈顺序、ST/亏损）。

详情页「鳄鱼纪律」中可填写**持仓成本**，本机浏览器保存，用于计算翻倍卖点、三倍目标与浮盈；「资源股现价估值」按 `(P−C)×Q×折扣×PE` 粗算合理市值，同样只保存在本机。

> localStorage 键：`croc-cost:<code>`、`croc-valuation:<code>`。换浏览器或清缓存会丢失。

## 行情 SDK

```js
const q = new StockQuotes.Client({ timeout: 8000, cacheTTL: 1000 });
const data = await q.fetch(['sz002408', 'sh600519']);
// { sz002408: { code, name, price, prevClose, change, todayChange, time } }

// 单只详情（含估值、52 周高低）
await q.fetchDetail('sz002408');

// K 线与分时
await q.fetchKline('sz002408', { period: 'day', count: 250, adjust: 'qfq' });
await q.fetchTrends('sz002408');

StockQuotes.marketSession();   // 'open' | 'pre' | 'lunch' | 'closed' | 'holiday'
StockQuotes.isTrading();       // 是否处于需要刷新行情的时段
```
