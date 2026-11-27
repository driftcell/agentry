# MCP Registry Server 实施路线图

## 使用说明

- 按 **M0 → M7** 推进；标注为可并行的里程碑，也必须先满足其依赖。
- 每个任务完成后勾选复选框；里程碑的「出口验收」全部通过后，才能视为该阶段完成。
- 先冻结协议与领域不变量，再实现端点和 UI，避免前后端各自解释业务规则。
- 不通过增加 MCP Tool 绕过人类审批；不在服务端执行返回给客户端的 `curl` / `tar` 命令。
- 本路线图不排绝对工期；以出口验收和端到端场景作为完成标准。

## 全局不变量

1. 同一服务同时提供 `/mcp` 与 `/admin/mcp` 两组 Streamable HTTP 入口，并共用鉴权与项目解析中间件。
2. 普通读取始终限定在解析后的 Project 及其 **Active Revision**；路径、Header、Key 默认值之间的优先级不可被 Tool 参数悄悄改变。
3. 文件入库时计算 SHA-256、大小和 `o200k_base` Token 数；读取接口不重复做全量 Token 计算。
4. Agent 只能提交修订、解决冲突和激活**已获人类批准**的修订，不能代替人类 Approve。
5. `activate_revision` 必须在数据库事务内同时校验状态、切换 `projects.active_revision_id` 并更新 Revision 状态。
6. PostgreSQL 保存结构化内容、元数据与索引；大文件和非文本附件通过外部 S3 兼容对象存储交付。
7. MCP 返回紧凑字段与按需内容；OSS 密钥、Bearer 明文和内部错误细节不得进入响应或日志。

## 里程碑总览

| 里程碑 | 交付目标 | 依赖 | 实施方式 |
| --- | --- | --- | --- |
| M0 工程与数据基线 | 可启动工程、Compose、SQLx Schema、初始化 Seed | 无 | 最先完成 |
| M1 存储与内容流水线 | S3 兼容 OSS、内容摘要、Token 与 Markdown 索引 | M0 | 可与 M2 并行 |
| M2 鉴权与 ProjectContext | 四组路由统一鉴权、项目隔离、Scope 与调用统计 | M0 | 可与 M1 并行 |
| M3 Revision 领域核心 | 三方合并、冲突、人工审批、原子激活 | M1 | 在端点开发前完成 |
| M4 只读 `/mcp` | Skills、Resources、Workspace、分片读取、Bundle 下载 | M2、M3 | 可与 M5 并行 |
| M5 管理 `/admin/mcp` | 上传、提案、状态查询、冲突解决、激活、平台管理 | M2、M3 | 可与 M4 并行 |
| M6 Web 工作台 | Dashboard、Explorer/Diff、Review Queue、平台管理 | M3；联调依赖 M4/M5 | 可先做工装，再接真实 API |
| M7 工程化与发布 | 前端构建链、Pre-commit、容器交付、E2E、安全与文档 | M0—M6 | 门禁前置，最终统一验收 |

## M0　工程与数据基线

**目标：** 从空仓库得到可迁移、可启动、可测试的最小系统。

