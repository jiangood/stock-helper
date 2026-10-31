# SPA 重构与文件命名迁移清单

> 状态：第三阶段进行中（路由/生命周期骨架及导航、主题、Toast、加载组件已提交；尚未接入现有页面）
> 基线分支：`master`  
> 原则：先建立可验证的迁移边界；本阶段不移动、不重命名、不删除任何运行时代码。

## 1. 重构目标

将目前由多个 HTML 页面分别加载脚本的静态站点，逐步整理为一个 GitHub Pages 可直接部署的 SPA：

- 保留唯一 HTML 壳 `index.html`，通过 Hash 路由切换页面。
- 每个页面只有一个页面主模块，负责页面生命周期、渲染编排和事件协调。
- 公共组件、数据服务、纯计算规则与页面解耦。
- 使用原生 JavaScript ES Modules，不先引入 React、Vue、打包器或服务端。
- 保留旧 URL 的兼容入口，尤其是 `market.html`、`products.html`、`stock.html?code=...` 和 `health.html`。
- 不改变数据文件、数据口径、采集流程、GitHub Actions 和浏览器业务数据不缓存规则。

## 2. 当前页面与脚本盘点

| 现有入口 | 现有主脚本/关联脚本 | 目标路由 | 目标页面主模块 |
| --- | --- | --- | --- |
| `index.html` | `stock-dashboard.js`、`password-gate.js`、`croc.js`、`static-quotes.js`、`pinyin.js` | `#/stocks` | `src/pages/stocks.page.js` |
| `market.html` | `business.js`、`global-assets.js`、`stock-dashboard.js`、`password-gate.js` | `#/market` | `src/pages/market.page.js` |
| `products.html` | `products.js`、`password-gate.js` | `#/products` | `src/pages/products.page.js` |
| `stock.html?code=...` | `stock.js`、`indicators.js`、`static-quotes.js`、`croc.js`、`research-score.js` | `#/stock/:code` | `src/pages/stock-detail.page.js` |
| `health.html` | `cache-health.js` | `#/health` | `src/pages/health.page.js` |

盘点确认当前页面是独立 HTML，顶部导航通过普通链接跳转；页面脚本仍有经典脚本全局依赖和内联事件处理。迁移时应逐步移除这些隐式依赖，不能直接把旧脚本标签替换成 `type="module"` 后就视为完成。

## 3. 目标目录结构

```text
index.html
src/
  app.js
  router.js
  pages/
    stocks.page.js
    market.page.js
    products.page.js
    stock-detail.page.js
    health.page.js
  components/
    navigation.component.js
    password-gate.component.js
    theme-switcher.component.js
    toast.component.js
    loading.component.js
  services/
    quotes.service.js
    stocks.service.js
    market.service.js
    products.service.js
    cache-health.service.js
  utils/
    indicators.js
    pinyin.js
    format.js
    dom.js
  rules/
    croc.rules.js
    research-score.rules.js
  styles/
    app.css
    pages/
      stocks.css
      market.css
      products.css
      stock-detail.css
      health.css
data/                 # 保留现有结构与文件名
scripts/              # 保留现有采集、构建、校验脚本名
tests/                # 保留测试目录；迁移模块时同步更新导入路径
docs/
.github/
```

页面专属 CSS 是否拆分，以迁移时对现有内联样式和共享样式的实际盘点为准；不为追求目录整齐而制造无意义文件。

## 4. 现有文件到目标模块的映射

### 页面渲染脚本

| 当前文件 | 目标位置 | 处理方式 |
| --- | --- | --- |
| `stock-dashboard.js` | `src/pages/stocks.page.js` | 拆分页面编排与公共逻辑；不整文件机械搬迁 |
| `business.js` | `src/pages/market.page.js` + `src/services/market.service.js` | 页面渲染与行情数据读取分离 |
| `global-assets.js` | `src/pages/market.page.js` + `src/services/market.service.js` | 全球资产卡片渲染归页面，数据获取归服务 |
| `products.js` | `src/pages/products.page.js` + `src/services/products.service.js` | 商品卡片、图表编排与数据读取分离 |
| `stock.js` | `src/pages/stock-detail.page.js` + 对应 services/utils/rules | 个股详情渲染与计算拆分 |
| `cache-health.js` | `src/pages/health.page.js` + `src/services/cache-health.service.js` | 健康页渲染与监控数据读取分离 |

### 公共逻辑与适配器

