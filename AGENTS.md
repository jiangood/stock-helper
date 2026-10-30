修改代码时先从最新 master 创建独立分支，完成测试后创建 PR；通过审查与 CI 后再合并 master。禁止未经明确要求直接向 master 推送代码。

## 站点

GitHub Pages 已配置为使用仓库根目录（不是 `docs/`）。

## 架构说明

- `index.html` — 首页，股票跟踪看板（表格）
  - 样式基于 Bootstrap 5（CDN），列表页共享样式在 `app.css`，页面只保留本页特有样式
  - 三个列表页各自只加载需要的脚本：自选页不加载图表库 / 作战 / 行情模块，行情数据只在行情页请求
  - 访问门禁：三个列表页共用 `password-gate.js` 前端弱校验（仅阻止普通访客，不是安全认证）；门禁显示时背景内容设为 `inert`，焦点限制在弹窗内
  - 数据：`data/stocks.json`（静态基础数据） + `static-quotes.js`（浏览器每次直接读取同源 JSON，不做缓存） + `data/stock-quotes.json` / `data/stock-cache/*.json`（Actions 生成的行情缓存）
  - 功能：搜索（名称 / 代码 / 别名 / 分组 / 拼音首字母与全拼）、分组筛选、全列排序、明暗主题、每天由 GitHub Actions 在 A 股收盘后更新静态行情；浏览器不直接请求行情供应商，页面每次直接读取同源 JSON，不使用浏览器缓存
  - 无障碍：表头吸顶（固定标题行），表头排序是原生 `button` + `aria-sort`（Tab / Enter / Space 可用）；表格横向滚动区可聚焦（`role="region"`）并带右侧渐隐提示；搜索无结果时显示空状态与「清空筛选」；结果数量 `aria-live` 播报
  - 主题：手动选择写入 `localStorage['stock-theme']`，未选择时跟随系统；四个页面共用同一偏好
  - 表格 18 列（名称/价格/重仓/入场/昨日/止盈1/止盈2/年初价/市值/市盈率/市净率/股息率/纪律/机器评分/研报评分/研报日期/分组/别名）全部常显，窄屏靠横向滚动，不要再用 `d-none` 隐藏列
  - 紧凑风格：行高约 28px，入场/重仓/止盈1 的涨跌幅用小号字紧随数值、不另起一行
  - 顶部只保留标题 + 刷新/主题按钮：不显示时钟、休市/交易中、收盘等常识性提示
  - 名称列只显示名称，不显示股票代码；别名单独一列，放在分组之后
  - 点击名称进入个股详情页（`stock.html?code=...`），东方财富外链放在详情页
  - 纪律增强：工具栏「全部状态」筛选（重仓/接近重仓/入场/破净/八折/小市值/纪律全过/全过+买点/评分优/评分低/有研报评分/研报 ≥80/风险）；名称后显示 ST / 亏 / 八折 / 破净小旗标；「纪律」列显示 5 项自动筛选（非ST/非亏损/PE≤30/市值≤200亿/PB<1）的通过数，全过显示绿色「全过」，4/5 显示黄色；采用独立多页面导航：`index.html` 为自选、`combat.html` 为作战、`market.html` 为行情，顶部导航通过链接切页，不使用底部 tabs；行情页合并市场简报与行情，包括指数行情、股票池涨跌温度、板块月线强弱、全球资产与产业链商品行情；不再包含机会与交易观察；首页不再提供简报按钮
  - 「机器评分」「研报评分」「研报日期」为三个独立列，分别支持排序；机器评分显示 32 分制折算百分制分数，研报评分只显示研报原始总分，研报日期显示发布日期并在超过 12 个月时标「旧」，缺数据时显示 `—`；研报评分悬停显示来源与报告日期，机器评分悬停显示 7 项可复算指标明细
- `business.js` — 行情页渲染层（`window.StockBusiness`）：指数卡片（含近 12 个月月线曲线）、股票池温度、板块月线强弱、全球资产与产业链商品区域
  - 板块月线强弱读取 `data/sector-monthly.json`，按近 12 个月月线涨跌幅等权平均排序；卡片另列近 1/3/6 个月平均涨跌、涨跌家数与到计划价区家数，领先个股按近 12 个月涨幅排序
  - 机会与交易观察（原机会雷达）已从行情页移除，买入信号统一在作战页查看；`renderBrief` 是行情简报唯一入口