- [ ] **T0.1　建立 Rust Workspace 与前端骨架。** 固定 Rust 1.100.0、Axum、SQLx、`rmcp` v3.11.0、`tiktoken-rs`；建立 `crates/server/`、`web/` 与 `xtask` 工程边界，固定 Bun 1.4.5。
- [x] **T0.2　建立最小 Docker Compose。** 仅编排 `postgres:17-alpine` 和 `mcp-registry-server`；OSS 使用外部服务，不在 Compose 内隐式增加对象存储容器。
- [x] **T0.3　实现配置加载与启动校验。** 覆盖数据库连接、服务监听地址及 `OSS_ENDPOINT`、`OSS_REGION`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_SECRET_ACCESS_KEY`、`OSS_VIRTUAL_HOST_STYLE=true`；缺失或非法配置应在启动时给出明确错误。
- [x] **T0.4　设计并执行 SQLx Migration。** 至少覆盖 Users、API Keys（含 `default_project_id`、Scopes、吊销状态）、Projects（含 `active_revision_id`）、Revisions、Revision Files、`content_blobs`、`transfer_sessions`，以及审批意见和调用统计所需记录。
- [x] **T0.5　建立数据库约束与索引。** 保证摘要、项目 Slug、Revision 关联、状态查询和 Active Revision 读取有合适唯一约束或索引；防止悬空项目上下文与重复激活指针。
- [x] **T0.6　实现初始化 Seed。** Migration/初始化流程创建默认超级管理员 `admin` / `admin`（密码使用 Argon2id 哈希）及 `default` 示例项目；重复执行不得产生重复数据。
- [x] **T0.7　建立健康检查与最小测试工装。** 提供服务健康检查和数据库连通检查；集成测试可独立建库、跑 Migration、清理数据。

**出口验收**

- [x] 全新环境可启动 PostgreSQL、执行 Migration、完成 Seed 并启动空壳服务。
- [x] Seed 重入安全，数据库中不存在明文管理员密码。
- [x] 配置错误会快速失败，不会以半初始化状态接收请求。

## M1　存储与内容流水线

**目标：** 所有后续读取、Diff 和 Revision 操作共用同一套内容寻址与 Token 元数据。

- [x] **T1.1　实现 S3 兼容 OSS 驱动。** 支持阿里云 OSS、AWS S3、Cloudflare R2 的 Endpoint/Region/Bucket/凭证配置及 Virtual Host Style；封装上传、下载、删除/清理和 Presigned GET/PUT。
- [x] **T1.2　定义对象键与本地路径边界。** 统一 Project、Revision、Transfer Session 下的对象键规则；拒绝绝对路径、`..` 穿越、重复规范化路径和跨项目引用。
- [x] **T1.3　实现 `content_blobs` 内容寻址。** 保存 `sha256` 摘要、大小、文本存储位置或 OSS 对象键、媒体类型与 Token 元数据；相同内容复用时不破坏 Revision 的不可变性。
- [x] **T1.4　实现入库计算流水线。** 使用 SHA-256 校验完整性，使用 `tiktoken-rs` 的 `o200k_base` 预计算文件总 Token 数，并记录计算失败与重试结果。
- [x] **T1.5　建立 Markdown 结构索引。** 解析 H1—H3、章节边界与各节 Token 数，为 `outline`、`section` 和 Token 增减统计提供稳定数据。
- [x] **T1.6　实现 Transfer Session 生命周期。** 保存上传会话与 Project、文件清单、OSS 对象键、预期摘要、过期时间和完成状态；过期或未校验内容不得进入 Revision。
- [x] **T1.7　实现文本与大附件分流。** Markdown 原文可从 PG 毫秒级读取；非文本大附件返回外部 OSS 签名链接或受控重定向，不把二进制内容塞入 MCP JSON。

**出口验收**

- [x] 同一文件从上传到读取的 SHA-256、大小和 Token 数一致。
- [ ] S3 兼容集成测试覆盖 Presigned PUT、后端拉取、Presigned GET 与过期场景。
- [x] 路径穿越、摘要 mismatch、过期 Session 和跨 Project 对象引用均被拒绝。

## M2　鉴权与 ProjectContext

**目标：** 四组 MCP 路由只使用一套确定、可测试的鉴权和项目解析规则。

- [x] **T2.1　实现 Bearer API Key 鉴权。** 支持安全存储与校验、项目绑定、全局 Key、Scope、吊销和过期校验；日志不得记录完整 Key。
- [x] **T2.2　实现共用中间件与 `ProjectContext`。** 上下文至少携带当前 User/API Key、Project、全局 Key 标记与有效 Scopes，并传递给所有 MCP Handler。
- [x] **T2.3　实现固定路由的项目解析。** 对 `/mcp` 和 `/admin/mcp`，严格按 `X-MCP-Project` → 当前 Key 的 `default_project_id` 解析；仅 `/admin/mcp` 的全局 Key 可在 Tool 参数中用 `project_slug` 兜底。
- [x] **T2.4　实现项目路径路由解析。** 对 `/mcp/projects/{slug}` 和 `/admin/mcp/projects/{slug}`，URL Slug 优先；同时校验 Key 对该 Project 的 `mcp:read` 或相应 `admin:*` 权限，失败时不得回退到其他项目。
- [x] **T2.5　建立 Tool/Action 到 Scope 的默认拒绝映射。** 普通读取使用 `mcp:read`；提案、激活、平台管理分别校验 `admin:propose`、`admin:activate`、`admin:platform`，不得只校验「是否为管理员 Key」。
- [x] **T2.6　记录最小调用统计。** 为 Dashboard 记录 API Key、Project、端点、Tool/协议方法、结果状态和耗时等元数据；不记录文件正文、Bearer 明文或完整 Presigned URL。
- [x] **T2.7　统一鉴权与解析错误。** 区分未认证、权限不足、项目不存在、项目上下文缺失和冲突的项目指定方式，响应不泄露其他 Project 是否存在及其内容。

**出口验收**

- [ ] 表驱动测试覆盖四组路由、每种项目来源及优先级组合。
- [x] 跨项目 Key、吊销 Key、缺失 Scope、路径越权和非法 `project_slug` 均被拒绝。
- [x] 同一 Tool 在固定路由与 Slug 路由下获得一致、可审计的 `ProjectContext`。

## M3　Revision 领域核心

**目标：** 把审批与合并规则做成独立领域服务，MCP 与 Web 只调用同一实现。

- [x] **T3.1　实现 Revision 状态机。** 覆盖 `pending_review`、`approved`、`rejected`、`conflict`、`active`；仅允许蓝图规定的迁移，非法迁移返回领域错误且不产生部分写入。
- [x] **T3.2　建立不可变 Revision Snapshot。** 提案固定 `base_revision_id`、文件清单、Blob 摘要、完整 `commit_message` 和 Token 元数据；后续读取与 Diff 不受新版本提交影响。
- [x] **T3.3　实现三方合并。** 以 Base、当前 Active、Incoming 为三方输入；无同行冲突时生成待审 Snapshot，有冲突时进入 `conflict` 并保存路径与冲突行摘要。
- [x] **T3.4　实现冲突解决领域服务。** 校验 `resolutions` 的路径和内容/OSS Key，重新计算 SHA-256、Token 与文件差异，完成后把 Revision 重新置为 `pending_review`。
- [x] **T3.5　实现文件级 Token Diff。** 对新增、修改、删除文件计算增减量，为 Review Queue 提供 `+320 / -45 tokens` 一类紧凑统计，并与预计算结果一致。
- [x] **T3.6　实现人类审批服务。** Web 人类管理员可填写评论并 Approve、Approve & Activate Now 或 Reject；审批记录保存评论与操作者，Agent Tool 不得调用审批写接口。
- [x] **T3.7　实现原子激活。** 在单个数据库事务中锁定目标 Revision，强校验 `status == 'approved'`，切换 `projects.active_revision_id` 并更新目标状态；并发激活不得激活错误 Project 或过期 Revision。
- [x] **T3.8　定义历史 Active 的表示。** 以 `projects.active_revision_id` 作为当前版本唯一判据，保留历史 Revision 的可审查性，避免通过残留状态误判当前 Active。

**出口验收**

- [x] 单元测试覆盖所有合法/非法状态迁移和 Base/Active/Incoming 三方组合。
- [x] 两个并发激活请求不会造成 Project 指针与 Revision 状态不一致。
- [x] `pending_review`、`rejected`、`conflict` Revision 均不能绕过 Web 审批被激活。
- [x] MCP 与 Web 获取到完全一致的 Diff、冲突和 Token 统计。

## M4　只读 `/mcp`

**目标：** 让客户端以固定地址或项目 Slug 地址读取当前 Active Revision，并尽量降低上下文 Token 消耗。

- [x] **T4.1　挂载只读 MCP 入口。** 配置 `/mcp` 与 `/mcp/projects/{slug}` 的 Streamable HTTP（`rmcp` v3.11.0、`json_response: true`），统一接入 M2 中间件。
- [x] **T4.2　实现 `skills/list` 与 `skills/get`。** 按 SEP-2640 契约支持 `cursor` / `uri`，只暴露当前 Active Revision 下 `skills/<name>/SKILL.md` 的 `skill://` URI、YAML Frontmatter 和附属文件 `{ uri, digest, size }` 清单。
- [x] **T4.3　实现 `resources/read` 与 `resources/directory/read`。** 按 URI 读取 PG 中的 Markdown 原文或目录内容；非文本大附件返回/重定向至 OSS 签名链接，并校验 URI 属于当前 Project/Active Revision。
- [x] **T4.4　实现 `inspect_workspace`。** 支持可选 `kind_filter`，以紧凑树状文本返回 `CLAUDE.md`、`AGENTS.md`、`skills/*`、`agents/*` 的路径、一行描述和文件总 Token 数。
- [x] **T4.5　实现 `read_slice`。** 支持 `path`、`mode: outline | section | full`、可选 `section` 与 `max_tokens`；Outline 只含 H1—H3 和各节 Token 数，Section 只返回指定章节，Full 遵守 Token 上限并明确截断结果。
- [x] **T4.6　实现 `pull_bundle_url`。** 支持 `paths[]`、`local_target_dir`、`format: tar_gz | single`，生成最小权限、短时效的 Presigned GET URL，以及经过 Shell 安全转义的下载/解包命令。
- [x] **T4.7　收紧响应 Schema。** 所有结构体使用紧凑字段；列表游标、空结果、缺失章节、过大响应和 OSS 重定向均有稳定契约，不返回内部数据库行或冗余对象图。
- [x] **T4.8　建立 MCP 合约与 Token 回归测试。** 固定典型响应 Snapshot，验证字段、URI、Digest、Token 数和分页稳定性；发现响应体积异常增长时使测试失败。

