修改代码时先从最新 master 创建独立分支，完成测试后创建 PR；通过审查与 CI 后再合并 master。禁止未经明确要求直接向 master 推送代码。

## 项目形态

- 基于 open-admin（Spring Boot 4.1 + React 19 + Ant Design 6 + H2）的股票池跟踪后台。
- 默认 H2 文件模式，路径 `./data/db/stock-helper`；无需 MySQL。
- 原静态站点已移到 `legacy/`，GitHub Pages 不再是发布目标。
- 后端 context-path 为 `/stock`；前端开发服务器默认 3000，代理 `/stock/admin` 等到 8080。

## 架构

- `pom.xml` — 继承 Spring Boot 4.1，依赖 `io.github.jiangood:open-admin:3.1.11`、H2、pinyin4j、jsoup。
- `src/main/java/com/jiangood/stockhelper/`
  - `Application.java` — 启动类，开启异步。
  - `config/StockProperties.java` — `stock.seed-dir`、`stock.sync.*` 配置。
  - `config/StockJobInitializer.java` — 首次启动把 4 个采集任务注册到 open-admin `sys_job`，由 Quartz 调度。
  - `job/StockSyncJob.java` — 继承 `BaseJob`，参数 `type` 选择 quotes / fundamentals / global-assets / business / all。
  - `domain/` — `Stock`（股票池与计划）、`StockQuote`、`StockDetail`、`StockKline`、`Fundamental`、`ResearchReport`、`ResearchScoreRecord`、`SectorMonthly`、`GlobalAsset`、`BusinessItem`、`CostInput`、`SyncLog`。
  - `repository/` — Spring Data 仓储；K 线按 `code + period + adjust + trade_date` 唯一。
  - `service/SeedDataService` — 首次启动（ApplicationReadyEvent）从 `data/` 导入历史 JSON，幂等，不覆盖已有数据。
  - `service/StockDataService` — 页面读模型：自选看板、个股详情、作战信号、行情概览、全球资产。
  - `service/ScoreRebuildService` — 从 K 线 + 基本面重建机器评分与板块月线。
  - `service/QuoteSyncService` — 行情、详情、日/周/月 K、指数月线采集；覆盖率低于 80% 且无历史缓存时拒绝发布。
  - `service/FundamentalSyncService` — 东方财富 F10 实控人 / 主营构成 / 扣非年报；失败保留旧值。
  - `service/GlobalAssetSyncService` — Yahoo Finance 8 类资产；失败保留旧快照。
  - `service/BusinessSyncService` — 生意社 100ppi、东方财富现货与股票 / 期货库存；无有效报价时保留旧快照。
  - `sync/QuoteFetcher` — 东方财富与腾讯双源行情客户端（GBK 解码、详情、K 线）。
  - `indicator/` — `TechIndicators`（MFI/RSI/MACD/OBV/AD/MA/枢轴/背离/筹码近似）、`CrocEvaluator`（纪律/区间/涨停/分位）、`ResearchScoreCalculator`（7 项 65 分制）、`TradeSignalCalculator`（买入四项评分与止盈跟踪）。这些是纯函数，口径必须与旧 `legacy/` 实现保持一致。
  - `controller/` — `admin/dashboard`、`admin/stock-detail`、`admin/combat`、`admin/market`、`admin/global-assets`、`admin/stock` CRUD、`admin/sync`。
- `src/main/resources/application.yml` — H2、context-path、采集默认 cron、种子目录（任务首次注册后可在「系统管理 → 定时任务」调整）。
- `src/main/resources/application-menu-stock.yml` — 股票助手 / 数据管理菜单与权限码。
- `web/` — React 前端，`src/pages/` 约定式路由：
  - `index.jsx` 自选看板 `/`
  - `combat.jsx` 交易作战 `/combat`
  - `market.jsx` 行情概览 `/market`
  - `global-assets/index.jsx` 全球资产 `/global-assets`
  - `stock/$code.jsx` 个股详情 `/stock/:code`
  - `stock-plan/index.jsx` 股票池 CRUD `/stock-plan`
  - `sync.jsx` 数据同步 `/sync`
- `data/` — H2 首次启动导入的种子 JSON（stocks / quote / stock-cache / fundamentals / 研报 / 评分 / 板块 / 全球资产 / 产业链）。
- `legacy/` — 改造前静态站点与旧采集脚本、测试，仅作参考，不再运行。

## 业务规则（不要随意改阈值）

- 自选看板 18 列常显，名称列只显示名称；风控旗标 ST / 亏 / 八折 / 破净。
- 纪律 5 项：非 ST、非亏损（PE>0）、PE≤30、总市值≤200 亿、PB<1；全过显示「全过」，4/5 显示黄色。
- 机器评分 = 7 项 65 分制折算百分制（国资 10 / 扣非 14 / 主营 9 / 市值 8 / 盘整 9 / 月线 9 / 放量 6）；缺项只统计已知项，不返回 0 分。
- 研报评分优先展示人工摘录的原始分（`data/research-reports.json`），超过 12 个月标「旧」；无研报分才用机器分。
- 买入评分四项：超跌深度 / RSI / MFI / 动能，各 1 分；现价必须低于计划入场价才计算；下跌趋势且 MFI<20 一票否决。
- 止盈：近 60 日最低收盘 ×1.2 启动，启动后最高收盘 ×0.95 离场；触发后 60 个交易日冷却；不设止损。
- 数据缺失必须为 `null` / 「—」/「数据不足」，不得用 0、模拟行情或推测值填充。
- 采集失败保留上一次有效数据；不要为了页面好看删除无法自动判断的检查项。

## 常用命令

```bash
mvn test
mvn spring-boot:run
mvn clean package
cd web && npm install && npm run dev
cd web && npm run build
```

## 开发约定

- 后端构造器注入（`@RequiredArgsConstructor` + `private final`）；实体继承 `BaseEntity`，仓储继承 `BaseRepository`；控制器返回 `AjaxResult`，权限用 `@HasPermission`。
- 业务实体表名前缀 `sh_`；唯一业务键（`code` / `item_id` / `asset_id`）建唯一索引。
- 前端优先使用 open-admin 组件（`Page`、`ProTable`、`FormModal`、`PermActions`、`HttpClient`）；页面实现 `onShow()` 在 Tab 切换时刷新。
- 前端格式化统一走 `web/src/lib/format.js`；涨红跌绿用 `.sh-up` / `.sh-down`。
- 修改评分、纪律、信号阈值必须同时更新 `src/test/java/.../indicator/*Test`，并说明回测依据。
- 新增数据采集源必须：明确来源与日期、失败保留旧值、不写入未验证数值、记录到 `SyncLog`。
- 本项目使用 H2；不要引入需要外部数据库才能启动的依赖。若确需迁移数据库，先增加配置与迁移方案，不在功能提交中隐式切换。

## 测试与 CI

- 后端：`mvn test`（指标、纪律、评分、信号）。
- 前端：`cd web && npm run build`。
- CI：`.github/workflows/tests.yml` 执行上述两项。
- 提交前检查 `git status`，不要提交 `data/db/`、`logs/`、`target/`、`web/node_modules`、`web/dist`。
