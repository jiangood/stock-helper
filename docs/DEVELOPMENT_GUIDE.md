# 开发与维护指南

本文记录改造为 open-admin + H2 后的实际开发方式、验证流程和高风险边界。若与代码不一致，以当前主分支代码和 CI 实际配置为准，并在修改时同步更新本文。

## 1. 项目形态

- Spring Boot 4.1 + open-admin 3.1.11 + JPA + H2（默认文件模式）。
- React 19 + Ant Design 6 + Vite 8 前端，`web/src/pages/` 约定式路由。
- 采集由 Java 定时任务完成，不再依赖 GitHub Actions 的 Node/Python 脚本。
- 原静态站点在 `legacy/`，仅作迁移参考，不参与构建与部署。

## 2. 目录与职责

| 路径 | 用途 |
| --- | --- |
| `src/main/java/.../domain/` | JPA 实体，表名 `sh_*` |
| `src/main/java/.../indicator/` | 指标、纪律、评分、交易信号纯函数 |
| `src/main/java/.../service/` | 页面读模型、采集、评分重建、种子导入 |
| `src/main/java/.../controller/` | `admin/...` REST 接口 |
| `src/main/resources/application.yml` | H2、端口、context-path、cron |
| `src/main/resources/application-menu-stock.yml` | 菜单与权限码 |
| `web/src/pages/` | 页面（小写开头自动注册路由） |
| `web/src/components/` | ECharts 容器、迷你走势图 |
| `data/` | H2 首次启动导入的种子 JSON |
| `legacy/` | 旧静态站点、旧脚本与旧测试 |

## 3. 本地启动与验证

```bash
# 后端（http://localhost:8080/stock）
mvn spring-boot:run

# 前端（http://localhost:3000）
cd web
npm install
npm run dev

# 测试
mvn test
cd web && npm run build
```

- 默认账号 `admin` / `Open@1234`。
- 首次启动会从 `data/` 导入历史数据，耗时取决于 K 线数量；日志出现「历史数据导入完成」后再访问页面。
- 重置数据库：停止进程，删除 `data/db/`，重启。
- 如需切换端口：`SERVER_PORT=18080 mvn spring-boot:run`。

## 4. 数据采集

- 行情：东方财富 push2 + 腾讯财经，多源降级；日/周/月 K 与详情分别采集。
- 基本面：东方财富 F10 三个接口，失败保留旧值。
- 全球资产：Yahoo Finance chart，单品种失败保留旧快照。
- 产业链商品：生意社 100ppi + 东方财富现货与股票 / 期货库存；无有效报价时整体不覆盖。
- 定时任务使用 open-admin 的 `BaseJob`（`StockSyncJob`）注册到 Quartz；首次启动自动写入 `sys_job`，可在「系统管理 → 定时任务」调整 cron、启停和查看执行记录。
- 采集后自动重建机器评分与板块月线；不要手工修改 H2 中的派生表后不重算。

## 5. 修改流程

1. 先 `git pull` 到最新 master。
2. 从最新 master 建立工作分支，禁止直接向 master 推送。
3. 阅读目标模块、调用方、相关测试与 `legacy/` 旧口径。
4. 最小范围修改；评分 / 纪律 / 信号阈值变更必须有测试与回测依据。
5. 运行 `mvn test` 与 `cd web && npm run build`；新增页面后检查路由、权限码与菜单。
6. 检查 `git diff`，确认未提交 H2 文件、日志、`node_modules`、`dist`。
7. 创建 PR，说明动机、行为变化、风险与验证结果；CI 通过后再合并。

## 6. 高风险修改检查表

- 鳄鱼纪律、买入/卖出信号、风险拦截、止盈与离场判断。
- 研报原始分、机器评分权重、阈值、数据日期。
- 股票主数据、基本面、K 线复权口径。
- 采集失败保留策略、覆盖率门槛、并发与串行控制。
- 前端数据读取与权限码；页面拿不到数据时应显示错误，不得静默伪造。
- H2 表结构变更：新增字段优先，删除/重命名需考虑已有本地库的 `ddl-auto=update` 行为与数据迁移。

## 7. 汇报格式

每次代码任务完成后说明：

1. 实际修改内容与涉及文件。
2. 工作分支与 PR 链接。
3. 是否合并 master。
4. 测试命令与真实结果。
5. CI 状态。
6. 未完成事项及原因。

**最终原则：以可验证的实际交付为目标；不把未执行的操作说成已完成。**