**出口验收**

- [x] 客户端只配置固定 `/mcp`，即可由项目专属 Key 自动隔离上下文。
- [x] 同一跨项目管理员工具上下文可通过 `/mcp/projects/{slug}` 挂载多个项目，且互不串读。
- [x] 大 `CLAUDE.md` 可通过 Outline → Section 按需读取，无需先拉取全文。
- [x] Bundle 命令只作为客户端可选择执行的文本返回，服务端不执行该命令。

## M5　管理 `/admin/mcp`

**目标：** 完成「上传/补丁 → 提案 → 人类审批 → Agent 激活」的受控闭环。

- [x] **T5.1　挂载管理 MCP 入口。** 配置 `/admin/mcp` 与 `/admin/mcp/projects/{slug}` 的 Streamable HTTP（`json_response: true`），复用项目解析并执行管理 Scope 校验。
- [x] **T5.2　实现 `stage_upload_urls`。** 接收可选 `project?` 和 `files: [{ remote_path, local_path_hint }]`，创建 `transfer_sessions`，返回逐文件 Presigned PUT URL 与安全的 `curl -X PUT -T ...` 批量指令。
- [x] **T5.3　实现 `propose_revision`。** 支持 `session_id?`、`inline_patches?`、`base_revision_id`、`commit_message`；后端拉取 OSS 暂存文件、校验 SHA-256、计算 Token，再调用 M3 三方合并。
- [x] **T5.4　实现提案结果契约。** 无冲突返回 `pending_review` 和 `revision_id`；有同行冲突返回 `conflict` 及紧凑冲突行摘要，不返回整份冗余文件。
- [x] **T5.5　实现 `check_review_status`。** 按 `revision_id` 返回真实当前状态（`pending_review / approved / rejected / conflict / active`）及人类审查员 `comment`，并校验 Revision 属于当前 Project。
- [x] **T5.6　实现 `activate_revision`。** 要求 `admin:activate`，只调用 M3 原子激活服务；任何非 `approved` 状态都必须失败，且不能通过 Tool 参数覆盖。
- [x] **T5.7　实现 `resolve_conflict`。** 接收 `revision_id`、`resolutions: [{ path, resolved_content_or_oss_key }]`、`commit_message`，仅处理当前 Project 的 `conflict` Revision，成功后重新进入 `pending_review`。
- [x] **T5.8　实现 `manage_platform`。** 支持 `create_project`、`issue_api_key`、`revoke_api_key`、`list_users`，要求 `admin:platform`；API Key 明文仅在签发响应中展示一次，列表不返回秘密。
- [x] **T5.9　增加审计与失败清理。** 记录提案、冲突解决、激活和平台管理操作者及结果；失败上传、过期会话和无效暂存对象可按生命周期清理，不影响已固化 Revision。

