# Codex 接入源码审查

审查快照：openai/codex `9f70e348e0227980de97e361cce830236fb18317`，目录 `/tmp/todex-agent-audit-20260907-codex`。以下 U=该目录，B=`/Users/youtonghy/github/Project/Todex/TodeX_backend`，D=`/Users/youtonghy/github/Project/Todex/TodeX_desktop`，A=`/Users/youtonghy/github/Project/Todex/TodeX_app`。结论为代码静态核对，不等于真实模型端到端验证；未调用付费模型。统一测试结果见主报告和 evidence.md。

## 总体判断

TodeX 已经使用正确的 Codex app-server JSON-RPC transport，具备 initialize/initialized、thread start/resume、turn start/interrupt、工具审批、原生 fork/compact、token usage 等基础能力；不能描述成只有 CLI 文本包装。但存在两条不等价的实现：新统一 provider (`B/src/provider/codex.rs`) 每回合启动进程，旧 Codex 专用 gateway (`B/src/codex_gateway/mod.rs`) 持久进程并提供大量高级控制。界面中有控制入口不等于新统一会话拥有同一能力。优先统一这两条路径的生命周期、控制与事件规范。

## 确定问题与建议

### C1 / P1：旧 gateway 明确删除 Plan mode 协议字段

- 本地证据：B/src/codex_gateway/mod.rs:2888 调用 normalize_turn_start_params；:2935 `object.remove("collaborationMode")`，:2943 仅投射 model，:2946 仅投射 reasoningEffort 为 effort，mode 和 developer instructions 不再传递；:4625 测试反而断言 collaborationMode 不存在。
- 上游证据：U/codex-rs/app-server-protocol/src/protocol/v2/turn.rs:243-251 保留并支持 collaborationMode；它优先于 model、reasoning effort 和 developer instructions。
- 触发：从旧 Codex 会话切换 /plan 后发送消息。TodeX 本地有 plan 状态，但线上请求没有 mode=plan；上游仍可能按 Default 执行，产生产品行为与用户预期不一致。
- 修复：保留完整 collaborationMode，按上游嵌套 settings 序列化；通过模型/模式 catalog 校验。删除“字段不存在就是成功”的伪契约测试，改为线上 wire 断言 mode=plan、developer_instructions=null/内容完整，并验证上游确实进入 Plan；Plan 本身不等于操作系统沙箱。

### C2 / P1：当前没有运行中配置控制；新 v2 也丢失多种旧控制

- 上游已经提供真正的 `turn/settings/update`：U/.../v2/turn.rs:40-89，必填 threadId/turnId，可改 model、effort、summary、approvalsReviewer、serviceTier；返回 applied 或 targetUnavailable。明确只影响后续捕获设置的步骤，不追溯已开始推理、待批审批及子代理。
- `thread/settings/update` U/.../v2/thread.rs:226-280 明确仅影响 subsequent turns。它与 turn/settings/update 不可混淆。
- 本地 D/src/renderer/session/useTodeXSession.ts:5489-5572 模型选择仅更新本地 state；:4331、:4364、:4412 权限/tier/personality 使用 thread/settings/update，没有运行中 turn/settings/update 调用。tier/personality 甚至没有 pending response 闭环便返回 true、显示成功。
- v2 发包 D/.../useTodeXSession.ts:5115-5133 只含模型、effort、基础权限；B/src/provider/types.rs:140-151 DriverPrompt 没有 serviceTier、personality、summary、approvalsReviewer、collaborationMode 字段，B/src/provider/codex.rs:450-460 也未传这些参数。不能把旧设置面板能力算作 v2 全面支持。
- 触发：用户在长任务中切模型、Fast 或 reviewer；当前运行不会随之改变。v2 设置 Fast/personality/Plan 也不具备 prompt 控制链路保证。
- 修复：UI 明示“本回合后续步骤/下回合/默认配置”作用域；新建统一 configure-turn RPC，带 expected turnId/version；applied 显示已发布、targetUnavailable 回落到下回合并告知用户。只允许上游列明的 live 字段，sandbox/approvalPolicy 不能假装原地更新。基于 thread/settings/updated 的 authoritative settings 刷新实际值。所有字段都要具有 requested/pending/effective/rejected 状态。
- 测试：运行中更新、刚完成竞态、过期 turnId、未知字段、server reject、本地断线、子代理不随父设置变更。

### C3 / P1：v2 把所有 assistant delta 隐藏、把所有 completed 当最终答案

