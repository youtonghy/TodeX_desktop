# Pi 接入审查（2026-09-07）

审查基线：上游 `earendil-works/pi`，SHA `c1d4c801114545f47c440921d8b3e04aeb1e565d`，目录 `/tmp/todex-agent-audit-20260907-pi`。本地 backend HEAD `f061c1a045e87694fcc167db63e2e0a13a08a05e`，审查的是当前工作树。以下为源码路径交叉验证，没有调用付费模型、没有修改产品，也没有声称完成真实 Pi 集成测试。统一测试结果见主报告和 evidence.md。

## 结论

当前 Pi 是“每次用户请求启动一个 RPC 子进程，以 session-id 恢复原生磁盘历史”的适配器，不是持久 RPC 会话控制器。普通文字、图片、思考流、工具执行、用量、取消、自动压缩事件和四种扩展输入对话已有实质支持；最大问题在生命周期边界：纯扩展命令可能不结束，失败消息可能被标记成功，等待 RPC 回应时会丢事件。实时模型配置、原生 steering/follow-up 和会话树能力未开放。

注意不要误判：`--approve` 在该 Pi 版本意为信任项目本地资源，不能解读成逐工具审批 API。TodeX 已声明 `permissions=false`，且 supervisor 的模型发现和运行路径先取 workspace trust permit（`supervisor.rs:286`、`:950`）。这部分不是“绕过已有审批”的确定漏洞。

## 已有实现和正确之处

- `src/provider/pi.rs:193`：`--mode rpc --session-id <id> --approve`；上游 `packages/coding-agent/src/main.ts:431` 同一 cwd 下找精确 session ID，找到即 open。因此“每轮重启必然丢历史”不成立。
- `pi.rs:203`：每轮 `--model`、`--thinking`；图片 `images[{type,image,data,mimeType}]` 形状与上游 `rpc-types.ts:22` 对齐，实际模型 image capability 在 `pi.rs:328` 再检查。
- `pi.rs:287` 的 thinking level map 算法与上游 `packages/ai/src/models.ts:915` 相同，null 表示禁用、xhigh/max 要显式映射，不应报告此算法错误。
- `pi.rs:394` 等待 `agent_settled`，比等 agent_end 更能覆盖自动 retry/compaction；上游 `agent-session.ts:1105` 在重试和压缩循环后 finally 发 settled。
- `pi.rs:696` 使用同一个 message ID 发 usage 和 final；toolUse 消息仅计费、不当 final；`pi.rs:472` 工具 start/update/end 全部转发。
- `pi.rs:558` 正确区分 select/confirm/input/editor 与 fire-and-forget 通知；后者不错误回送 extension_ui_response。
- `process.rs:160` 有写超时和帧大小上限、`:187` 有 control deadline；模型发现外层 `supervisor.rs:290` 有 8 秒限制，不能笼统报告“模型发现无限等待”。

## 确定问题

### PI-01 / P1：纯扩展命令和被扩展处理的输入会让任务一直运行

证据：本地 `pi.rs:363` 收到 prompt 成功后进入读循环，唯一正常结束信号在 `:394` 为 agent_settled。上游 `agent-session.ts:1167-1172` 的注册命令只执行 handler、preflight success、return；`:1192-1194` input handler 返回 handled 也如此；真正发 settled 的流程是 `:1105-1117`，上述两条路径不会进入。RPC `rpc-mode.ts:394-415` 只发送 success，不额外发送结束事件。

触发：用户通过已发现的斜杠命令执行仅修改配置、显示通知、保存文件或弹表单的 extension command，且扩展不启动 LLM。此时 stdin/stdout 仍打开，没有 settled，TodeX 长期占用 active turn；后续请求在 `supervisor.rs:934` 被拒为 already running。

