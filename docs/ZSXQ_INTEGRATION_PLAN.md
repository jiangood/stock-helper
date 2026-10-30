# 知识星球（zsxq）接入方案

> 目标：把某个**指定星球**中**星主**的发言（话题）及其**评论**采集进本项目 H2，供后台按时间线查阅、检索，并与股票池人工对照。
> 状态：计划（未实现）。本文只描述方案与验收口径，代码落地另行提交。

## 1. 背景与目标

现有采集链路全部围绕公开行情 / 基本面 / 商品与全球资产，缺少"人工观点"这一层输入。知识星球里的星主发言常包含对个股、板块、买卖节奏的判断，属于**非结构化、需人工判断**的参考信息，不能参与机器评分与交易信号，但适合作为研究素材归档。

本期要解决的问题：

1. 用 `zsxq-sdk` 拉取某个固定星球的星主话题（含正文、图片、点赞、阅读、评论数）。
2. 拉取这些话题下的评论（含评论者、被回复者、置顶标记）。
3. 增量、幂等、可重跑地写入 H2；失败保留上次有效数据。
4. 后台提供时间线与详情页，能按时间 / 关键词 / 是否有评论过滤。
5. 采集纳入现有 `SyncService` 串行体系与 `sh_sync_log`，可在「数据同步」页手动触发，也可由 Quartz 定时执行。

**明确不做**：不写入 `sh_research_report`，不改变机器评分、纪律、买入评分、止盈阈值；不对发言内容做自动"利好/利空"判定；不把内容当作行情数据源；不对外发布或二次分发。

## 2. 依赖与可行性

### 2.1 SDK 选型

| 项 | 结论 |
| --- | --- |
| 坐标 | `io.github.yiancode:zsxq-sdk:1.3.2`（Maven Central 可下载，已验证 POM 返回 200） |
| 语言 | Java 11+，本项目 Java 版本可直接使用 |
| 运行时依赖 | `okhttp 4.12.0`、`gson 2.10.1`、`slf4j-api`；`lombok` 为 provided |
| 能力 | `groups().list()/get()`、`topics().list(groupId, options)`、`topics().get(topicId)`、`topics().getComments(topicId, options)` |
| 认证 | 请求头 `authorization`，从 `wx.zsxq.com` 登录后 F12 抓取；SDK 内置 HMAC-SHA1 签名 |
| 许可 | MIT，但**非官方 SDK**，接口随时可能变更 |

### 2.2 关键结论（决定了后面的设计）

1. **可以只取星主话题**：`ListTopicsOptions.scope("by_owner")` 对应"仅星主/合伙人"视角；仍需在本地按 `talk.owner.user_id` 再过滤一次，防止 scope 语义变化或星球角色变更导致混入他人内容。
2. **没有游标分页参数**：SDK 的 `ListTopicsOptions` 只有 `count / scope / direction / begin_time / end_time / with_invisibles`，没有 `end_topic_id`。因此**回填只能按时间窗切片**（例如每次 30 天、`count=20`，窗口内不足一页时继续向前挪窗），不能依赖翻页。
3. **评论要单独请求**：话题列表返回的 `Topic` 只带 `commentsCount`，不含评论正文；需要按 `topicId` 调 `getComments`，评论同样没有分页游标（只有 `count / sort / with_sticky`），单话题评论超过 `count` 时只能调大 `count` 拉全量并记录截断标记。
4. **SDK 内部信任所有 TLS 证书**（`HttpClient` 里自定义 `TrustManager`）。这是 SDK 的上游行为，无法在调用侧关闭。对策：只通过它访问 `https://api.zsxq.com`，不把用户可控 URL 传给它；同时把 SDK 封装在自有接口后，未来可换成本项目 `QuoteFetcher` 风格的原生 HTTP 客户端。
5. **响应模型较薄**：`Topic` 只有 `topicId / topicUid / group / type / createTime / talk / likesCount / commentsCount / rewardsCount / readingCount / digested / sticky`，`talk` 中有 `owner / text / images`。**没有标题字段**，列表展示需从正文截取；**没有原始 JSON 字段**，若要做"原文留存 + 未来字段兼容"，应在适配层自行序列化一次（SDK 对象 → `Map`/JSON）。

### 2.3 架构约束

- 不引入需要外部数据库的服务；SDK 只做 HTTP 出口，H2 仍是唯一数据源。
- SDK 版本固定，禁止使用 `LATEST`；升级需单独 PR 并附接口兼容性验证。
- 若 Spring Boot 4.1 管理的 `okhttp` 版本与 SDK 编译版本（4.12.0）冲突，**在 `pom.xml` 中显式锁定 4.12.0**，并补一条真实网络冒烟测试（手工执行，不纳入 CI）。

