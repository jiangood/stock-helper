# 开发与维护指南

本文面向维护者及协作 AI，记录本仓库的实际开发方式、验证流程和高风险边界。若本文与代码、工作流不一致，以当前主分支代码和 GitHub Actions 实际配置为准，并在修改时同步更新本文。

## 1. 项目形态与关键约束

- 项目是部署在 GitHub Pages 的静态网站，没有常驻后端服务、服务端 SQL 数据库或安全写入 API。
- 页面从同源静态 JSON 读取数据；行情与基本面由 GitHub Actions 采集、校验和发布。
- 浏览器不得缓存行情、K 线、详情、评分、基本面等业务数据：不使用 IndexedDB、Cache API、WebSQL、localStorage 或内存 Map 保存响应；业务请求使用 `cache: 'no-store'`。
- localStorage 仅允许保存明确的用户偏好或本机输入设置。不要把用户设置误删，也不要把业务数据改回浏览器缓存。
- 数据缺失应明确表达为 null、缺记录或不可用状态，不得用 0、模拟行情或推测值填补。
- 派生读模型可重建，但不可将其误认为权威数据源；删除或迁移前必须检查所有页面、脚本、Actions 和测试的引用。

详细数据边界见 [数据库架构](DATABASE_ARCHITECTURE.md)。

## 2. 常用入口与目录

| 路径 | 用途 |
| --- | --- |
| `index.html` | SPA 唯一 HTML 壳与 Hash 路由入口 |
| `legacy-stocks.html`、`legacy-market.html`、`legacy-products.html`、`legacy-stock.html` | 迁移期间隔离运行的旧页面模板，禁止在原生迁移验收前删除 |
| `market.html`、`business.js` | 行情与产业链数据展示 |
| `products.html`、`products.js` | 以商品为中心的关联股票月线对比卡片 |
| `data/business-data.json`、`data/stock-products.json` | 商品报价及商品-上市公司关联关系 |
| `stock.html`、`stock.js` | 个股详情 |
| `data/stocks.json` | 股票基础资料、分组及交易计划等权威数据 |
| `data/product-comparison.json` | Actions 生成的商品及关联股票标准化月线读模型（`commodityCards`） |

| `data/research-reports.json` | 研报原始评分及来源信息 |
| `data/fundamentals.json` | 基本面快照 |
| `data/stock-quotes.json`、`data/stock-cache/` | 行情与个股历史数据 |
| `data/research-scores.json`、`data/sector-monthly.json` | 页面使用的派生读模型 |
| `data/cache/`、`data/monitoring/` | 静态缓存清单、详情缓存及监控快照 |
| `scripts/` | 数据采集、派生数据构建及校验脚本 |
| `tests/` | JavaScript 与 Python 自动化测试 |
| `.github/workflows/` | 自动化测试、数据采集和静态缓存发布 |

页面、数据文件及职责可能随迭代变化。修改前应搜索真实引用并检查当前 README，不要仅凭本表推断某文件可以删除。

## 3. 本地预览与验证

### 本地预览

仓库 README 当前提供的静态页面预览方式：

```bash
python -m http.server 8089
```

然后打开 `http://localhost:8089/`。

### 自动化测试

当前 `.github/workflows/tests.yml` 使用 Node.js 22 和 Python 3.11。可在本地按工作流顺序执行：

```bash
# 构建页面派生读模型
node scripts/build_sector_monthly.js
node scripts/build_product_comparison.js
node scripts/build_research_scores.js
node scripts/build_stock_detail_cache.js

# 检查缓存构建脚本语法并构建缓存清单
node --check scripts/build_cache_manifest.js
node scripts/build_cache_manifest.js

# 运行全部 JavaScript 测试
node --test tests/*.test.js

# 运行 Python 测试
python -m unittest discover -s tests -p 'test_*.py'

# 校验股票与缓存数据
node scripts/validate_stock_data.js
```

说明：
- 构建脚本可能更新 `data/` 下的派生文件。执行前后检查 `git status` 和 diff，不要把无关生成数据混入功能提交。
- Python 测试如提示缺少依赖，先查看对应 workflow 或脚本的安装步骤，不要擅自跳过测试并报告全部通过。
- GitHub Actions 是最终 CI 结果依据；本地未运行、未完成或失败的测试必须如实说明。

## 4. GitHub Actions 与数据发布

主要工作流（以当前 `.github/workflows/` 为准）：

- `tests.yml`：构建派生读模型、构建缓存 manifest、运行 JS/Python 测试并校验数据。
- `stock-snapshot.yml`：采集股票行情与 K 线。
- `fundamentals.yml`：刷新基本面快照。
- `build-static-cache.yml`：在上游数据更新后或相关构建脚本变更时，统一重建详情缓存、评分、板块月线、商品及关联股票月线对比、manifest 和健康快照，并校验后发布。
- `business-data.yml`、`global-assets.yml`：更新商品及全球资产数据；商品工作流同时重建商品及关联股票月线比较。

