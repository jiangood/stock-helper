# 股票助手 Stock Helper

**在线查看：** https://jiangood.github.io/stock-helper/

- 首页：持仓监控看板（表格、实时行情、搜索、分组、股票池）
- 投资理念：https://jiangood.github.io/stock-helper/principles.html

## 本地预览

```bash
python -m http.server 8089
```

打开 http://localhost:8089/

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `index.html` | 持仓监控看板（Bootstrap 5） |
| `principles.html` | 价值投资理念页 |
| `stocks.json` | 股票基础数据（分组 / 别名 / 入场 / 重仓 / 止盈 / 股票池） |
| `quotes.js` | 行情 SDK（东方财富 + 腾讯财经，多源降级） |
| `style.css` `public.css` | 理念页样式 |

## 行情 SDK

```js
const q = new StockQuotes.Client({ timeout: 8000, cacheTTL: 1000 });
const data = await q.fetch(['sz002408', 'sh600519']);
// { sz002408: { code, name, price, prevClose, change, todayChange, time } }

StockQuotes.marketSession();   // 'open' | 'pre' | 'lunch' | 'closed' | 'holiday'
StockQuotes.isTrading();       // 是否处于需要刷新行情的时段
```