## 3. 总体设计

```
Quartz / 手动触发
      │
StockSyncJob(type=zsxq) ──► SyncService（全局串行锁）
      │
      └─► ZsxqSyncService.sync(manual)
              │
              ├─ ZsxqClientPort（接口，隔离 SDK）
              │     └─ SdkZsxqClient：token、超时、重试、限速、scope=by_owner
              ├─ 时间窗回填 / 增量游标（取 sh_zsxq_topic 的 max(create_time)）
              ├─ 话题 upsert（topic_id 幂等）
              ├─ 评论拉取（新增话题 + comments_count 变化的话题）
              └─ 写 sh_sync_log（syncType=zsxq）
```

设计要点：

- `ZsxqClientPort` 是唯一接触 SDK 的地方，方法入参出参用本项目自己的轻量 DTO（或 `Map`），便于单测打桩、必要时替换实现。
- 评论与话题分两次写，先写话题成功再拉评论；评论失败只标记该话题 `commentsSynced=false`，下轮重试，不影响已入库话题。
- 采集与页面读取解耦：页面只读 H2，不发外部请求。

## 4. 数据模型

新增 3 张表，前缀沿用 `sh_`，唯一业务键建唯一索引。全部继承 `BaseEntity`。

### 4.1 `sh_zsxq_group`（星球元信息，单条即可）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `group_id` | varchar(30) 唯一 | 星球 ID |
| `name` | varchar(120) | 星球名称 |
| `owner_id` | varchar(30) | 星主 user_id（用于二次过滤） |
| `owner_name` | varchar(80) | 星主昵称 |
| `description` | text | 星球简介 |
| `member_count` / `topic_count` | int | 采集时的统计快照，可能为空 |
| `last_synced_at` | timestamp | 最近一次成功采集 |

### 4.2 `sh_zsxq_topic`（星主话题）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `topic_id` | varchar(30) 唯一 | 话题 ID，幂等键 |
| `topic_uid` | varchar(60) | 话题 uid，允许为空 |
| `group_id` | varchar(30) | 所属星球 |
| `author_id` / `author_name` | varchar(30) / varchar(80) | 发言人（应等于星主） |
| `type` | varchar(20) | `talk` / `q&a` / `task` / `solution` |
| `create_time` | timestamp | 发言时间（东八区解析后存 UTC） |
| `text` | text | 正文纯文本 |
| `images_json` | text | 图片 URL 数组 JSON |
| `likes_count` / `comments_count` / `reading_count` / `rewards_count` | int | 采集时快照 |
| `digested` / `sticky` | boolean | 精华 / 置顶 |
| `comments_synced` | boolean | 评论是否已成功拉取 |
| `source_url` | varchar(300) | `https://wx.zsxq.com/dweb2/index/topic_detail/{topicId}` |
| `raw_json` | text | 原始响应片段，便于事后补字段 |
| `fetched_at` | timestamp | 最近一次采集时间 |

索引：`uk_sh_zsxq_topic` (`topic_id`)，普通索引 `idx_sh_zsxq_topic_time` (`group_id, create_time`)。

### 4.3 `sh_zsxq_comment`（评论）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `comment_id` | varchar(30) 唯一 | 评论 ID，幂等键 |
| `topic_id` | varchar(30) | 所属话题，索引 |
| `author_id` / `author_name` | varchar(30) / varchar(80) | 评论者 |
| `repliee_id` / `repliee_name` | varchar(30) / varchar(80) | 被回复者，可为空 |
| `text` | text | 评论正文 |
| `create_time` | timestamp | 评论时间 |
| `likes_count` | int | 点赞数 |
| `sticky` | boolean | 是否置顶 |
| `is_owner` | boolean | 评论者是否为星主 |
| `fetched_at` | timestamp | 采集时间 |

幂等：`comment_id` 已存在则更新可变字段（点赞、正文），不重复插入。
删除策略：**不做物理删除**。远端已删的话题/评论保留本地快照并置 `missing=true`（可选字段，二期再加），避免"续费到期后历史内容消失"。

### 4.4 迁移说明

- 仅新增表与索引，`ddl-auto=update` 可自动建表；不修改既有表。
- 不写入 `data/` 种子 JSON（内容受版权与授权限制，不入仓库）。新环境从零开始采集。