**出口验收**

- [x] OSS 上传与 Inline Patch 两条路径均可生成待审 Revision。
- [x] Agent 无法直接 Approve；未审批、已拒绝或有冲突的 Revision 激活均失败。
- [x] 冲突解决后必须重新经过人类审批，才能激活。
- [ ] 吊销 API Key 后，对应读取和管理调用均失效；平台管理 Action 均受 Scope 与 Project 边界约束。

## M6　Web 工作台

**目标：** 提供人类管理、审查与冲突处理界面，不复制 MCP 中不存在的业务规则。

- [ ] **T6.1　建立 TanStack SPA 与 shadcn/ui 基础。** 配置 TanStack Router、数据加载/错误状态、统一 API Client 和四类主页面导航；所有写操作复用后端领域服务。
- [ ] **T6.2　落实纸张与墨水灰阶设计。** 使用高对比、低噪点的 Editorial Monospace & Neutral Grayscale；避免渐变装饰和套娃卡片，保持信息密度、清晰层级与可用留白。
- [ ] **T6.3　统一技术数字排版。** Token 数、SHA-256 短哈希、Revision 号和耗时统一启用 `font-variant-numeric: tabular-nums`，长哈希可复制且不破坏布局。
- [ ] **T6.4　实现 Dashboard。** 顶部单行指标条展示托管项目数、Active Skills 总数、整库 Token 预算水位、待审批 Revisions 数量；下方展示最近 Commit 审查动态流和 API Key 调用统计。
- [ ] **T6.5　实现 Workspace Explorer。** 使用 shadcn/ui Collapsible + Button File Tree，标识 `CLAUDE.md`、`AGENTS.md`、`SKILL.md`、Sub-agent 与 Token 徽章；文件选择与 Diff/内容视图同步。
- [ ] **T6.6　实现 Diff Studio。** 支持 Split / Unified 切换、文件级 Token 增减、Base/Active/Incoming 差异展示和空差异状态；长文件按需加载，避免一次渲染整库。
- [ ] **T6.7　实现三方冲突可视化合并器。** 支持 Accept Current (Active)、Accept Incoming、Accept Both，以及手动编辑后保存；保存调用冲突解决服务并使 Revision 回到待审状态。
- [ ] **T6.8　实现 Review Queue。** 汇总 `pending_review` 与 `conflict` 提交，展示完整 `commit_message`、文件级 Token 增减、状态与评论；提供 Approve、Approve & Activate Now、Reject，并进行权限和二次确认处理。
- [ ] **T6.9　实现 Projects、Users & API Keys。** 支持多项目、用户、Key 生命周期和 `mcp:read / admin:propose / admin:activate / admin:platform` Scope 管理；签发秘密只完整展示一次。
- [ ] **T6.10　实现客户端接入配置复制。** 一键复制 Claude Code / OpenCode 配置，覆盖固定 `/mcp`、项目 Slug URL 与对应 `/admin/mcp` 用法，不生成越权 Scope。
- [ ] **T6.11　补齐交互与可访问性验收。** 覆盖加载、空数据、失败、冲突、无权限和并发状态变化；关键操作可键盘完成，灰阶界面仍满足可读性，不仅靠颜色表达状态。