- 上游 U/.../v2/item.rs:251-261 AgentMessage 有 phase（以及 delivery、questions、memoryCitation）；delta U/.../v2/item.rs:1421-1426 不自带 phase，应由 item start 状态关联。
- 本地 B/src/provider/codex.rs:714-721 delta 一律 assistant_progress；:824-839 completed 一律 assistant_final，完全未检查 item.phase；agentMessage started 不输出。
- 真正共享解析器 A/src/lib/mobileParity.ts:977-980 对 assistant_final 输出聊天，对 assistant_progress 直接 return null。不能仅根据“后端有 delta 事件”宣称前端最终文本流式完整。
- 结果：v2 用户通常需等 item/completed 才看到该条文本；commentary completed 又会作为最终消息进入主聊天。上游中途建议/异步问题等元数据也没有类型化呈现。
- 修复：以 threadId+turnId+itemId 维护 item registry；started 存 phase，delta 保留相同消息身份；允许 final 流式显示，commentary 单独呈现；completed 用权威全文替换，避免拼接重复；保留 delivery/questions/memory citation。中断也保留部分输出。
- 测试：commentary→工具→final、final 多 chunk、缺 start 兼容、同 turn 多 message、completed 全文与 delta 不同、断线重放、完成前中断。

### C4 / P2：v2 每回合进程销毁破坏“整个会话允许”的预期并增加连接成本

- B/src/provider/codex.rs:302-321 每次 run_turn spawn app-server 后 process.terminate；:960 allow_always 对应 acceptForSession，界面 :911 称 Allow for session。
- 上游 U/codex-rs/core/src/tools/sandboxing.rs:67-112 使用 SessionServices.tool_approvals 内存缓存；U/codex-rs/core/src/session/session.rs:1439 每次建立新 session 用 ApprovalStore::default()。
- 确定影响：新回合 resume 原生 thread 会建新进程/session，上一回合的临时 session approval cache 不随磁盘历史恢复；用户同意“session”后下一回合仍可能重复审批。无需假设安全越权，问题是语义与可靠性。
- 每回合初始化/MCP 重连开销同样确定存在；具体毫秒、后台子进程/子代理恢复影响未实测，不能写成已证明的数据损失。
- 修复：将旧 gateway 的持久 actor/会话 supervisor 收敛到统一 driver，以有界空闲回收管理资源；区分 native thread 生命周期与 worker 生命周期。回收后明确 session grant 已失效，绝不能自行将临时授权持久化成永久授权。至少做两回合审批缓存及 worker crash/recovery 测试。

### C5 / P1（使用需交互 MCP 时）：v2 不支持 MCP elicitation server request

- U/.../protocol/common.rs:1747-1749 明确有 mcpServer/elicitation/request。
- B/src/provider/codex.rs:878-887 is_codex_permission_method 只认 command/file/permissions/requestUserInput；:662-670 将其它带 id 的 request 全回 -32601 “request is not supported by TodeX”。因此 MCP 服务要求用户补填表单/URL 验证时被明确拒绝，不能仅因为 native_mcp=true 认为 MCP 使用链路完整。
- 旧 gateway B/src/codex_gateway/mod.rs:517、:2725、:3409 已有对应映射/elicitation 状态，不可说整个产品完全没有。
- 修复：复用旧交互表单/URL flow，新增统一 typed elicitation request/response，保留 wire id 类型、schema、cancel、超时；未实现的 dynamic tool call/auth refresh 明确进行能力门控而非宣称支持。
- 测试：form 必填/可选、URL action、cancel、未知 method 返回正确 JSON-RPC 错误、数字 request id、断线 pending 恢复。

### C6 / P2：新增 item 在 v2 被静默丢弃，不只是“原始事件还在”

- U/.../v2/item.rs:234-415 包含 plan、functionCallOutput、hookPrompt、subAgentActivity、sleep、imageGeneration、enteredReviewMode/exitedReviewMode 等。
- B/src/provider/codex.rs:681-690 对 item/started/completed 处理完必 return；:842-848 未进入白名单则返回 None；:864-877 工具白名单没有上述新增项。除 contextCompaction 的专门活动映射外，这些 payload 连 provider.event fallback 也没有保留。因此生成图片 item、计划权威全文、子代理新活动等会丢失。
- plan delta、patch 更新、command output 等非 item 通知可回落 provider.event，但这不等价于有按 item 聚合的专门 UI；需分别标记“已保留/已归一化/已展示”。
- 修复：所有未知 item 默认持久化原始 provider.event 并显示可折叠未知事件；优先新增 imageGeneration、plan（以 completed 权威全文为准）、subAgentActivity 和 review 类型。维护 upstream schema 对比清单。
- 测试：枚举上游 ThreadItem，每种至少保证持久化；未知 type 也不得吞掉。生成图片成功/失败、计划 delta 与 completed 不同、子代理活动与 parent 状态分别验证。

### C7 / P2：reasoning 分段/来源混淆，模型 catalog 能力硬编码