| 当前文件 | 目标位置 | 说明 |
| --- | --- | --- |
| `password-gate.js` | `src/components/password-gate.component.js` | 登录遮罩组件；保留本机记住登录状态的既有行为 |
| `croc.js` | `src/rules/croc.rules.js` | 鳄鱼纪律纯业务规则；迁移前先盘点 Node 测试和浏览器调用方 |
| `research-score.js` | `src/rules/research-score.rules.js` | 研报评分计算规则；不得改变评分口径 |
| `indicators.js` | `src/utils/indicators.js` | 量价指标纯函数 |
| `pinyin.js` | `src/utils/pinyin.js` | 拼音搜索工具 |
| `static-quotes.js` | `src/services/quotes.service.js` | 浏览器同源静态行情服务；必须保持 `cache: 'no-store'` 和无业务数据持久缓存 |
| `network-status.js` | `src/components/network-status.component.js`（如确认仍有调用） | 先检查是否仍被页面使用，再决定迁移或删除 |
| `app.css` | `src/styles/app.css` | 共享样式；迁移引用时同步检查所有页面 |
| `quotes.js` | 保留在仓库根目录，后续可评估迁至 `scripts/lib/quotes.js` | 仅 Actions/Node 采集端使用，不得打入浏览器模块 |

### 数据构建和测试文件

| 当前文件/目录 | 处理方式 |
| --- | --- |
| `scripts/*.js`、`scripts/*.py` | 暂时保留现有命名和路径，避免破坏 workflow、命令行及 Python 导入 |
| `data/**/*.json` | 不重命名、不改变字段、不改变权威数据与派生读模型边界 |
| `tests/*.test.js` | 保留测试文件名；每迁移一个模块，同步更新测试导入路径和模块加载方式 |
| `.github/workflows/*.yml` | 不因前端 SPA 改造而改变数据采集与发布触发条件 |

## 5. 文件命名规范

- 文件名全部使用小写英文和 kebab-case。
- 页面入口统一为 `<page>.page.js`。
- 组件统一为 `<name>.component.js`。
- 服务统一为 `<name>.service.js`。
- 业务规则统一为 `<name>.rules.js`。
- 通用工具使用有明确领域含义的名称，例如 `indicators.js`、`pinyin.js`、`format.js`；不使用 `common.js`、`utils2.js`、`main-new.js`。
- 测试继续使用 `<module>.test.js`。
- 数据采集/构建脚本沿用现有动词前缀，例如 `fetch_*.py`、`build_*.js`；本次不强行把 Python/Actions 文件改成前端 kebab-case。
- 不把 `quotes.js` 采集端 SDK 与浏览器 `static-quotes.js` 混为一个模块。

## 6. 路由与旧链接兼容

采用 Hash 路由，避免 GitHub Pages 服务端重写：

- `/` 和 `#/stocks` → 自选页
- `#/market` → 行情页
- `#/products` → 商品页
- `#/stock/sz002408` → 个股详情
- `#/health` → 系统健康

兼容层要求：

1. 旧 `market.html`、`products.html`、`health.html` 访问时跳转到对应 Hash 路由。
2. 旧 `stock.html?code=sz002408` 读取并规范化 code，再跳转到 `#/stock/sz002408`。
3. 旧页面 URL 的 query 参数、大小写及缺失 code 场景要有测试。
4. 个股分享链接、浏览器前进/后退和直接刷新 Hash 路由必须可用。
5. 迁移完成前不要删除旧 HTML 兼容入口。

## 7. 实施顺序与验收

1. **阶段一：盘点与规范（当前）**：建立本清单，明确文件映射、命名规范和不变边界。
2. **阶段二：SPA 外壳**：新增 `src/app.js`、`src/router.js`、基础页面容器和路由测试；旧页面暂时保留。
3. **阶段三：公共基础设施**：迁移主题、导航、密码门、Toast、加载状态和数据服务。
4. **阶段四：逐页迁移**：自选 → 行情 → 商品 → 个股详情 → 健康监控；每页迁移后做新旧结果对照。
5. **阶段五：清理兼容层**：只有在旧 URL 全部兼容且测试覆盖后，才考虑删除重复页面模板和旧脚本。
6. **阶段六：完整验收**：运行 JS/Python 测试、数据校验、语法检查，并检查 GitHub Actions。

每一阶段都必须检查：
- 路由加载、直接刷新、前进/后退和移动端导航。
- 空数据、缺字段、请求失败和重复初始化。
- 页面事件是否重复绑定，页面卸载时是否清理监听器及 ECharts 实例。
- 主题、密码验证和本机用户偏好是否保留。
- 行情请求是否继续禁用缓存；不得把业务数据写入 localStorage、IndexedDB、Cache API 或内存 Map。
- 评分、纪律、复权口径、数据时间和缺失值处理与重构前一致。

## 8. 本阶段明确不做的事情

- 不创建 SPA 代码骨架，不切换任何页面入口。
- 不重命名或删除现有 JS/CSS/HTML 文件。
- 不修改股票评分、交易纪律、数据采集和数据文件。
- 不引入框架、构建器或 npm 依赖。
- 不把本阶段的盘点文档提交描述成 SPA 已经完成。

当前处于第三阶段：公共导航、主题切换、Toast 和加载状态已形成独立模块，但尚未替换旧页面中的对应实现。旧 HTML URL 当前已具备路由解析规则，但尚未增加重定向脚本；旧页面仍保持原样运行。所有旧文件只有在调用关系已迁移并通过测试后才可清理。