改法：RPC reader 常驻、把“命令已处理”和“agent run 正在执行”分离。prompt ack 后可通过紧接的 get_state 确认 isStreaming/isCompacting/pendingMessageCount，并结合已收到 agent_start/settled 判断命令是否同步结束；不能把任意 prompt success 直接当完成，也不能仅加一个短 timeout 杀掉正常推理。必要时给注册命令使用独立 command lifecycle。

验收：fixture 对 get_state 返回 idle，对 prompt 只回 success 且不 EOF；TodeX 应正常结束并可再发请求。另测 input handled 和“扩展命令启动异步 LLM”避免过早结束。

### PI-02 / P1：模型最终错误被标记为 turn.completed

证据：`pi.rs:417-430` 仅保存 stopReason；`:394-399` 无条件返回 Ok(cancelled=false)。`:670-675` 把任何非 toolUse assistant（包括 error/aborted）归为 final。`supervisor.rs:1075-1085` 对此直接发 turn.completed。上游 `agent-session.ts:1131-1137` 明确存在耗尽 retry 后 stopReason=error 与 finalError，finally 仍会 settled。

前端无补救：共享协议 `TodeX_app/src/lib/conversationRuntime.ts:136-140` 只根据 turn 事件类型设置 completed，不查看 stopReason。`mobileParity.ts:952-958` final 仅排除 toolUse 和非 assistant，也不把 errorMessage 变错误条目。因此是实际状态错误，不只是“消息里保留 error 但 UI 会识别”。

触发：不可重试 API 错误、重试耗尽、模型拒绝请求后返回 assistant stopReason=error。用户看到“完成”，甚至没有正文/错误原因。

改法：保留最新 assistant outcome/errorMessage；到 settled 时最终 error -> Err/turn.failed，aborted -> cancelled，length -> 明确截断状态；重试过程中的失败不能提前终止。仅成功最终 answer 发 assistant_final，错误文本发结构化 error。

验收：error->settled 必须 turn.failed 且可见 errorMessage；error->auto_retry->成功->settled 必须 completed；aborted 必须 cancelled；toolUse 后继续不能过早完成。

### PI-03 / P1：等待 RPC 回应时丢弃所有非 UI 事件

证据：`pi.rs:514-547` 的 wait_for_response 只返回匹配 response，处理 extension_ui_request，其他 message/tool/compaction/extension_error 一概消耗后丢弃。上游注册命令在 `agent-session.ts:1168` 等 handler 执行完成后才 ack，handler 可以产生消息、工具活动、错误乃至触发 LLM；错误在 `:1338-1344` 先 emitError 再返回 true。

触发：命令在 success ack 之前发 custom/message 事件，或 handler 报错产生 extension_error；这些内容消失。若扩展在 ack 前完成完整 agent run，连 settled 也被吞，随后进入 PI-01 的等待。

改法：单一 reader 将 response 按 request ID 分派到 pending requests，所有事件走同一 reducer；短期可缓存非 response 事件并按原顺序交给主循环，不能忽略错误或 lifecycle。

验收：在 prompt ack 前插入 message_end、extension_error、compaction、agent_settled，然后 ack。事件必须全部且只一次进入持久日志，任务正确终止。

### PI-04 / P2：扩展对话超时与主读循环相互阻塞

证据：上游 `rpc-mode.ts:115-119` 支持 opts.timeout 后自动 resolve；`:137-148` 把 timeout 发给 host。本地 `pi.rs:574` 同步 await permission broker，而 broker `types.rs:19`、`:527` 一律 10 分钟，不读请求 timeout。等待期间 `run_pi_turn` 不继续读取 stdout。

触发：扩展 confirm(timeout=1000) 一秒后自动决定并继续执行/结束，TodeX 仍显示等待输入并停止消费事件，最长十分钟后可能把正常任务变失败。多个 Promise.all 对话也会被串行显示。

改法：分离 RPC read pump 与 pending UI promises；按原生 timeout 设置输入有效期、过期撤销卡片/停止发送迟到答复；允许多个原生请求并发存在。不要把 UI 等待算成 provider 响应停滞。