- `stock.html` + `stock.js` — 个股详情页，入参 `stock.html?code=sz002408`（兼容 `002408` / `SH600519`）
  - 模块：行情卡（只留昨收/成交额/换手率，不展示今开/最高/最低/均价/涨停/跌停/量比/振幅等日内指标）、日/月 K（ECharts 5.5.1，CDN，Apache-2.0 无署名要求，不含分时）、估值与周期位置（PE/PB/ROE/52 周分位/月 K 历史分位/同组中位数比价）、跟踪计划（价格刻度条 + 入场/重仓/止盈状态）、补仓（POC 支撑 / MFI 底背离 / MA20 与 OBV 趋势三项）、鳄鱼纪律（PB 八折/200 亿/PE 30 倍/位置/连板检查、连续涨停提示、资源股 `(P−C)×Q` 估值计算器）、评分（研报有总分就展示研报原始分并注明来源与日期，>12 个月标「可能已过时」；没有则展示 32 分制折算的机器分，并始终给出机器 4 项明细作对照，「口径说明」默认折叠）
  - 补仓与趋势参考仅使用日 K；不再提供分钟 K / 分时数据接口；结论旁固定标注「辅助参考，不构成投资建议」
  - 数据：`data/stocks.json` 匹配计划；仅股票池范围内的代码提供行情，池外代码不再实时回源，明确提示未纳入静态缓存
  - 本机数据：资源股估值参数 `localStorage['croc-valuation:<code>']`
  - 顶栏只保留标题 + 刷新/主题，不要加时钟、休市/交易中、收盘等提示
- `combat.html` + `combat-center.js` + `trade-signals.js` — 交易作战台（买入观察 + 止盈跟踪双向信号）
  - 买入门槛：现价必须**低于** `data/stocks.json` 的计划入场价才会计算评分；高于入场价只显示「高于入场价，不追高」，未配置入场价不生成信号
  - 四项评分（超跌深度 / RSI / MFI / 动能）各 1 分，≥3 分「条件较齐备」、2 分「部分满足」；按状态（上涨 / 回调 / 下跌）切换阈值
  - 一票否决：下跌趋势且 MFI<20（回测 20 日 −7.0%、胜率 25%）
  - 止盈：近 60 日最低收盘 ×1.2 启动跟踪，启动后最高收盘 ×0.95 离场（回撤 5%），**不需要成本价**；触发后 60 个交易日冷却，冷却期内不给买回提示
  - 不设止损：回测显示加 MA20 止损会把最好一笔 +52.8% 砍到 +5.4%，风险由仓位承担
  - 页面含「规则说明」折叠区（买入门槛 / 止盈口径 / 回测依据）；概览为 买入观察 / 触发止盈 / 止盈跟踪中 / 离场冷却 / 风险拦截 / 数据不足
  - 清单是表格（与首页自选同构，吸顶表头 + 首列固定 + 全列排序，未选列时回到默认优先级排序），列为 名称 / 现价（含当日涨跌）/ 信号 / 买入评分 / 入场（含相对现价折价）/ 重仓 / 止盈状态 / 止盈线 / 日K；不提供状态筛选；名称列只显示名称，不显示股票代码，涨跌等副信息用小号字紧随数值、不另起一行
  - 默认按优先级排序：触发止盈 → 买入观察（评分高、折价深在前）→ 止盈跟踪 → 观望 → 高于入场价 → 离场冷却 → 未配置入场价 → 风险拦截 → 数据不足
  - 点击表格任意一行就地展开详情（买入检查、核对清单、止盈跟踪、技术指标、计划失效 / 退出复核），点股票名进入个股详情页；展开区宽度跟随可视区域（`sizeDetailCells`），横向滚动时始终可读
  - 冗长内容默认折叠：「核对清单（行情 / 计划 / 纪律）」「技术指标」「触发说明」「计划失效 / 退出复核」点开才显示
  - 手机端（≤700px）扁平布局：去掉卡片边框/阴影与嵌套方框，概览改为三列毛边网格，表格压缩内边距并保留横向滚动
  - 回测脚本：`node scripts/backtest_signals.js`（评分分层 / 止盈规则 / 120 日 / 组合系统）