## 5. 采集流程

### 5.1 首次回填

1. 读配置 `stock.zsxq.group-id`，调 `groups().get()` 落库星球元信息，取 `owner_id`。
2. 以"今天"为右边界，按 `stock.zsxq.backfill-months`（默认 24 个月）逐窗口向前取，窗口长度默认 30 天。
3. 每个窗口：`topics().list(groupId, options.count(20).scope("by_owner").beginTime(w).endTime(w_end).direction("backward"))`。
4. 过滤 `author_id == owner_id`；`topic_id` 已存在则跳过（只更新计数类字段）。
5. 每窗口之间 sleep `stock.zsxq.min-interval-ms`（默认 1500ms），单次运行最多 `stock.zsxq.max-topics-per-run`（默认 200）条话题，超限则记录 `partial=true`，下轮从游标继续，**不一次跑满**。
6. 回填期间不拉评论（避免请求量翻倍）；回填结束后统一补评论，或由下一轮增量补齐。评论补齐规则见 5.3。

### 5.2 增量

1. 取 `max(create_time)` 作为游标，向前重叠 1 天（`begin_time = 游标 - 1d`），防止边界漏采。
2. `direction("backward")`、`count=20` 取最新一页；若返回话题数 == count，继续按时间窗向前补取，直到命中本地已有 `topic_id` 或达到单轮上限。
3. 星主修改发言不会产生新 `topic_id`：对重叠窗口内已存在的话题，更新 `likes/comments/reading/rewards` 快照，正文仅在长度变化时覆盖。
4. 远端已不可见（`with_invisibles=false` 默认）不视为删除，本地保留。

### 5.3 评论

评论是本期的主要成本项，按以下优先级排队：

1. `comments_synced = false` 且 `comments_count > 0` 的话题（新话题、历史失败）。
2. `comments_count > 本地已存评论数` 的话题（有新评论）。
3. 其余话题跳过。

单话题调用 `getComments(topicId, options.count(100).sort("asc").withSticky(true))`：

- 返回条数 == `count` 且 < `comments_count` 时判定截断：本轮只存前 100 条，`comments_synced=false`，记录截断日志，下轮用 `sort("desc")` 补取尾部（按 `comment_id` 去重合并）。
- 评论 0 条也置 `comments_synced=true`，避免每轮重复请求。
- 单轮评论请求数上限 `stock.zsxq.max-comments-per-run`（默认 100 个话题）。

### 5.4 限速、重试与失败保留

- 所有请求串行，最小间隔 `min-interval-ms`，SDK 自带 `retry(3)` 再叠加上层"失败 1 次后跳过单话题"。
- `TokenExpiredException`：立即终止本轮，`sh_sync_log` 记 `failed`，消息写"token 已过期，请更新 ZSXQ_TOKEN"，页面顶部提示；**不重试**，避免风控。
- 限流（HTTP 403/429 或业务码提示频繁）：指数退避 5s / 15s / 45s，仍失败则终止本轮，保留已采数据。
- 单话题 / 单评论失败不影响其他话题；本轮 `partial=true` 时日志写清失败数量。
- 已入库内容不会被空值覆盖：只有远端返回的字段非空才更新。

### 5.5 与现有采集体系的关系

- `SyncService` 增加 `zsxq` 类型：单跑 `zsxq` 或 `all` 时排在最后（它是外部第三方接口，优先级最低）。
- 仍使用 `runningType` 原子锁，同一时间只跑一个采集任务。
- `sh_sync_log.syncType` 取值新增 `zsxq`。

## 6. 配置项

`application.yml` 追加（token 只从环境变量读，不落库、不入仓库）：

```yaml
stock:
  zsxq:
    enabled: false          # 默认关闭，避免无 token 环境启动即报错
    token: ${ZSXQ_TOKEN:}
    group-id: ""            # 目标星球 ID
    cron: "0 15 8,20 * * ?"
    backfill-months: 24
    window-days: 30
    page-size: 20
    min-interval-ms: 1500
    max-topics-per-run: 200
    max-comments-per-run: 100
    timeout-ms: 15000
```

`StockProperties` 新增 `Zsxq` 内部类，字段一一对应。

启动守卫：`enabled=true` 但 `token` 或 `group-id` 为空时，只打 WARN 并跳过注册任务，**不允许启动失败**（与现有 `sync.enabled` 的降级风格一致）。

## 7. 后端接口与权限