- reasoning：U/.../v2/item.rs:1443-1473 区分 summaryIndex/contentIndex；B/src/provider/codex.rs:723-730 将 summaryTextDelta/textDelta 都合为同一 thought.delta，:880 前后的 codex_block 只有 itemId/turnId 无 index。summary 与 raw reasoning 若同发，将混入同一 block，分段也丢失。应保留 reasoning source 与索引，完成时用 summary/content 权威内容校正（目前 reasoning completed 直接丢弃）。
- models：U/.../v2/model.rs:105-120 包含 inputModalities、supportsPersonality、serviceTiers/defaultServiceTier，:147-151 分页 nextCursor；B/src/provider/codex.rs:199-253 只取首个 data、:251 image_input=Some(true)，descriptor:162 image mode Always。模型不支持图像时仍可能允许附件，后续页模型不可见。
- 修复：分页直到 nextCursor null，保留模型级输入/参数能力；不是所有 Codex model 一律支持 image/personality/tier。测试 text-only 模型、两页 catalog、未知新 effort、summary/raw 混发与多段 reasoning。

## 已支持与未来可做功能矩阵（只对照 Codex；“独有/共有”请总报告跨另外两者再判定）

| 能力 | 上游依据 | TodeX 状态与价值 |
|---|---|---|
| 原生 start/resume/fork/compact/cancel | U/.../protocol/common.rs:552-569、695、1028 | v2 已有，不列作全新缺失 |
| MCP/skills、模型与 effort | B/provider/codex.rs:146-164 | 已有基础；应先补 elicitation 和真实 catalog 能力 |
| 原生 Plan mode | U/.../v2/turn.rs:243 | gateway 字段被删、新 v2 缺参数；属于修复优先 |
| 运行中模型/effort/tier/reviewer | U/.../v2/turn.rs:40 | 本地缺闭环；高价值控制台 |
| 原生输入队列（增删改排/启动） | U/.../protocol/common.rs:624-657 | desktop/backend src 未发现 thread/queue 调用；可做持久任务队列，优于只在浏览器缓存消息 |
| 运行中 steer | U/.../protocol/common.rs:1022 | 旧 gateway 有 :1485，新 v2 prompt 会拒绝 pending submission（D:5060）；应统一，并区分立即 steer 与排队 |
| 会话全文搜索/定位 | U/.../protocol/common.rs:806-815 | 未发现 thread/search/searchOccurrences 调用；可做跨会话代码决策检索 |
| 原生 revert（区别 rollback） | U/.../protocol/common.rs:728-735 | 有 rollback 类操作时不可假定文件恢复；可进一步核对 revert 语义后做“历史/文件变化”分离恢复 |
| 后台终端列表与单个终止 | U/.../protocol/common.rs:710-725 | 已有 clean（D:5965），未发现 list/terminate 调用；可做端口/长任务管理，不能写后台终端完全缺失 |
| 实时语音 | U/.../protocol/common.rs:1033-1072 | 未发现 thread/realtime 调用；可做语音编程，但接口 experimental，需单独音频/权限/状态工程 |
| 图片生成与 MCP app 富结果 | U/.../v2/item.rs:348、399 | 有上游数据结构，但 v2 生成图片 item 当前丢失；先补结果展示，再做可视化工具 |
| Hook 运行可观测性 | U/.../protocol/common.rs:1907-1909 | hooks/list 已有（D:3973）；运行事件不是专门结构展示，可加耗时/阻止原因/输出 |
| Goal、Memory、Plugins、review、account | D/useTodeXSession.ts:3914、4131、5847 等旧控制 | 不能称整体缺失；应把已做的控制迁入统一会话并验证确认回执 |
| 结构化输出 schema | U/.../v2/turn.rs:239 | v2 DriverPrompt 未暴露；可支持可验证报告/任务结果等应用自动化 |

## 推荐实施顺序与验收

1. 先修 C1/C3/C5/C6，防止“模式未生效、内容静默丢失、交互被拒绝”。
2. 将每回合 spawn 改为持久 session actor，把 turn start/steer/interrupt/settings-update 和 server requests 放入单一读循环/命令队列；维护 native ids，保留正常 JSON-RPC id 类型与超时。
3. 统一配置域与状态，接收 thread/settings/updated 和 model/rerouted，能力来自安装版 schema/catalog；实验 API 须按 CLI 版本探测，不靠 binary 存在即全支持。
4. 用 upstream schema 生成的真实 transcript 做契约测试。既测 wire，也测公共 parser 后最终 UI timeline；现有 fake CLI 回 `{}` 或手写固定事件无法证明与当前 upstream 相容。
5. 再做队列、搜索、后台终端、图片/富结果、语音。只读审计不应立即进行跨模块改造。

保留的正确性：turn/completed 使用 status 并校验 native turn id，failed 不当作正常成功；取消等待 interrupt 回执与终态；request id 支持数字/string；完成消息与工具事件已有区分；fork/compact 使用原生 API。这些应成为回归基线。


## 本分卷的引用方式

上文保留审查时的文件路径和行号；可点击的本地源码及固定 SHA 上游链接见 [证据索引](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/evidence.md)。跨三家比较、优先级取舍与实际测试结果见 [主报告](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/README.md)。