**出口验收**

- [ ] 四个核心界面均连接真实 API，不存在只更新本地状态的假按钮。
- [ ] Web 审批后，Agent 侧 `activate_revision` 才具备可激活的 Revision；Reject 后保持不可激活。
- [ ] 冲突编辑、人工合并和保存结果与 MCP 查询到的 Revision 状态一致。
- [ ] 所有指标、Token 数字、版本和哈希按统一格式展示，长文档与多项目场景可用。

## M7　工程化与发布

**目标：** 把构建、质量、安全和端到端流程固化为可重复执行的发布门禁。

- [ ] **T7.1　实现 `cargo xtask build-web`。** 在 `web/` 下执行 `bun install && bun run build`，将 TanStack SPA 产物输出到 `crates/server/static/`；重复构建结果一致，失败时返回非零状态。
- [x] **T7.2　实现 Axum 静态托管。** 正确提供 SPA 静态资源与前端路由 Fallback，同时确保 `/mcp`、`/admin/mcp` 及项目路径不会被 SPA Fallback 吞掉。
- [ ] **T7.3　配置一键 Pre-commit 门禁。** 配置 `.git/hooks/pre-commit`，串联 `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test`、`bun fmt --check`、`bun check`、`bunx oxlint --deny-warnings`、`bun test`。
- [ ] **T7.4　完成容器发布构建。** 镜像内包含 Rust 服务与已构建 SPA；Compose 仍只包含 PostgreSQL 和 `mcp-registry-server`，启动时执行 Migration/Seed，并配置健康检查与持久化数据卷。
- [ ] **T7.5　建立分层测试套件。** 单元测试覆盖 Token、Markdown、Diff、状态机；数据库集成测试覆盖事务和权限；OSS 集成测试覆盖签名 URL；MCP 合约测试覆盖双端点；Web E2E 覆盖审批闭环。
- [ ] **T7.6　执行安全与信任边界检查。** 验证 Scope 默认拒绝、跨项目隔离、路径规范化、Presigned URL 最小权限与短时效、秘密脱敏、上传大小限制，以及生成命令的安全转义。
- [x] **T7.7　建立性能与体积基准。** 在固定数据集记录 `resources/read`、Workspace 树、Outline 和 Diff 的延迟与响应体积；验证 PG 原文毫秒级读取目标，防止全量 Token 重算或 N+1 查询。
- [x] **T7.8　补齐运行文档。** 说明 Compose 部署、外部 OSS 环境变量、Seed 与默认口令处理、API Key Scope、Claude Code/OpenCode 接入、审批流程、备份恢复和故障排查。
- [ ] **T7.9　完成干净环境发布演练。** 从不含本地缓存的 Checkout 构建前端和后端，启动 Compose，跑通全部关键 E2E，再生成发布产物与版本记录。

