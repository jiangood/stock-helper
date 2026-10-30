# 股票助手（stock-helper）

基于 [open-admin](https://github.com/jiangood/open-admin) 的股票池跟踪与交易纪律后台。仓库已从纯静态站点改造为 **Spring Boot + React + H2** 的单体应用，历史静态页面保留在 `legacy/` 作为迁移参考。

## 功能

- **自选看板**：股票池 18 列（名称 / 价格 / 重仓 / 入场 / 昨日 / 止盈 / 年初价 / 市值 / PE / PB / 股息率 / 纪律 / 机器评分 / 研报评分 / 研报日期 / 分组 / 别名），支持名称、代码、别名、分组、拼音首字母与全拼搜索，分组与状态筛选、全列排序。
- **交易作战**：买入观察与止盈跟踪双向信号。现价低于计划入场价才计算四项评分（超跌深度 / RSI / MFI / 动能）；止盈按近 60 日最低收盘 ×1.2 启动、启动后最高收盘 ×0.95 离场，触发后冷却 60 个交易日；风险拦截与数据不足单独标注。
- **行情概览**：指数行情与近 12 个月月线、股票池涨跌温度、板块月线强弱、全球资产、产业链商品与成本原料。
- **全球资产**：8 类资产报价、涨跌排行、近 1 周 / 1 月归一化趋势对比。
- **个股详情**：行情卡、日 / 月 K（ECharts）、估值与财务、52 周与月 K 历史分位、跟踪计划刻度、补仓三项检查、鳄鱼纪律、研报评分、资源股估值计算器。
- **数据管理**：股票池与计划 CRUD、手动 / 定时数据同步、运行记录。
- **权限**：由 open-admin 提供用户、角色、菜单、字典、Quartz 调度、系统配置、操作日志等能力。

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 后端 | Java 21、Spring Boot 4.1、open-admin 3.1.11、JPA、Spring Security |
| 数据库 | H2 文件模式（默认，零外部依赖） |
| 前端 | React 19、Ant Design 6、Vite 8、ECharts 5 |
| 采集 | Java `HttpClient` 定时任务（东方财富 / 腾讯 / 生意社 / Yahoo Finance） |

## 快速开始

环境要求：JDK 21+、Maven 3.9+、Node.js 18+。

```bash
# 后端（默认 http://localhost:8080/stock）
mvn spring-boot:run

# 前端（默认 http://localhost:3000，代理 /stock/admin 到后端）
cd web
npm install
npm run dev
```

默认账号：`admin` / `Open@1234`。

首次启动会自动建表，并从 `data/` 目录导入历史 JSON（股票池、行情、K 线、基本面、研报评分、全球资产、产业链商品）。导入是幂等的：H2 中已有股票数据时不会重复导入。

## H2 数据库

- 默认文件：`./data/db/stock-helper.mv.db`
- 覆盖路径：`-Ddb_path=D:/stock-helper-db` 或设置同名 JVM 参数
- 重置数据库：停止应用后删除 `data/db/`，下次启动会重新导入 `data/` 下的种子 JSON
- H2 控制台默认未开启；如需排查可临时在 `application.yml` 配置 `spring.h2.console.enabled=true`

## 数据采集

| 数据 | 来源 | 默认时间（Asia/Shanghai） |
| --- | --- | --- |
| 股票池行情 / 详情 / 日周月 K | 东方财富 push2、腾讯财经 | 工作日 15:30 |
| 基本面（实控人 / 主营 / 扣非） | 东方财富 F10 | 每周一 09:10 |
| 全球资产 | Yahoo Finance chart | 每日 06:40 |
| 产业链商品 | 生意社 100ppi、东方财富现货与股票 / 期货库存 | 每日 07:20 / 12:20 / 17:20 / 22:20 |

- 采集失败时保留上一次有效数据，不以 0 或模拟值填充；首次行情覆盖率低于 80% 时拒绝发布。
- 行情写入后会自动重建机器评分与板块月线汇总。
- 采集任务通过 open-admin 的 Quartz 调度（`StockSyncJob` + `@JobDescription`），首次启动自动注册到「系统管理 → 定时任务」，可在线调整 cron、启停和查看执行记录。
- 也可在「数据管理 → 数据同步」手动触发，并查看最近运行记录；默认 cron 在 `src/main/resources/application.yml` 的 `stock.sync` 下调整（仅对尚未注册的同名任务生效）。

## 目录结构

```
src/main/java/com/jiangood/stockhelper/
├── config/          启动配置、定时任务
├── controller/      REST 接口（admin/...）
├── domain/          JPA 实体
├── repository/      Spring Data 仓储
├── service/         页面读模型、评分重建、采集编排
├── indicator/       量价指标、鳄鱼纪律、研报评分、交易信号（纯函数，可单测）
├── sync/            行情采集客户端
└── support/         代码、拼音、JSON 工具

src/main/resources/
├── application.yml
├── application-menu-stock.yml   菜单与权限
└── seed/                        （预留；默认读取仓库根目录 data/）

web/src/pages/       React 页面（约定式路由）
web/src/components/  图表与走势组件
web/src/lib/         格式化工具
data/                历史种子 JSON（H2 首次启动导入）
legacy/              改造前的静态站点（不再发布）
```

## 主要接口

| 接口 | 说明 |
| --- | --- |
| `GET /stock/admin/dashboard/list` | 自选看板行数据 + 汇总 + 分组 |
| `GET /stock/admin/stock-detail/info?code=` | 个股详情聚合 |
| `GET /stock/admin/stock-detail/kline?code=&period=&adjust=&count=` | K 线 |
| `GET /stock/admin/combat/list` | 交易作战信号 |
| `GET /stock/admin/market/overview` | 指数 / 温度 / 板块 / 全球资产 / 产业链 |
| `GET /stock/admin/global-assets/list` | 全球资产 |
| `GET/POST /stock/admin/stock/*` | 股票池 CRUD |
| `GET /stock/admin/sync/status`、`POST /stock/admin/sync/run?type=` | 同步状态与手动触发 |

除登录接口外均需要 open-admin 会话与对应权限码（`stock:read`、`combat:read`、`market:read`、`global-assets:read`、`stock:create/update/delete`、`sync:read/run`）。

## 测试与构建

```bash
mvn test                 # 指标 / 纪律 / 评分 / 信号单元测试
mvn clean package        # 后端可执行 jar
cd web && npm run build  # 前端静态资源（web/dist）
```

## 部署

```bash
mvn clean package
java -jar target/stock-helper-1.0.0-SNAPSHOT.jar
```

- 后端默认端口 8080、context-path `/stock`，可用 `SERVER_PORT` 覆盖。
- 前端 `web/dist` 可交由 Nginx 托管，并把 `/stock/admin`、`/stock/file` 反向代理到后端；也可继续用 `npm run dev` 本地开发。
- Docker 部署可参考 open-admin 官方示例；H2 数据与上传文件建议挂载到持久化目录。

## 迁移说明

- 本项目不再部署为 GitHub Pages 静态站点；原 `index.html`、`combat.html`、`market.html`、`stock.html` 及浏览器脚本已移动到 `legacy/`。
- 原 Node/Python 采集与派生脚本仅作历史参考，不再由 GitHub Actions 运行；采集逻辑已迁移到 Java 定时任务。
- 评分、纪律、交易信号口径保持与旧版一致；新增逻辑请先补单元测试，不要在不改测试的情况下调整阈值。

## 免责声明

所有行情、评分、纪律与交易信号仅用于个人记录与辅助判断，不构成投资建议。第三方数据源可能延迟或不可用，页面会明确展示数据日期与状态。