验收：1 秒超时 dialog 后随后产生的 message/settled 无需用户点击便能显示；过期卡片清除；并发两个 dialog 都能解析和取消；取消 turn 不弹出新的等待对话。

### PI-05 / P2：同一用户 turn 内多个 LLM 消息的思考块 ID 冲突

证据：`pi.rs:678-690` 默认 ID 只有 turnId-category-contentIndex，没有 native message 序号；上游 `packages/ai/src/types.ts:551-553` thinking delta 只保证消息内 contentIndex，不提供 id。一次工具调用循环后下一条 assistant message 的 contentIndex 又从 0 开始。UI `mobileParity.ts:964` 以该 ID 聚合，`:899-906` 遇 completed 替换旧内容。

结果：第一段工具调用前的 reasoning 可能被下一段 reasoning 追加/最终覆盖，历史审查丢失不同推理阶段。工具的 toolcall_start/delta 默认也用 fallback ID，toolcall_end 才有 toolCall.id，可能产生孤立的工具参数流块，应一并验证。

改法：在 message_start 分配 message key，所有 delta ID 含 messageKey + contentIndex；tool call 从 partial.content[contentIndex].id 尽早关联或维护重定向。message_end 关闭该消息块。当前序号只在 completed 使用，不足以解决 streaming。

验收：同一 turn 两条 assistant message 各含 thinking index=0，中间有 toolUse；重放与实时必须都保留两个独立思考块。工具 start/delta/end 和 execution 应聚合到同一 tool call，不产生残余卡片。

### PI-06 / P2：读取真实会话状态但未回传实际配置，运行中也没有控制通道

证据：`pi.rs:315-345` get_state 只用 model 检查图片，丢弃 model/thinkingLevel/sessionFile/sessionId；启动用的是请求参数。`supervisor.rs:1002-1004` 只标注权限 validated。上游有 `set_model`（rpc-mode.ts:472）、`set_thinking_level`（:499）、`get_available_thinking_levels`（:512）。本地 driver 没有这些请求，active turn 唯一控制是 cancel。

问题边界：每轮启动时选 model/thinking 已实现，不能称“模型控制完全没有”；缺的是 effective config readback、会话中改变配置的可观察性和运行中控制。Pi 可能按模型 clamp thinking（上游 models.ts:926），用户请求值与实际不同未展示。扩展还可修改模型/会话，但宿主保存的 nativeSessionId 仍是启动 ID。

改法：发 provider-confirmed 配置事件保存 requested/effective/source；持久会话命令通道开放 set_model / set_thinking_level，明确“下一次 LLM 请求生效”，先 ack 再 readback；扩展 new/switch session 后同步 native ID/file。

验收：请求不支持的 thinking 档位显示实际档位；扩展改模型后 UI 更新；新/切换会话后下一轮接续新 session；运行中改变模型不声称已更换在途请求。

### PI-07 / P2：原生历史文件缺失时静默创建空会话

证据：本地 `pi.rs:188-200` 对首次和恢复都发送 --session-id；上游 `main.ts:431-443` 未找到该 ID 时只 warning 然后创建。`pi.rs:340-345` 无条件标记 recoverable=true，get_state 的 messageCount/sessionFile 未用于校验。

触发：Pi session 文件被清理、用户换运行环境、workspace/session 目录变化后，TodeX 仍有旧历史和 native ID；继续消息实为新上下文，界面无恢复失败提示。

改法：区分 create/resume intent，持久化 sessionFile，恢复前校验存在/对应 ID；缺失时显式 interrupted/recovery_required，提供用户选择“新会话+历史摘要”而不是静默丢上下文。首次使用允许创建。

验收：成功跑一轮后移除模拟原生 session 文件，再续聊必须显式报告恢复缺失；首次会话不受影响。

## 能力矩阵与产品机会