`ZsxqController`，路径 `admin/zsxq`，统一返回 `AjaxResult`：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `admin/zsxq/group` | `zsxq:read` | 星球元信息 + 最近采集时间 |
| GET | `admin/zsxq/topics` | `zsxq:read` | 分页；参数 `page`、`size`、`begin`、`end`、`keyword`、`onlyWithComments`、`sticky`、`digested` |
| GET | `admin/zsxq/topics/{topicId}` | `zsxq:read` | 话题详情 + 评论列表（按时间升序） |
| POST | `admin/zsxq/sync` | `zsxq:sync` | 手动触发，复用 `SyncService.runAsync("zsxq", true)` |

- 列表默认按 `create_time desc`，单页默认 20，上限 100。
- `keyword` 用 `text like %kw%`，需对 `%`/`_` 转义；不支持全文索引（H2 内数据量可控，预计万级话题）。
- 无数据时返回空数组 + `total=0`，页面显示空态，**不返回假数据**。

菜单权限（`application-menu-stock.yml`）：

```yaml
zsxq:
  name: 知识星球
  icon: BookOutlined
  seq: 30
zsxq-timeline:
  pid: zsxq
  name: 星主观点
  path: /zsxq
  icon: CommentOutlined
  perms:
    - {name: 读取, code: zsxq:read}
    - {name: 采集, code: zsxq:sync}
```

## 8. 前端

`web/src/pages/zsxq/index.jsx`（约定式路由 `/zsxq`）：

- 顶部：星球名、星主、最近采集时间、「立即采集」按钮（`PermActions` 包 `zsxq:sync`）、采集运行状态（复用 `admin/sync/status` 的 `running`）。
- 过滤区：时间范围（`RangePicker`）、关键词输入、仅看有评论 / 精华 / 置顶开关。
- 列表：时间、正文摘要（2 行省略）、图片数、评论数、点赞、阅读、标签列（精华/置顶）。
- 点击行打开 `Drawer`：正文全文、图片缩略图（外链，点击新窗口打开原图）、评论时间线（星主评论加标记）、`source_url` 跳转原站。
- 分页用服务端分页；`onShow()` 刷新（与现有页面一致）。
- 时间格式化统一走 `web/src/lib/format.js`；只读页面，不引入新的色值类。

不在前端做图片代理或下载，避免额外的存储与版权问题。

## 9. 定时任务

- 新建 `ZsxqSyncJob extends BaseJob`，`@JobDescription(label="知识星球采集", params={type})`，默认 `type=zsxq`。
- `StockJobInitializer` 增加规格：`name=知识星球采集`、`cron=properties.getSync()...`（实际放 `stock.zsxq.cron`）、`type=zsxq`、聚合方式 `PER_RUN`。
- 已存在任务不覆盖；`enabled=false` 或缺少 token 时不注册。
- 首次注册后，用户可在「系统管理 → 定时任务」自行改 cron / 停用。

## 10. 合规与安全

1. **凭据**：`ZSXQ_TOKEN` 只放在环境变量或部署机的 secret 中；`application.yml` 只写占位；日志、`sh_sync_log`、异常栈都不得打印 token；SDK 的 `authorization` 头不写入任何实体。
2. **内容边界**：仅本人可见的后台归档，不开放匿名访问，不提供导出/分享接口；页面展示保留作者与原文链接。
3. **爬取礼貌**：串行 + 最小间隔 1.5s + 单轮上限，避免高频请求；不做全站抓取，只取一个星球。
4. **服务条款**：SDK 为第三方非官方实现，需自行确认账号授权范围；若星球方要求停止采集，通过配置 `enabled=false` 一键停用，本地数据可整表清理。
5. **数据最小化**：只存发言与评论正文、作者昵称与 ID、图片 URL；不存用户手机号、地区等无关字段。

## 11. 测试计划

| 类型 | 内容 |
| --- | --- |
| 单元测试 | `ZsxqMapperTest`：SDK 模型 → 实体的字段映射、时间解析（`2026-08-17T00:00:00.000+0800`）、空值处理、`raw_json` 生成 |
| 单元测试 | `ZsxqSyncServiceTest`：用假 `ZsxqClientPort` 验证幂等 upsert（同 topic 两次不重复）、星主过滤（混入他人话题被丢弃）、评论截断标记、token 过期立即终止、`partial` 日志 |
| 单元测试 | `ZsxqWindowTest`：时间窗切分（含跨月、月末、时区）与增量重叠 1 天 |
| 单元测试 | 分页与关键词转义（`%`、`_`） |
| 前端 | `cd web && npm run build` 通过；手动验证空态、错误态、分页、抽屉 |
| 手工冒烟 | 配好真实 token 后跑一次 `zsxq`，检查话题数、评论数、`sh_sync_log` 记录；不放入 CI（无凭据） |

