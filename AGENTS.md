每次修改代码后，执行提交和推送（git add、git commit、git push），确保修改立即部署到 GitHub Pages。

## 站点

GitHub Pages 已配置为使用仓库根目录（不是 `docs/`）。

## 架构说明

- `index.html` — 首页，股票跟踪看板（表格），公开无密码
  - 样式基于 Bootstrap 5（CDN），少量自定义 CSS
  - 数据：`stocks.json`（静态基础数据） + `quotes.js`（行情 SDK）
  - 功能：搜索、分组筛选、全列排序、明暗主题、交易时段每 3 秒自动刷新
  - 表格 11 列（名称/价格/入场/重仓/今日/昨日/止盈1/止盈2/年初价/分组/更新）全部常显，窄屏靠横向滚动，不要再用 `d-none` 隐藏列
- `principles.html` — 价值投资理念展示，全静态（`style.css` + `public.css`）
- `quotes.js` — 行情 SDK，独立文件，可单独复用
  - 数据源：东方财富 push2（JSON）+ 腾讯财经 qt.gtimg.cn（GBK），多源自动降级、分片批量请求
  - 用法：`new StockQuotes.Client({ timeout, cacheTTL }).fetch(['sz002408', '600519'])`
  - 交易时段：`StockQuotes.marketSession()` / `StockQuotes.isTrading()`

## stocks.json 字段

```json
{ "name": "名称", "alias": "别名", "group": "分组", "code": "sz002408",
  "yearInit": 4.87, "entry": 5.5, "heavy": 4.5, "tp1": 10, "tp2": 15,
  "prevChg": 0.16, "updDate": "2026-03-05", "pool": true }
```

- 目前所有股票均为股票池标的（`pool` 恒为 `true`，字段保留以兼容旧数据），界面不再区分「持仓 / 股票池」，也不显示股票池标签
- `group` 每只股票都应填写（民爆 / 化工 / 农药 / 农业 / 食品 / 动保 / 有色 / 贵金属 / 稀土钨 / 钢铁 / 新材料 / 军工 / 能源 / 装备 / 轻工）
