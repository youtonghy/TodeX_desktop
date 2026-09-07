# Grok Build 对照审查（2026-09-07）

## 范围与证据

上游目录 `/tmp/todex-agent-audit-20260907-grok-build`，Git SHA `72a61251fcffb464bcc687aeb5a998e5a98ec0c9`，上游内部 `SOURCE_REV` 为 `a549186d9d39311f2d3ee4208db62af8c65aa476`。本仓库确实公开 Rust CLI/TUI 和 agent runtime 源码，不只是安装脚本或文档：`crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs` 有 ACP Agent 实现，`xai-grok-tools` 有工具，`xai-grok-workspace` 有执行和检查点实现。第一方 Apache-2.0；第三方另有 notices。以下是源码静态核对，不代表对用户已安装 grok 二进制完成实机认证和付费推理验证。

本地 B = `/Users/youtonghy/github/Project/Todex/TodeX_backend`；A = `/Users/youtonghy/github/Project/Todex/TodeX_app`；U = 上游目录。行号均为本次读取的快照。

## 总体判断

基础接入已经相当完整：受信任工作区启动、禁自动升级、环境 allowlist、ACP v1 握手、认证方法约束、native session/load、模型与 reasoning 配置、图片、普通文本/思考/工具/计划、权限选择语义、多问题、计划批准、MCP elicitation 都有实现。不能说 Grok 尚未接入，也不能把已有统一能力面板当作没有开发。但“有 parser 函数”不等于真实 Grok wire 会走进它；最明显的缺口是扩展事件 method 不匹配。配置控制主要发生每一轮 prompt 前，不是运行中的双向控制通道。

## 确定问题与优化

### G1 / P1：Grok 扩展活动事件没有进入规范化分支

- B `src/provider/acp.rs:581-587` 仅在 `method == "session/update"` 内调用 `grok_activity_event`；该函数（660-679）支持 subagent、auto_compact、response_completed usage，但真实扩展从其他 method 送达。
- U `crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs:995-1027` 创建 XaiSessionNotification，使用 `ExtNotification::new("x.ai/session_notification", ...)` 发送；U `extensions/session_updates.rs:28` 明确持久化/拉取记录中区分 `session/update` 与 `_x.ai/session/update`。
- 实际通知被 B `acp.rs:650-654` 降为 `provider.event`。A `src/lib/conversationRuntime.ts:153-168` 只将 `subagent.*` 归入子任务状态。因此 Grok 的子 agent/压缩/用量面板可不更新，而代码里的单元 fixture 直接调用 helper，绕过 method 分派，没有覆盖这个问题。
- 改法：建立 vendor method 规范化层，明确支持实时 `x.ai/session_notification`（包括 ACP 扩展 `_` 前缀）及持久化 update 通道；保留原始通知，按 sessionId/promptId 归属，未知扩展不得让普通对话失败；再进入统一活动映射。
- 验收：真实 wire fixture 经过完整 handle_acp_message，分别断言 spawned/progress/completed/failed/cancelled、compaction、usage 事件；前端 reducer 测试终态和归属；未知扩展保留但不错误升级。

### G2 / P1：第二轮恢复时没有继续强制 Ask 模式

- B `acp.rs:294-300` 仅 `session/new` 设置 `_meta: {yoloMode:false, autoMode:false}`；恢复分支 `270-277` 只传 `noReplay:true`。
- U `agent/mvp_agent/session_setup.rs:905-914` 恢复时缺少 yoloMode 会使用 `self.default_yolo_mode`，autoMode 同样用 default。TodeX 每轮新进程（B `grok.rs:164-197`），因此这不是罕见 warm attach 情况。
- 触发：用户本机 Grok 默认启用 yolo/auto，TodeX 第一轮 Ask；第二轮 session/load 不显式覆盖，恢复回本机默认，审批行为可能扩大。B `provider/types.rs:63-65` 对 Grok 还声明不支持覆盖，无法在当前 UI 清晰表达真实有效状态。
- 改法：new/load/resume 统一注入经过验证的权限配置；至少每次保持 false/false，并回显实际有效模式。以后新增 Grok ask/auto/yolo 时不要映射成 OS sandbox，分别说明 agent approval 与 sandbox enforcement。
- 验收：模拟上游默认 true，连续两轮观察 new/load 参数和实际 permission reverse request；断线恢复与重启不得权限升级。