CI 仅跑 `mvn test` + `npm run build`，不给仓库配置任何真实 token。

## 12. 任务拆解与里程碑

| 阶段 | 交付物 | 涉及文件 |
| --- | --- | --- |
| M1 骨架 | 依赖、配置、SDK 适配层 | `pom.xml`、`StockProperties`、`application.yml`、`sync/ZsxqClientPort.java`、`sync/SdkZsxqClient.java`、`sync/ZsxqModels` |
| M2 存储 | 三个实体 + 仓储 + 手动触发链路 | `domain/ZsxqGroup|ZsxqTopic|ZsxqComment`、`repository/*`、`ZsxqSyncService`、`SyncService`、`SyncController`、`StockSyncJob` 参数说明 |
| M3 调度 | Job + 注册 + 日志 | `job/ZsxqSyncJob`、`StockJobInitializer` |
| M4 接口 | 查询与详情 API + 权限 | `controller/ZsxqController`、`application-menu-stock.yml` |
| M5 页面 | 时间线 + 详情抽屉 | `web/src/pages/zsxq/index.jsx`、`web/src/lib/format.js`（如需新增格式化函数） |
| M6 验证 | 单测、文档更新、真实冒烟记录 | `src/test/java/.../zsxq/*`、`docs/DATABASE_ARCHITECTURE.md`、`docs/DEVELOPMENT_GUIDE.md`、`README.md` 采集说明 |

每个阶段一个 PR，按 M1 → M6 顺序合并；M1 合入前不启用任务（`enabled=false` 默认关闭）。

## 13. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 非官方接口变更 / 字段消失 | 采集中断 | 适配层隔离、`raw_json` 留档、单测覆盖映射；失败保留旧值并告警 |
| Token 过期或被风控 | 无法采集 | 启动校验、`TokenExpiredException` 立即终止、页面提示更新 `ZSXQ_TOKEN` |
| 时间窗回填漏采（无游标分页） | 历史不全 | 窗口间重叠 1 天、增量再重叠 1 天、记录每窗口条数与命中数便于核对 |
| 评论价格高、单话题评论超 100 条 | 数据不全 | 双方向补取 + `comments_synced` 标记 + 单轮上限 |
| SDK 信任所有 TLS 证书 | 中间人风险 | 仅访问固定官方域名、封装后可替换传输层；在 README 说明该上游行为 |
| `okhttp` 版本与 Spring Boot 管理冲突 | 运行期 `NoSuchMethodError` | 显式锁定 4.12.0，冒烟测试覆盖 |
| H2 体积增长（正文 + 原始 JSON） | 备份变大 | 只存必要字段、`raw_json` 仅保留精简片段、提供全量清理入口（二期） |
| 内容版权与授权 | 合规风险 | 仅内部归档、保留来源、不导出不转发、可一键停用 |

## 14. 验收标准

1. 配置 `ZSXQ_TOKEN` 与 `group-id` 后，手动触发 `zsxq` 能落库话题与评论，`sh_sync_log` 有 `success` 记录。
2. 连续跑两次，`sh_zsxq_topic` / `sh_zsxq_comment` 行数不增加（幂等）。
3. 断网或 token 失效时，已有数据不被清空或覆盖，日志为 `failed` 且带可读原因。
4. `/zsxq` 页面能按时间、关键词、评论数过滤并打开详情，评论按时间展示，星主评论有标记，空数据时显示空态。
5. `mvn test` 与 `cd web && npm run build` 通过；新增指标类逻辑不触碰既有评分/信号测试。
6. 未配置 token 的干净环境可以正常启动，且不会注册知识星球任务。

## 15. 待确认问题

1. 目标星球的 `group_id` 与星主是否只有一个（多星主时需要采集多个 `owner_id`？）。
2. 评论范围：只存星主本人的评论，还是话题下全部成员评论？本文按"全部评论 + 标记星主"设计，存储量更大。
3. 回填范围：24 个月是否合适，是否需要按星球实际内容量调整单轮上限。
4. `/zsxq` 页面是否仅管理员可见，还是所有已登录后台用户可见（影响权限码分配）。
5. 是否需要把发言中出现股票名/代码自动关联到 `sh_stock`（本文列为二期，不纳入 MVP）。
