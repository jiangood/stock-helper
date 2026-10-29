每次修改代码后，执行提交和推送（git add、git commit、git push），确保修改立即部署到 GitHub Pages。

## 站点

GitHub Pages 已配置为使用仓库根目录（不是 `docs/`）。

## 架构说明

- `index.html` — 首页，股票跟踪看板（表格），公开无密码
  - 样式基于 Bootstrap 5（CDN），少量自定义 CSS
  - 数据：`data/stocks.json`（静态基础数据） + `static-quotes.js`（浏览器只读同源缓存） + `data/stock-quotes.json` / `data/stock-cache/*.json`（Actions 生成的行情缓存）
  - 功能：搜索（名称 / 代码 / 别名 / 分组 / 拼音首字母与全拼）、分组筛选、全列排序、明暗主题、每天由 GitHub Actions 在 A 股收盘后更新静态行情；浏览器不直接请求行情供应商，页面只读取同源缓存
  - 表格 15 列（名称/价格/入场/重仓/昨日/止盈1/止盈2/年初价/市值/市盈率/市净率/股息率/纪律/分组/别名）全部常显，窄屏靠横向滚动，不要再用 `d-none` 隐藏列
  - 紧凑风格：行高约 26px，入场/重仓/止盈1 的涨跌幅用小号字紧随数值、不另起一行
  - 顶部只保留标题 + 刷新/主题按钮：不显示时钟、休市/交易中、收盘等常识性提示
  - 名称列只显示名称，不显示股票代码；别名单独一列，放在分组之后
  - 点击名称进入个股详情页（`stock.html?code=...`），东方财富外链放在详情页
  - 纪律增强：工具栏「全部状态」筛选（重仓/接近重仓/入场/破净/八折/小市值/纪律全过/全过+买点/风险）；名称后显示 ST / 亏 / 八折 / 破净小旗标；「纪律」列显示 5 项自动筛选（非ST/非亏损/PE≤30/市值≤200亿/PB<1）的通过数，全过显示绿色「全过」，4/5 显示黄色；底部「行情」页合并市场简报与行情，包括指数行情、股票池涨跌温度、板块强弱、从公开 `data/holdings.json` 读取的组合持仓盈亏、原机会雷达、全球资产与产业链商品行情；持仓数据源由 `holdings-data.js` 校验，网页只读，不使用 localStorage 保存持仓；首页不再提供简报按钮；`🩺` 打开股票池体检（弹窗不改动顶栏）
- `stock.html` + `stock.js` — 个股详情页，入参 `stock.html?code=sz002408`（兼容 `002408` / `SH600519`）
  - 模块：行情卡（只留昨收/成交额/换手率，不展示今开/最高/最低/均价/涨停/跌停/量比/振幅等日内指标）、日/月 K（lightweight-charts 4.2.3，CDN，不含分时）、估值与周期位置（PE/PB/ROE/52 周分位/月 K 历史分位/同组中位数比价）、跟踪计划（价格刻度条 + 入场/重仓/止盈状态）、补仓（POC 支撑 / MFI 底背离 / MA20 与 OBV 趋势三项）、鳄鱼纪律（PB 八折/200 亿/PE 30 倍/位置/连板检查、连续涨停提示、持仓成本与翻倍/三倍卖点、资源股 `(P−C)×Q` 估值计算器）
  - 补仓与趋势参考仅使用日 K；不再提供分钟 K / 分时数据接口；结论旁固定标注「辅助参考，不构成投资建议」
  - 数据：`data/stocks.json` 匹配计划；仅股票池/持仓缓存范围内的代码提供行情，池外代码不再实时回源，明确提示未纳入静态缓存
  - 本机数据：资源股估值参数 `localStorage['croc-valuation:<code>']`；持仓成本统一从公开 `data/holdings.json` 读取，个股详情页只读
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
- `static-quotes.js` — 浏览器端静态行情适配器，只读取同源 JSON；优先用 IndexedDB 缓存较大的历史数据，localStorage 作兼容回退；缓存不可用时不直接回源外部行情接口
- `quotes.js` — GitHub Actions 采集端使用的行情 SDK，不由网页直接加载
  - 数据源：东方财富与腾讯财经，多源自动降级；仅由 Actions 采集脚本调用
  - 用法：`new StockQuotes.Client({ timeout, cacheTTL }).fetch(['sz002408', '600519'])`，返回 `price/prevClose/change/todayChange/pe/pb/totalCap/floatCap/divYield`
  - 股息率 `divYield`（%）：近 12 个月已除权分红 ÷ 现价，以腾讯口径为准，东方财富作兜底
  - 市值单位：`totalCap` / `floatCap` 为元（首页显示时换算成亿 / 万亿）
  - 详情 / 图表：`fetchDetail(code)`、`fetchKline(code, { period, count, adjust })`
- `scripts/fetch_stock_snapshot.js` + `.github/workflows/stock-snapshot.yml` — 每个工作日北京时间收盘后抓取股票池/持仓行情；日线每日更新、周线每周更新、月线每月更新；非交易日期跳过详情/K线抓取，失败时保留有效缓存，只提交有变化的数据
- `data/stock-quotes.json`、`data/stock-cache/<code>.json`、`data/index-cache.json` — 行情、个股详情、日/周/月 K 线与指数历史静态缓存

## data/stocks.json 字段

```json
{ "name": "名称", "alias": "别名", "group": "分组", "code": "sz002408",
  "yearInit": 4.87, "entry": 5.5, "heavy": 4.5, "tp1": 10, "tp2": 15,
  "prevChg": 0.16, "updDate": "2026-03-05", "pool": true }
```

- 目前所有股票均为股票池标的（`pool` 恒为 `true`，字段保留以兼容旧数据），界面不再区分「持仓 / 股票池」，也不显示股票池标签
- `group` 每只股票都应填写（民爆 / 化工 / 农药 / 农业 / 食品 / 动保 / 有色 / 贵金属 / 稀土钨 / 钢铁 / 新材料 / 军工 / 能源 / 装备 / 轻工）


## 全球资产页面（global-assets）

- `global-assets.js`：按最近报价日涨跌幅生成排行卡片；展示各资产近一个月迷你趋势；提供近一周 / 近一个月归一化趋势对比，区间起点统一为 100。
- `scripts/fetch_global_assets.py`：抓取各资产报价和近一个月日线历史；主符号失败时尝试备用符号，只有所有候选符号都失败才将错误写入页面状态。
- `data/global-assets-data.json`：保存报价时间、来源、状态和有效历史点。缺少历史数据时页面应明确提示，不生成模拟行情。
- 全球资产抓取通过 `.github/workflows/global-assets.yml` 定时运行，每日一次；该频率不是逐笔实时行情，数据未变化时保留原文件。


## 公开持仓 JSON

- `data/holdings.json` 只维护持仓代码、数量和成本；股票名称与止盈目标从 `data/stocks.json` 获取；简报与持仓风险概览都通过 `holdings-data.js` 读取。
- 该仓库为公开仓库，`data/holdings.json` 内容公开可见。不得在其中放入账号、交易凭证或其他秘密。
- 网页端只读，不通过 localStorage 保存或修改持仓；修改持仓需更新 JSON 并提交仓库，等待 GitHub Pages 部署。
- 初始持仓数量/成本来自用户提供的 2026-09-17 截图，若后续代码维护，先核对用户最新实际持仓；不要把截图行情当成实时行情。
- 不要求手工维护止损参考价、组合总资产或风险预算；风险概览只计算有行情支持的市值、盈亏、持仓集中度和股票池止盈情景。