### G3 / P2：prompt 的最终 metadata 被丢弃，用量与结构化结果不完整

- U `agent/mvp_agent/acp_agent.rs:1983-2000` 的 PromptResponse metadata 包含 prompt usage、model、cancellation category/context、structured_output、tool overrides 等；失败路径 `2137-2160` 还补充 usage。
- B `acp.rs:371-389` 只保留 stopReason、native session ID，错误只取 message；未保存 response metadata。即使 G1 修复单次 response_completed，也不能用其替代整个 prompt 汇总、失败场景 usage 或结构化结果。
- 改法：解析并保留最终 _meta；区分模型单次调用与完整 prompt 汇总，按 prompt ID 去重，避免累加两次；错误也提取可验证 usage；将 structured_output 作为有 schema 的 artifact，取消原因单列。不要把缺失 token 写成零。
- 验收：多模型调用+子 agent、成功/取消/异常分别核对最终总量；汇总到达两次保持幂等；schema 未知字段原样保留。

### G4 / P2：命令发现只看 initialize，遗漏会话/工作区动态目录

- B `grok.rs:153-158,357-394` 只取 initialize `_meta.availableCommands`；U `agent/mvp_agent/acp_agent.rs:543-544` 在该字段明确调用 `builtin_commands`。
- U `extensions/session_admin.rs:859-894` 提供 `x.ai/commands/list`，有 sessionId 时从活动 session `list_available_commands` 获取；插件 reload `850-852` 会广播更新的技能和 slash command catalog。
- 因此模型存在动态发现不等于技能/插件命令已完整发现；当前初始化 fixture 中的 `repo:review` 不能证明实际 initialize 会提供项目插件。
- 改法：初始化目录作 fallback；受信任工作区/已认证 session 拉取会话命令；处理 available_commands_update 并刷新 catalog，保留命令来源和参数提示。
- 验收：工作区添加/删除 skill/plugin，目录及时增删；两个工作区互不污染；未信任工作区不触发插件执行。

### G5 / P2：取消发送后立即终止进程，缺少协议完成窗口

- B `acp.rs:351-362,394-405` 发 session/cancel 就 return；B `grok.rs:197` 随即 terminate；`process.rs:226-245` 立即 SIGTERM，超时 SIGKILL。
- U `agent/mvp_agent/acp_agent.rs:2166-2204` cancellation 支持取消子 agent、rewindIfNoOutput、promptId；这是异步 session 路径。现在没有等待 prompt cancelled response 或最终 usage，存在尾部持久化/取消结果丢失风险。此项是源码证实的时序缺口，不宣称已复现数据库损坏。
- 改法：发 cancel 后继续 drain 到当前 prompt 终态，设置短有界宽限期；超过才终止进程；记录 graceful/forced 状态。普通 turn 完成后也考虑长驻 transport 降低每轮启动成本。
- 验收：慢工具和审批中取消，最终状态一次；下一轮 load 可用；无孤儿进程；模拟不响应 agent 必须在截止时间退出。

### G6 / P2：运行中配置控制目前缺少产品/API通路

- B `grok.rs:164-197` 每轮启动/结束进程，`acp.rs:324-347` 只在发 prompt 前 apply_requested_config，活动 read loop 只有 stdout/cancel；B `supervisor.rs:934-940` 拒绝已有 active turn 的新 prompt。
- 上游 `agent/handlers/config_option.rs:8-46` 支持 set_config_option；`handlers/model_switch.rs:280-319` 对 reasoning 进行当前模型校验、config lock、live actor 命令和通知；U `extensions/interject.rs:1-4,40-60` 是专用中途插话队列，安全点消费。
- 结论：当前能控制下一轮模型/effort，不应展示为“即时生效”；上游也不意味着已经开始的一次模型请求能被回溯修改。
- 改法：长驻 session transport + 控制命令队列；model/effort 的 requested/applied/rejected/effectiveFrom 分开呈现。先做 interject，配置变更按上游确认的安全边界生效，UI 标明下一次采样/下一轮。
- 验收：生成中改 effort 与 model、连续快速更改、切换失败、断连重试；只有 ACK 后改变有效配置；重试不重复插话。

