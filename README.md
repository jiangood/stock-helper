# 股票助手 Stock Helper

**在线查看：** https://jiangood.github.io/stock-helper/

- 首页：股票池监控看板（表格、实时行情、搜索、分组）
- 个股详情：https://jiangood.github.io/stock-helper/stock.html?code=sz002408

## 本地预览

```bash
python -m http.server 8089
```

打开 http://localhost:8089/

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | 股票池监控看板（Bootstrap 5） |
| `stock.html` `stock.js` | 个股详情页（`?code=sz002408`）：行情、分时 / 日周月 K、估值与周期位置、跟踪计划 |
| `stocks.json` | 股票基础数据（分组 / 别名 / 入场 / 重仓 / 止盈 / 股票池） |
| `quotes.js` | 行情 SDK（东方财富 + 腾讯财经，多源降级） |

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