**出口验收**

- [ ] 所有格式化、Lint、类型检查和后端/前端测试在干净环境通过。
- [ ] 单容器服务可同时提供 SPA、只读 MCP 和管理 MCP，路由互不冲突。
- [ ] 默认 `admin/admin` 明确仅用于初始化，部署文档要求立即更换；密钥与 OSS 凭证不进入镜像、仓库或日志。
- [ ] 发布过程无需手工补构建产物或手工修改数据库状态。

## 关键端到端验收场景

- [x] **E1　默认项目读取：** 使用绑定 `default` 的 Key 请求固定 `/mcp`，无需 Header 即只读取默认项目 Active Revision。
- [x] **E2　Header 优先级：** 同时提供 `X-MCP-Project` 和不同 `default_project_id`，验证 Header 优先且越权时直接失败。
- [x] **E3　多项目挂载：** 使用同一跨项目 Key，通过两个 `/mcp/projects/{slug}` 地址读取不同项目，内容和 Skills 不串线。
- [x] **E4　分片读取：** 对大型 `CLAUDE.md` 依次调用 `inspect_workspace`、`read_slice(outline)`、`read_slice(section)`，只返回所需内容并带正确 Token 数。
- [ ] **E5　本地下载：** 调用 `pull_bundle_url`，验证签名 URL、指定文件集、Safe Command、过期失效及路径越权拒绝。
- [x] **E6　无冲突发布：** `stage_upload_urls` → 上传 → `propose_revision` → Web Approve → `activate_revision` → `/mcp` 读到新 Active。
- [ ] **E7　Inline Patch 发布：** 以 `inline_patches` 提案，验证 Base 校验、Token Diff、人类审批和激活闭环。
- [ ] **E8　冲突解决：** 制造 Base/Active/Incoming 同行冲突，确认进入 `conflict`；解决后回到 `pending_review`，重新审批后才能激活。
- [x] **E9　审批不可绕过：** 对 `pending_review`、`rejected`、`conflict` Revision 直接调用 `activate_revision`，全部失败且 Active 不变。
- [x] **E10　Approve & Activate Now：** Web 人类管理员执行组合操作，验证数据库原子性、审计记录与 Agent 后续状态查询一致。
- [ ] **E11　权限与吊销：** 分别缺少 `mcp:read`、`admin:propose`、`admin:activate`、`admin:platform` 时调用对应能力，均被拒绝；吊销 Key 后立即失效。
- [x] **E12　大附件交付：** 非文本附件仅在通过 Project 鉴权后签发 OSS 签名链接/重定向，MCP JSON 不包含二进制正文；链接权限最小且短时有效，并在文档中明确「持有链接者可在有效期内访问」的能力边界。
- [ ] **E13　SPA 与 MCP 共存：** 深层 TanStack 路由可刷新，四组 MCP 路由不被静态资源 Fallback 拦截。
- [ ] **E14　干净部署：** 全新环境仅依赖 Compose 与外部 OSS 即完成 Migration、Seed、构建和上述核心流程。

## 发布完成定义（Definition of Done）

- [ ] M0—M7 的出口验收全部通过，E1—E14 有自动化结果或可复现的验收记录。
- [ ] `/mcp` 与 `/admin/mcp` 的所有协议原语/Tool 均有 Schema、权限测试和紧凑响应测试。
- [ ] Active Revision 读取、Revision 状态机、人类审批和原子激活不存在绕过路径。
- [ ] SHA-256、`o200k_base` Token、Markdown 章节和 Token Diff 在各入口结果一致。
- [ ] Docker Compose、外部 OSS、SPA 静态托管和双 MCP 端点可从干净环境一次部署成功。
- [ ] 客户端接入、人类审批、冲突解决、密钥轮换/吊销和运维文档均已交付。