- `croc.js` — 鳄鱼纪律工具（浏览器 `window.Croc` / Node `require`）
  - `evaluate` / `screen` / `matchStatus` / `brief` / `limitUpInfo` / `percentile`
  - `screen(stock, quote)`：5 项自动纪律（非ST/非亏损/PE≤30/市值≤200亿/PB<1），返回 `passed/total/allPass/failed/pending`，首页「纪律」列与每日简报共用
  - 规则：PB≤0.8 为八折、PB<1 为破净、总市值 200 亿、PE(TTM) 30 倍、ST、连续涨停（创业板/科创板 20%，北交所 30%，主板 ST 5%）
- `research-score.js` — 研报评分工具（浏览器 `window.ResearchScore` / Node `require`）
  - 复算「资料/个股研报」10 项百分制评分卡里能靠公开数据算出来的 7 项：国资背景 10 / 扣非净利增长 14 / 主营集中 9 / 市值 8 / 盘整 9 / 月线底部 9 / 底部放量 6，合计 65 分
  - `compute({ cap, monthly, weekly, daily, price, high52, low52, ownerType, mainRatio, annual, asOf })` 返回 `items/points/max/percent/complete/band/metrics`；缺数据只统计已知项并返回 `null` 分数，不返回 0 分
  - 阈值集中在 `CONFIG`；分档按百分制 ≥75 位置优秀 / 56–75 位置中性 / <56 位置偏高；月 K 缺失时用周 K 合成（`deriveMonthly`）
  - `scoreProfit(annual, asOf)` 按发布日截断年报序列，校准时可复现历史分数
  - 未覆盖「独一无二 14 / 产品持续涨价 13 / 盈利模式 8」共 35 分权重，需要人工判断，页面不提供录入
- `indicators.js` — 量价指标纯函数（浏览器 `window.TechInd` / Node `require`）
  - `mfi` / `obv` / `adLine` / `ma` / `pivotLows` / `pivotHighs` / `detectDivergence` / `volumeProfile` / `volumeRatio`
  - 数据不足返回 `null`（不返回 0）；MFI 负资金流为 0 按 100 处理；筹码分布是日 K 均匀摊量的**近似**值
- `pinyin.js` — 首页搜索拼音索引（浏览器 `window.Pinyin` / Node `require`）
  - `Pinyin.initials(str)` 首字母、`Pinyin.full(str)` 全拼、`Pinyin.syllable(char)` 单字读音
  - 字表覆盖 GB2312 一二级汉字 6763 字主读音，离线生成、无外部依赖；ü 记作 v（`lv`），检索同时兼容 `lu`
- `static-quotes.js` — 浏览器端静态行情适配器，每次直接读取同源 JSON，使用 `cache: 'no-store'`；不使用 IndexedDB、localStorage、内存缓存或后台刷新队列；不直接回源外部行情接口
- `scripts/build_cache_manifest.js` / `data/cache/manifest.json` / `data/monitoring/latest.json` — GitHub Actions 统一登记静态读模型，记录 SHA-256 指纹、数据日期、记录数、文件大小、新鲜度、构建耗时和内容复用率；`health.html` 展示监控状态；内容复用率不是 CDN HIT/MISS。
- 行情和基本面采集完成后由 `.github/workflows/build-static-cache.yml` 统一重建页面读模型与 manifest；派生缓存由该专用工作流发布，遇到 master 并发变化时从最新 master 重新构建后重试；基本面变化后必须重新生成机器评分。
- `quotes.js` — GitHub Actions 采集端使用的行情 SDK，不由网页直接加载
  - 数据源：东方财富与腾讯财经，多源自动降级；仅由 Actions 采集脚本调用
  - 用法：`new StockQuotes.Client({ timeout, cacheTTL }).fetch(['sz002408', '600519'])`，返回 `price/prevClose/change/todayChange/pe/pb/totalCap/floatCap/divYield`
  - 股息率 `divYield`（%）：近 12 个月已除权分红 ÷ 现价，以腾讯口径为准，东方财富作兜底
  - 市值单位：`totalCap` / `floatCap` 为元（首页显示时换算成亿 / 万亿）
  - 详情 / 图表：`fetchDetail(code)`、`fetchKline(code, { period, count, adjust })`