重要原则：
1. 采集失败或校验失败时保留最后一份有效数据，不发布不合格数据。
- 个股原生前复权月 K 缺失时，可用足量前复权日 K 按自然月聚合 OHLCV 作为兜底；聚合结果标记来源，不混用未复权日线，也不以插值补价格。
2. 数据没有实质变化时避免制造无意义提交。
3. 静态缓存发布工作流会从最新 master 重建，并在并发变化时重试；不要随意破坏其并发保护逻辑。
4. Actions 定时任务不是实时行情。页面应显示数据日期、来源和状态，不得将延迟快照描述为实时数据。
5. 检查工作流时区、触发条件、权限、并发组和失败日志；不要只看 workflow 名称判断其行为。

## 5. 标准代码修改流程

每次功能开发、Bug 修复、重构或页面优化：

1. 读取最新 master 的 README、相关 docs、目标文件、调用方、测试及工作流。
2. 检查当前 master 提交和目标文件版本，确认没有覆盖并发变更。
3. 默认直接在仓库主分支（当前为 `master`）修改；不创建功能分支，不创建 PR。
4. 按最小范围修改，复用已有模块、数据结构和样式约定；写入前重新确认目标文件 SHA，避免覆盖并发提交。
5. 检查引用、空值、异常处理、异步 Promise、DOM 节点、事件绑定、移动端布局和缓存版本。
6. 为关键逻辑增加或更新测试；运行与修改范围相关的测试，并尽可能运行完整 CI。
7. 检查 diff，确认没有意外改动数据文件、评分口径、交易规则或生成缓存。
8. 直接提交到主分支；如果主分支保护或权限阻止提交，不得绕过安全规则，应说明原因并继续完成可安全执行的工作。
9. 提交后核对主分支最新提交、修改文件和对应 Actions。工作流仍在运行时应标记为进行中，不能提前报告成功。

## 6. AI 协作与工具使用规则

本项目允许通过已连接的 GitHub 工具维护仓库。协作 AI 必须：

- 收到“执行”“开始”“按推荐来”“继续”等明确推进指令时，结合上下文直接开展工作，不重复询问已经明确的信息。
- 先检查当前会话可用的 GitHub 工具及授权，再决定可执行范围。不得因为不能访问用户本地电脑，就推断不能读写 GitHub 仓库。
- 优先使用 GitHub 工具读取文件、列出目录、更新文件、直接提交主分支和检查 Actions。
- 不要只输出代码片段或教程来替代用户要求的仓库修改。
- 工具调用失败后，记录具体失败环节，检查参数、分支、文件 SHA、权限和替代工具；能继续的步骤继续完成。
- 不得声称已修改、提交、创建 PR、合并或测试通过，除非有对应工具结果或 CI 记录证明。
- 明确区分“尚未尝试”“尝试失败”“部分完成”“已完成”。
- 如果工具能力确实不足，说明具体缺少的能力或授权、已尝试的替代路径，以及需要用户做的唯一必要动作。

## 7. 高风险修改检查表

以下变更必须格外谨慎，并检查所有共享调用方：

- 鳄鱼纪律与个股详情中的辅助判断规则。
- 研报原始评分、机器评分权重、阈值、数据日期及评分版本。
- 股票主数据、基本面字段、行情与 K 线复权口径。
- Actions 的数据发布、并发控制、失败保留和权限配置。
- 前端数据读取方式、浏览器缓存策略及静态缓存 manifest。

不得为追求页面简洁而隐藏重大风险或删除无法自动计算的纪律项。无法自动判断的项目应明确显示“无法计算”及原因，不得伪造通过。

## 8. 完成汇报格式

每次代码任务完成后简洁汇报：

1. 实际修改内容及涉及文件。
2. 工作分支和 PR 链接。
3. 是否合并 master，以及合并提交。
4. 测试命令和真实结果。
5. GitHub Actions 状态（成功、失败或仍在运行）。
6. 尚未完成事项及具体原因。

**最终原则：以可验证的实际交付为目标。先检查工具，再执行；遇到障碍先排查和寻找安全替代路径；不把工具限制泛化为无法完成，也不把未执行的操作说成已经完成。**


## 9. 前端 SPA 重构与文件命名

前端重构按 [SPA 重构与文件命名迁移清单](SPA_MIGRATION_PLAN.md) 执行。采用原生 ES Modules + Hash Router，每个页面一个 `*.page.js` 主模块，公共 UI 放入 `src/components/`，数据访问放入 `src/services/`，纯计算工具和业务规则分别放入 `src/utils/`、`src/rules/`。

迁移必须渐进进行：先建立路由与公共组件，再逐页迁移；旧 HTML/JS 在调用方迁移且测试通过前不得删除。当前 `index.html` 已切换为 SPA 壳，Hash Router、统一导航、主题切换和页面生命周期已接入；健康监控页使用原生 ES Module，其余四个页面由独立页面模块通过 iframe 兼容桥接旧业务脚本，旧 `.html` 入口已跳转至 Hash 路由。桥接是迁移过渡层，不代表这些页面已完成原生模块化。不得因 SPA 改造改变行情数据 `cache: 'no-store'`、不持久化业务数据、评分/纪律口径、数据采集脚本或 Actions 发布流程。
