# 数据存储架构

## 部署边界

项目部署在 GitHub Pages，是静态网站，没有常驻后端、服务端 SQL 数据库或安全的服务端写入 API。网页不连接 PostgreSQL/MySQL，也不在浏览器中运行 SQLite/IndexedDB。

## 数据分层

| 数据域 | 权威来源 | 页面读取/本机设置 | 原则 |
| --- | --- | --- | --- |
| 股票基础资料、分组、交易计划 | `data/stocks.json` | 同源静态 JSON | 人工维护、代码审查、版本控制 |
| 研报原始评分及来源 | `data/research-reports.json` | 同源静态 JSON | 保留报告日期、来源和原始分 |
| 基本面快照 | `data/fundamentals.json` | 同源静态 JSON | Actions 更新；失败保留最后有效源文件 |
| 行情快照、K 线、指数历史 | `data/stock-quotes.json`、`data/stock-cache/`、`data/index-cache.json` | 同源静态 JSON | Actions 采集；页面只读；保留历史序列 |
| 机器评分、板块汇总 | 对应构建脚本生成 | 同源静态 JSON | 派生数据，可从原始数据重建 |
| 用户个人参数和主题 | 用户当前设备 | 少量 localStorage 设置项 | 仅保存用户设置，不保存行情、K 线或数据响应 |

## 前端数据读取规则

- 不使用 IndexedDB、WebSQL、Cache API 或 localStorage 保存行情、详情、K 线、评分、基本面或其他业务数据响应。
- 不使用 JavaScript 内存 Map/变量缓存响应，不做 stale-while-revalidate 或后台刷新队列。
- 每次数据读取直接请求 GitHub Pages 同源 JSON，并使用 `fetch(..., { cache: 'no-store' })`。
- 网络请求失败时明确报错/展示不可用状态；不得静默回退到浏览器旧数据。
- localStorage 仅可用于明确的用户偏好/设置，例如主题、资源股估值输入；不得用于数据缓存。
- 不因取消浏览器缓存而删除仓库中的 JSON 静态数据。它们是 GitHub Pages 的数据发布文件，不是浏览器缓存。

## 为什么暂不使用服务端 SQL

GitHub Pages 无法托管数据库进程或安全写入 API。将 SQLite 二进制文件提交到 Git 会造成二进制 diff、并发冲突和仓库历史膨胀。当前项目以静态文件发布、页面只读，Actions 负责采集和生成数据，结构化 JSON 更符合部署方式。未来若引入有鉴权的服务端 API、多人协同写入或复杂查询，再单独评估托管 SQL 数据库。

## 数据质量与交易逻辑保护

- 采集数据保留来源、交易日期/报告期、更新时间和状态；缺失值保持 null，不以 0 或模拟值填充。
- 行情快照与历史 K 线区分交易日期、采集时间和复权口径。
- 派生评分可重建，并保留评分规则版本。
- 数据迁移先增加新读路径并验证，再切换调用方；保留回滚窗口，不删除仍被页面或回测引用的数据。
- 自动化写入避免并发覆盖；同一文件需串行化或具备冲突重试。
- 不因存储层调整改变鳄鱼纪律、交易信号、研报原始分、机器评分口径或历史回测结果。

## 本轮变更

- 移除浏览器 IndexedDB 行情数据库。
- 移除行情数据 localStorage 持久化缓存、内存缓存和后台刷新队列。
- 行情/详情/K 线/指数数据每次直接请求同源静态 JSON，禁用 HTTP 缓存。
- 保留主题、资源股估值参数等用户设置；不再将其与行情数据缓存混用。

## 自动化数据校验

- `scripts/validate_stock_data.js` 在行情快照和基本面文件提交前运行。
- 校验股票代码唯一性、必要主数据字段、行情价格与数值有限性、行情覆盖率、K 线 OHLC 一致性、基本面分类与年度报告期。
- 校验失败时 GitHub Actions 终止，不提交新数据；原有主分支文件保持不变。
- 缺失数据使用 null/缺记录表达，不以 0 补齐；验证规则不得擅自推断或修改评分与交易规则。

## 页面专用读模型

- `data/stock-cache/<code>.json` 是个股详情与历史 K 线的权威静态数据文件，不应因页面性能优化而删除历史序列。
- `scripts/build_combat_kline.js` 从权威个股文件派生 `data/combat-kline.json`，仅保留股票池每只股票最近 120 根前复权日 K，供作战页批量计算 RSI/MACD/MFI/均线/OBV 与交易信号。
- 作战页只请求一次该读模型，不再对 60+ 只股票逐一请求完整个股文件；缺失数据仍显示「数据不足」，不生成买入/卖出信号。
- 读模型由行情采集 Actions 在原始行情更新后重建，并纳入数据完整性校验；它是可重建的派生视图，不是新的权威数据源。
- 此优化不增加浏览器持久缓存、IndexedDB、localStorage 行情缓存或内存响应缓存；数据仍通过单次 `no-store` 请求读取。


## 静态缓存层（GitHub Actions）

- 权威数据仍保留在现有 data/*.json 与 data/stock-cache/；缓存层不替代、不反向覆盖权威数据。
- scripts/build_cache_manifest.js 为现有页面读模型生成 data/cache/manifest.json，当前登记行情快照、作战 K 线、机器评分和板块月线四类数据。
- Manifest 为每个数据集记录路径、数据/源指纹（SHA-256）、生成时间、行情日期、记录数、文件大小、新鲜度和健康状态。
- data/monitoring/latest.json 记录最近一次有意义的缓存发布构建耗时、健康数量、内容复用率和文件总体积。数据未变化时保留已有监控快照，避免仅因时间戳变化产生 Git 提交。
- GitHub Actions 的运行记录和 Job Summary 是每次构建（包括失败）的审计历史；仓库内 latest.json 代表最近一次发布缓存的成功构建（只有缓存内容、源版本或构建器版本变化时更新），不冒充每次尝试记录；耗时是该次完整派生缓存构建的耗时。
- 行情和基本面采集完成后由 .github/workflows/build-static-cache.yml 统一重建页面读模型与 manifest；该工作流是派生缓存的专用发布者，遇到 master 并发变化时从最新 master 重新构建后再重试。
- 基本面更新后会重新生成机器评分，避免评分继续等待下一次行情工作流才刷新。
- health.html 展示缓存健康、最近发布构建耗时、内容复用率、缓存大小和数据日期。
- 内容复用率指缓存文件内容指纹未变化的比例，不是 CDN HIT/MISS。GitHub Pages 不暴露浏览器级 CDN 命中日志；若需全站请求成功率或真实 CDN 命中率，需后续接入遥测/CDN 日志服务。
- 浏览器仍对每次业务数据请求使用 cache: 'no-store'，不引入 IndexedDB、localStorage、Cache API 或内存响应缓存。
- 构建校验失败会阻止缓存发布；上一次已提交的 manifest 与健康快照保持不变。GitHub Actions 失败记录及 Job Summary 用于追踪失败原因。