| 能力 | Pi 上游 | TodeX 当前 | 建议 |
|---|---|---|---|
| 文本/模型图像/工具流 | rpc prompt/images、tool execution events | 已接入 | 先修 lifecycle/ID，不重复造基本功能 |
| 每轮模型与思考选择 | CLI 参数 + RPC setters | 每轮启动参数已接入 | 增加实际值确认、模型切换来源 |
| 运行中追加纠偏/后续排队 | steer/follow_up/clear_queue，queue_update，队列 one-at-a-time/all | supervisor active 冲突；无原生队列 | 高价值：继续当前工具后采纳纠偏，或等完整 run 后跟进；显示队列、删除排队消息 |
| 手动原生压缩/自动压缩设置 | compact/customInstructions、set_auto_compaction | native_compact=false，仅消费自动压缩事件 | 开放“压缩上下文”、附加保留指令；与已有产品摘要压缩区分 |
| 原生分支/克隆/会话树 | fork、clone、get_fork_messages、get_entries(since)、get_tree | native_fork=false | 从任意用户节点分支、查看分支树，保留原生上下文；不能把复制 UI 历史称原生 fork |
| 重试控制 | set_auto_retry/abort_retry；auto_retry_start/end | 未知事件保留为 provider.event，无语义控制 | 显示次数、倒计时、原因；单独停止重试 |
| 扩展输入 | select/confirm/input/editor | 已有 bridge 但串行、timeout 漏接 | 修复为并发带有效期表单 |
| 扩展 UI 通知/状态/widget/title/editor text | RPC 明确 fire-and-forget UI requests | 只作为 provider.event 保存 | 增加轻量状态栏、通知、输入框预填；不要执行任意扩展 HTML |
| 原生命令/模板/skills 发现 | get_commands source=extension/prompt/skill | discover_commands 已接入 | 修复纯命令 lifecycle，显示 sourceInfo 与来源 |
| 会话统计/HTML 导出/重命名 | get_session_stats/export_html/set_session_name | Pi adapter 未映射 | 用量/上下文面板、可分享原生 HTML、双向名称同步 |
| RPC bash | bash/excludeFromContext、abort_bash | Pi adapter 未映射；产品有独立终端 | 增加明确“执行并加入 Agent 上下文”的选项；独立终端不等同原生 bash context |
| MCP | Pi 无通用原生 MCP RPC | descriptor native_mcp=false、managed_mcp=true | 已有托管方式需保留；不要把 Pi 原生 MCP 当上游现成功能 |
| 逐工具审批 | Pi 无通用 RPC 审批接口 | permissions=false | 不要虚构沙盒/审批能力；如需要依赖隔离运行环境或明确扩展机制 |

矩阵的上游统一证据：`packages/coding-agent/src/modes/rpc/rpc-types.ts:20-77`；本地 capability 声明 `src/provider/pi.rs:34-55`。跨三家的共有/特色比较见主报告。

## 推荐实施顺序

1. 先完成无付费 mock 协议回放集：纯命令、pre-ack events、terminal error/retry、dialog timeout、多个 assistant 消息 ID、恢复文件缺失。
2. 引入统一长驻 RPC reader + request correlator + lifecycle reducer，修 PI-01/02/03/04；不要为每个等待点继续写独立读循环。
3. requested/effective 配置回执与恢复校验；暴露进程/原生会话/当前模型/思考档位/协议版本诊断，敏感值脱敏。
4. 再开放 steering/follow-up、compact、fork/tree；每项按 capability 显示，桌面/Web 使用共享协议而不硬编码 provider 名称。
5. 固定支持 Pi 版本或协议能力契约。当前 descriptor 仅 executable_available，没有版本协商；该版的 agent_settled、session-id 等不可假设旧版也兼容。CI 用固定上游 SHA 的脱敏真实帧补充 mock，升级做契约差异审查。


## 本分卷的引用方式

上文保留审查时的文件路径和行号；可点击的本地源码及固定 SHA 上游链接见 [证据索引](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/evidence.md)。跨三家比较、优先级取舍与实际测试结果见 [主报告](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/README.md)。
