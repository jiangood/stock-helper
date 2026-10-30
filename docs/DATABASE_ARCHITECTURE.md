# 数据存储架构

## 部署形态

项目已从 GitHub Pages 静态站点改造为 **Spring Boot + React + H2** 单体应用，部署时只需要一个 Java 进程和可持久化的数据目录。

- H2 文件数据库：`./data/db/stock-helper.mv.db`（可用 `db_path` JVM 参数覆盖）
- 上传文件：`sys.file.upload-path`（默认 `./data/upload`）
- 日志：`logging.file.path`（默认 `./logs`）
- 前端构建产物：`web/dist`，由 Nginx 或任意静态服务器托管

## 数据表

| 表 | 内容 | 唯一键 |
| --- | --- | --- |
| `sh_stock` | 股票池、分组、交易计划、拼音检索键 | `code` |
| `sh_quote` | 股票池与指数最近有效行情 | `code` |
| `sh_stock_detail` | 个股详情（估值、财务、52 周区间等） | `code` |
| `sh_kline` | 日 / 周 / 月 K 线，区分 `qfq` / `hfq` / `none` | `code + period + adjust + trade_date` |
| `sh_fundamental` | 实控人性质、主营构成、扣非年报（JSON） | `code` |
| `sh_research_report` | 研报原始总分、来源、日期、其他版本 | `code` |
| `sh_research_score` | 机器复算 7 项评分与中间指标 | `code` |
| `sh_sector_monthly` | 近 1/3/6/12 个月月线涨跌幅 | `code` |
| `sh_global_asset` | 全球资产报价与近月历史（JSON） | `asset_id` |
| `sh_business_item` | 产业链商品、库存、产业链企业（JSON） | `item_id` |
| `sh_cost_input` | 成本原料参考价 | `input_id` |
| `sh_sync_log` | 采集运行记录、耗时、结果 | 自增 UUID |

## 种子导入

- `SeedDataService` 在应用完全启动后（`ApplicationReadyEvent`）检查 `sh_stock` 是否为空。
- 为空时从 `stock.seed-dir`（默认 `./data`）读取历史 JSON：
  `stocks.json`、`stock-quotes.json`、`stock-cache/*.json`、`index-cache.json`、`fundamentals.json`、`research-reports.json`、`research-scores.json`、`sector-monthly.json`、`global-assets-data.json`、`business-data.json`。
- 导入是幂等的；已有股票数据时跳过。需要重新导入时删除 `data/db/` 后重启。
- 导入只读取文件，不回写 JSON；H2 是运行期唯一数据源。

## 数据质量规则

- 行情、详情、K 线、指数、全球资产、商品价格均保留来源、日期/报价时间与状态。
- 缺失值保持 `null`，页面显示「—」或「数据不足」，不以 0、模拟行情或推测值填充。
- 采集失败时保留上一次有效数据；首次行情覆盖率低于 80% 拒绝发布。
- 派生数据（机器评分、板块月线）可从 K 线与基本面重建，不作为权威源。
- 爬虫与评分口径变更必须补单元测试，不要修改历史回测结论或原始研报分。

## 采集与写入

- 行情写入按 `code` upsert；K 线按 `code + period + adjust` 先替换后写入，避免旧数据残留。
- 采集串行执行（`SyncService` 使用原子标记），同一时间只允许一个任务；每次运行写 `sh_sync_log`。
- 单只股票 / 单个品种失败不影响其他标的，不会用空值覆盖已有有效数据。