- `scripts/validate_stock_data.js` — 行情与基本面发布前的数据完整性校验；校验失败必须阻止提交，不得自动填充或修正缺失值
- `scripts/build_combat_kline.js` / `data/combat-kline.json` — 从个股 K 线权威文件生成作战页专用读模型（每只最近 120 根前复权日 K）；作战页一次请求全股票池，减少逐只下载完整行情文件
- `scripts/fetch_stock_snapshot.js` + `.github/workflows/stock-snapshot.yml` — 每个工作日北京时间收盘后抓取股票池行情；日线每日更新、周线每周更新、月线随最新行情日更新（避免当月月 K 整月滞后）；非交易日期跳过详情/K线抓取，失败时保留有效缓存，只提交有变化的数据
- `data/stock-quotes.json`、`data/stock-cache/<code>.json`、`data/index-cache.json` — 行情、个股详情、日/周/月 K 线与指数历史静态缓存
- `data/sector-monthly.json` — 板块月线强弱汇总：每只股票近 1/3/6/12 个月涨跌幅与月线覆盖来源；由 `scripts/build_sector_monthly.js` 在每次行情采集后生成，行情页只读这个小文件，不逐只拉个股缓存
- `data/research-reports.json` — 研报原始总分摘录（29 只）：分数、报告日期、来源文件名，中国中冶另存 2026-03-15 自制版 83.0 作对照；手工维护一次即可，页面直接展示并标注来源与「是否过时」（>12 个月）
- `data/fundamentals.json` — 实控人 / 主营构成 / 扣非净利年报（最近 6 期），供评分使用；由 `scripts/fetch_fundamentals.py` 每周刷新，单个请求失败时保留上一次有效值
- `data/research-scores.json` — 机器复算的评分汇总：7 项得分、`points`/`max`/`percent`、分档与中间指标（市值、主营占比、扣非同比、箱体高度、历史分位、量比）；由 `scripts/build_research_scores.js` 在每次行情采集后生成，没有研报分的股票才用它
- `scripts/calibrate_research_score.js` — 用 18 份带评分卡明细的研报回归校准评分阈值；K 线与扣非年报都截断到研报发布日再复算，输出 7 项 MAE 与秩相关，以及机器分 vs 研报 7 项 / 研报总分的百分制对比（只读本地缓存，不联网、不改数据）
- `.github/workflows/fundamentals.yml` — 每周刷新 `data/fundamentals.json`（实控人 / 主营构成 / 扣非净利），失败时保留上一份有效数据

## data/stocks.json 字段

```json
{ "name": "名称", "alias": "别名", "group": "分组", "code": "sz002408",
  "yearInit": 4.87, "entry": 5.5, "heavy": 4.5, "tp1": 10, "tp2": 15,
  "prevChg": 0.16, "updDate": "2026-03-05", "pool": true }
```

- 目前所有股票均为股票池标的（`pool` 恒为 `true`，字段保留以兼容旧数据），界面不显示股票池标签
- `group` 每只股票都应填写（民爆 / 化工 / 农药 / 农业 / 食品 / 动保 / 有色 / 贵金属 / 稀土钨 / 钢铁 / 新材料 / 军工 / 能源 / 装备 / 轻工）


## 全球资产页面（global-assets）

- `global-assets.js`：按最近报价日涨跌幅生成排行卡片；展示各资产近一个月迷你趋势；提供近一周 / 近一个月归一化趋势对比，区间起点统一为 100。
- `scripts/fetch_global_assets.py`：抓取各资产报价和近一个月日线历史；主符号失败时尝试备用符号，只有所有候选符号都失败才将错误写入页面状态。
- `data/global-assets-data.json`：保存报价时间、来源、状态和有效历史点。缺少历史数据时页面应明确提示，不生成模拟行情。
- 全球资产抓取通过 `.github/workflows/global-assets.yml` 定时运行，每日一次；该频率不是逐笔实时行情，数据未变化时保留原文件。