## 已有正确处理，不应作为缺失功能

- B grok.rs 41-100 discovery 有 8 秒超时；run_acp 的控制响应有总 deadline（460-518），用户审批耗时延长 deadline。
- B acp.rs 977-1037 只允许已广告的 cached_token / xai.api_key，避免自动交互登录；配置 env allowlist 和敏感值脱敏存在。
- B acp.rs 542-578 严格按 Allow/Reject 语义选 option，不按序号猜批准。
- B acp.rs 700-870 已有问题、计划批准反馈、MCP elicitation；上游 ask_user_question types.rs:94-120 还有 annotations、多选、chat_about_this、skip_interview，而当前后端只生成 accepted/cancelled，annotations 不保留，属于交互完整性提升。
- 图片支持上游未在 initialize advertise image（U acp_agent.rs:516），TodeX 有显式 vendor override；这个 override 不应仅因“不遵守 capability”直接判错，需要按实际模型做图片支持探测。

## 可新增能力（Grok 已从源码确认；跨三家比较见主报告）

|能力|上游证据|TodeX现状/产品建议|
|---|---|---|
|生成中插话、文字+图片|U extensions/interject.rs:14-22,40-60|缺少 live control；优先级高，减少取消重做|
|原生会话 fork|U extensions/session_admin.rs:10,51|B grok.rs descriptor native_fork=false；统一 fork 后台可已有通用复制，需增加 native resume-aware 分支|
|原生 rewind/检查点列表|U extensions/rewind.rs:1-23,25-36|暴露回退点、代码/对话回退范围，执行前给 diff；不要用简单删聊天记录替代|
|按会话 MCP 热替换、插件 reload|U extensions/session_admin.rs:48-52,521 起,850-852|B grok.rs managed_mcp=false；native_mcp=true 只是本机已有能力，非 TodeX 管理闭环|
|会话 list/resume/close 与原生命令目录|U acp_agent.rs:483-492；session_admin.rs:859-894|可以导入 CLI 已有任务、避免只列 TodeX manifest；控制原生会话生命周期|
|问答访谈多选/备注/先讨论/跳过访谈|U ask_user_question/types.rs:94-120|已有基础问答，补足结构化 UI 和完整 outcome，不必重造整个问答系统|
|子任务状态、压缩/用量细节|U extensions/notification.rs:447 起,644-714,1044-1052|先修 G1/G3，已有面板即可获益；之后补 child session drill-down|
|取消时无输出回退、选择是否取消子任务|U acp_agent.rs:2186-2204|当前只有简单 cancel；先解决完成确认，再加高级选项|

## 建议实施次序

1. 第一批：G2 权限恢复、G1 真实 wire 分派、G3 最终 metadata；用上游完整 JSON-RPC fixture 做贯通测试。
2. 第二批：G5 优雅取消、G4 会话目录；加入 binary version/agentVersion、协商能力与有效配置的诊断快照，敏感信息脱敏。
3. 第三批：长驻会话与控制队列，先 interject 后配置，ACK 与生效边界可观察。
4. 第四批：native fork/rewind、MCP热更新、访谈和子任务详情。Desktop/Web/共享协议联动，不重复实现两个 reducer。

未运行上游完整编译：仓库较大且含 hermetic protoc 依赖，本审查没有必要为了静态行为对照运行真实 agent。未改产品源代码。


## 本分卷的引用方式

上文保留审查时的文件路径和行号；可点击的本地源码及固定 SHA 上游链接见 [证据索引](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/evidence.md)。跨三家比较、优先级取舍与实际测试结果见 [主报告](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/README.md)。
