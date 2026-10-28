每次修改代码后，执行提交和推送（git add、git commit、git push），确保修改立即部署到 GitHub Pages。

## 站点

GitHub Pages 已配置为使用仓库根目录（不是 `docs/`）。

## 架构说明

- `index.html` — 首页，股票跟踪看板（表格），公开无密码
  - 样式基于 Bootstrap 5（CDN），少量自定义 CSS
  - 数据：`stocks.json`（静态基础数据） + `quotes.js`（行情 SDK）
  - 功能：搜索（名称 / 代码 / 别名 / 分组 / 拼音首字母与全拼）、分组筛选、全列排序、明暗主题、交易时段每 60 秒自动刷新（不追求短期，不做日内高频轮询）
  - 表格 15 列（名称/价格/入场/重仓/昨日/止盈1/止盈2/年初价/市值/市盈率/市净率/股息率/纪律/分组/别名）全部常显，窄屏靠横向滚动，不要再用 `d-none` 隐藏列
  - 紧凑风格：行高约 26px，入场/重仓/止盈1 的涨跌幅用小号字紧随数值、不另起一行
  - 顶部只保留标题 + 刷新/主题按钮：不显示时钟、休市/交易中、收盘等常识性提示
  - 名称列只显示名称，不显示股票代码；别名单独一列，放在分组之后
  - 点击名称进入个股详情页（`stock.html?code=...`），东方财富外链放在详情页
  - 纪律增强：工具栏「全部状态」筛选（重仓/接近重仓/入场/破净/八折/小市值/纪律全过/全过+买点/风险）；名称后显示 ST / 亏 / 八折 / 破净 小旗标；「纪律」列显示 5 项自动筛选（非ST/非亏损/PE≤30/市值≤200亿/PB<1）的通过数，全过显示绿色「全过」，4/5 显示黄色；`📋` 弹窗查看每日简报（只读展示，含「纪律全过」「全过且到买点」「差一项」）、`🩺` 打开股票池体检（弹窗不改动顶栏）
- `stock.html` + `stock.js` — 个股详情页，入参 `stock.html?code=sz002408`（兼容 `002408` / `SH600519`）
  - 模块：行情卡（只留昨收/成交额/换手率，不展示今开/最高/最低/均价/涨停/跌停/量比/振幅等日内指标）、日/月 K（lightweight-charts 4.2.3，CDN，不含分时）、估值与周期位置（PE/PB/ROE/52 周分位/月 K 历史分位/同组中位数比价）、跟踪计划（价格刻度条 + 入场/重仓/止盈状态）、做T（15 分 VWAP 偏离 / MFI / 量能 / 单边过滤 + 参考价位）、补仓（POC 支撑 / MFI 底背离 / MA20 与 OBV 趋势三项）、鳄鱼纪律（PB 八折/200 亿/PE 30 倍/位置/连板检查、连续涨停提示、持仓成本与翻倍/三倍卖点、资源股 `(P−C)×Q` 估值计算器）
  - 做T / 补仓为纯前端计算：日 K 120 根近似筹码、15 分 K 约 20 个交易日；数据缺失只降级为「加载中 / 数据不足」，不阻塞主流程；结论旁固定标注「辅助参考，不构成投资建议」
  - 数据：`stocks.json` 匹配计划；不在股票池的代码也能看行情，计划区显示「未纳入股票池」
  - 本机数据：持仓成本 `localStorage['croc-cost:<code>']`、估值参数 `localStorage['croc-valuation:<code>']`
  - 顶栏只保留标题 + 刷新/主题，不要加时钟、休市/交易中、收盘等提示
- `croc.js` — 鳄鱼纪律工具（浏览器 `window.Croc` / Node `require`）
  - `evaluate` / `screen` / `matchStatus` / `health` / `brief` / `limitUpInfo` / `percentile`
  - `screen(stock, quote)`：5 项自动纪律（非ST/非亏损/PE≤30/市值≤200亿/PB<1），返回 `passed/total/allPass/failed/pending`，首页「纪律」列与每日简报共用
  - 规则：PB≤0.8 为八折、PB<1 为破净、总市值 200 亿、PE(TTM) 30 倍、ST、连续涨停（创业板/科创板 20%，北交所 30%，主板 ST 5%）
- `indicators.js` — 量价指标纯函数（浏览器 `window.TechInd` / Node `require`）
  - `mfi` / `obv` / `adLine` / `ma` / `pivotLows` / `pivotHighs` / `detectDivergence` / `volumeProfile` / `volumeRatio`
  - 数据不足返回 `null`（不返回 0）；MFI 负资金流为 0 按 100 处理；筹码分布是日 K 均匀摊量的**近似**值
- `pinyin.js` — 首页搜索拼音索引（浏览器 `window.Pinyin` / Node `require`）
  - `Pinyin.initials(str)` 首字母、`Pinyin.full(str)` 全拼、`Pinyin.syllable(char)` 单字读音
  - 字表覆盖 GB2312 一二级汉字 6763 字主读音，离线生成、无外部依赖；ü 记作 v（`lv`），检索同时兼容 `lu`
- `quotes.js` — 行情 SDK，独立文件，可单独复用
  - 数据源：东方财富 push2（JSON）+ 腾讯财经 qt.gtimg.cn（GBK），多源自动降级、分片批量请求
  - 用法：`new StockQuotes.Client({ timeout, cacheTTL }).fetch(['sz002408', '600519'])`，返回 `price/prevClose/change/todayChange/pe/pb/totalCap/floatCap/divYield`
  - 股息率 `divYield`（%）：近 12 个月已除权分红 ÷ 现价，以腾讯口径为准（东财 f133 兜底），无分红返回 0 / null
  - 市值单位：`totalCap` / `floatCap` 为元（首页显示时换算成亿 / 万亿）
  - 详情 / 图表：`fetchDetail(code)`、`fetchKline(code, { period, count, adjust })`、`fetchMinuteKline(code, { period:'5'|'15'|'30'|'60', count })`、`fetchTrends(code)`
  - 分钟 K：腾讯 mkline 主源（约 20 个交易日），东财 klt 降级，返回 `{ code, period, bars:[{ time:'2026-10-28 14:45', open, close, high, low, volume }] }`
  - 交易时段：`StockQuotes.marketSession()` / `StockQuotes.isTrading()`

## stocks.json 字段

```json
{ "name": "名称", "alias": "别名", "group": "分组", "code": "sz002408",
  "yearInit": 4.87, "entry": 5.5, "heavy": 4.5, "tp1": 10, "tp2": 15,
  "prevChg": 0.16, "updDate": "2026-03-05", "pool": true }
```

- 目前所有股票均为股票池标的（`pool` 恒为 `true`，字段保留以兼容旧数据），界面不再区分「持仓 / 股票池」，也不显示股票池标签
- `group` 每只股票都应填写（民爆 / 化工 / 农药 / 农业 / 食品 / 动保 / 有色 / 贵金属 / 稀土钨 / 钢铁 / 新材料 / 军工 / 能源 / 装备 / 轻工）
