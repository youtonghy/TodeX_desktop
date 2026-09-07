# TodeX 与 Codex、Grok Build、Pi 接入与功能差异报告

审查开始：2026-09-07；完成：2026-09-08（Asia/Taipei）。对象：当前 TodeX 后端、Desktop/Web 会话链路及实际共用的 TodeX_app 协议代码。此次只新增报告，没有实施产品改造。

## 结论

**三家 Agent 都已经有实质接入，但目前还不能认定配置控制和返回解析完整、正确。最应优先处理的是会话生命周期、协议事件分派、运行状态和配置回执，而不是继续增加设置开关。**

当前基础值得保留：使用原生结构化协议；有受信任工作区检查、请求 ACK、断线后的状态核对、连续事件回放、权限答复校验、进程读写限制和原生历史续接。问题主要出现在真实协议的边界场景，以及旧 Codex 专用链路与新 v2 统一链路之间的功能差异。

最重要的发现：

1. **Grok 恢复会话可能改变审批模式。** 首次会话明确关闭 yolo/auto，后续 load 没有重复设置，上游会采用本机默认值。
2. **Pi 存在“错误显示完成”和“命令执行完却一直运行”的路径。** RPC 成功回执、一次模型调用结束、整个 Agent 稳定结束，目前没有充分分离。
3. **部分真实输出在中间层丢失。** Grok 扩展事件没有进入正确分派；Codex v2 吞掉白名单外的 item；Pi 等待回应期间丢弃非 UI 事件。
4. **Codex/Pi 的文本 delta 虽到达后端，仍可能不显示为流式正文。** 被归成 `assistant_progress` 后，共享前端直接隐藏该类；Codex 完成消息又没有区分 commentary 和最终答案。
5. **v2 候选消息队列缺少自动出队。** 界面提示任务结束后自动发送，但消费逻辑只接在旧事件链路。
6. **运行中配置控制尚未形成闭环。** 多数选择只保存下一轮参数；Codex 的旧 Plan 参数甚至被 gateway 删除。上游支持的运行中设置接口，也不意味着能够改变已经发出的模型请求。

推荐顺序是：**先修丢事件、错误终态、审批漂移和候选队列，再统一长驻会话与配置控制，最后开放原生纠偏、队列、分支和富结果。**

详细证据分卷：

- [Codex：7 组问题、控制接口和能力差异](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/codex.md)
- [Grok Build：6 组问题、扩展协议和能力差异](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/grok.md)
- [Pi：7 组问题、RPC 生命周期和能力差异](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/pi.md)
- [源码索引、测试结果与审查边界](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/evidence.md)

## 1. 审查基线与可信度

三个仓库均已用浅克隆拉取到 `/tmp`，固定本次 commit，不将以后变动的 main 当作证据。

| 对象 | 本次快照 | 本地目录 |
| --- | --- | --- |
| Codex | `9f70e348e0227980de97e361cce830236fb18317` | `/tmp/todex-agent-audit-20260907-codex` |
| Grok Build | `72a61251fcffb464bcc687aeb5a998e5a98ec0c9` | `/tmp/todex-agent-audit-20260907-grok-build` |
| Pi | `c1d4c801114545f47c440921d8b3e04aeb1e565d` | `/tmp/todex-agent-audit-20260907-pi` |
| TodeX_backend | `f061c1a045e87694fcc167db63e2e0a13a08a05e` | 当前工作树 |
| TodeX_desktop | 审查前 HEAD `0b29fcac6a6a22e5757f1db32fd6b07a5f79e79c` | 当前工作树，保留原有侧栏改动 |
| TodeX_app 共享协议 | `ed163c894da1d230f7a86de5db0314fb21f2d5c3` | 只读核对 `src/lib` |
| TodeX_web | 当前文件快照；目录没有 `.git` | 只读核对、执行相关测试和类型检查 |

本机 PATH 中 CLI 版本：Codex `0.153.4`、Grok `1.0.13 (5e9a58528b76)`、Pi `0.84.4`。**这不是远程后端的安装版本证明，也未证明这些二进制逐行对应上述上游 SHA。** 因而：本地确定的控制/解析缺口可以直接列出；依赖上游新接口的功能应先做安装版能力探测，再决定开放。

文中“确认”指调用方、适配层和上游生产/消费代码可以连成证据链；“风险”指存在明确时序缺口，但没有实机复现其所有后果；“未开放”是产品机会，不自动等于错误。P1/P2 是本次建议修复顺序，不是安全漏洞评级。

没有调用付费模型、没有操作真实对话或读取用户凭据。当前测试通过不等于这些边界场景通过；历史文档记载的真实 Codex/Pi smoke 也不能代替本次对所有协议路径的验证。

## 2. 当前架构：哪里已经做对，哪里发生分裂

当前主要路径：

```text
Desktop / Web
  → useTodeXSession / ProtocolCommands
  → /v2/ws conversation.* 或 REST
  → ConversationSupervisor（所有权、工作区信任、单个 active turn）
  → Codex app-server / Grok ACP / Pi RPC 适配器
  → JSONL 事件持久化与广播
  → ConversationRecovery
  → TodeX_app/conversationRuntime + mobileParity
  → 对话正文、工具、审批、用量和任务状态

并存：旧 Codex 会话 → codex_gateway → 长驻 app-server
```

其中 `TodeX_app/src/lib` 被 Desktop/Web 通过 `@todex/protocol` 引用。因此后续修解析必须同时检查这层；只修改 Desktop 内组件不能解决中间投影已经丢掉的数据。[路径配置](/Users/youtonghy/github/Project/Todex/TodeX_desktop/tsconfig.web.json:17)

| 方面 | 当前正确基础 | 待优化点 |
| --- | --- | --- |
| 结构化连接 | Codex JSON-RPC、Grok ACP、Pi JSONL RPC；不是解析终端彩色文本 | 各适配器的独立等待循环和每轮重启，不利于并发控制和事件完整消费 |
| 请求确认 | 已区分未发送、被拒绝、已发送但结果未知；丢 ACK 不自动重发 | 保留这套规则，并扩展到队列、配置和取消；不要把“可重试”当作可重复执行 |
| 回放恢复 | REST/实时帧进入连续 sequence 投影；缺口补齐、重复去重、旧恢复响应隔离 | 这是 TodeX 日志恢复，不等于上游原生上下文已经成功恢复 |
| 权限 | 有能力矩阵、后端输入校验和批准选项语义验证 | Grok new/load 不一致；Pi 无原生逐工具权限系统，不能只用统一开关暗示有沙箱 |
| 控制能力 | Codex v2 原生 fork/compact、cancel 等已实现 | 旧 gateway 的高级控制没有完整迁入 v2；字段存在或面板存在不等于动作可用 |
| 数据持久化 | 日志写入、flush、sync_data 后广播，有顺序保护 | 每个细粒度 delta 都经过持久写入，吞吐需实测；只能在保留关键事件持久性的前提下合并文本 delta |

依据：[请求状态](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/protocolCommands.ts:20)、[回放恢复](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/conversationRecovery.ts:8)、[日志持久化](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/conversation/store.rs:270)。

## 3. 优化当前连接、控制与返回解析

### 3.1 第一批应该修复的行为

| 编号 | 优先级 | 用户触发与可见后果 | 建议动作 |
| --- | --- | --- | --- |
| G2 | P1 | Grok 本机默认 yolo/auto 开启，第二轮 load 后审批行为可能扩大 | new/load 使用同一明确权限策略，回读实际模式；加两轮恢复 fixture |
| PI-02 | P1 | Pi 最终 API 错误或重试耗尽，任务却显示完成 | 在 settled 时判断最终 outcome，保留 errorMessage；不能被后续 completed 覆盖 |
| PI-01/03 | P1 | 纯扩展命令只回 success；或 ack 前已有消息/结束事件，任务挂起或输出消失 | 响应关联与通知消费分离；识别命令结束和 Agent run 结束 |
| G1 | P1 | Grok 子 agent、压缩、用量走厂商扩展通道，现有面板不更新 | 修完整 method 分派，测试从真实 JSON-RPC 外壳进入，而非只测 helper |
| C3 | P1 | Codex 正文不流式，commentary 完成后混入最终回答 | 维护 item registry，保留 phase，delta 与 completed 使用同一身份 |
| C1 | P1 | 旧 Codex /plan 请求失去 collaborationMode | 按上游 schema 保留 mode/settings；Plan 本身不等于 OS 沙箱 |
| C5 | P1，受影响 MCP 场景 | Codex v2 使用需补填信息的 MCP 服务，被回 -32601 | 将旧 elicitation 支持接入统一事件/答复链路 |
| U1 | P1 | v2 运行中追加一条消息，界面提示会自动继续，结束后却不发 | 将队列消费接到统一终态；之后升级为后端持久队列 |
| C6 / G3 | P2，尽早处理 | Codex 新 item 静默丢弃；Grok prompt 最终 metadata 丢失 | 默认保留未知数据；补结构化结果、取消详情、权威用量 |

完整触发条件、上游行号、修改方向和验收样本在三份分卷，不建议只凭表格直接改代码。

### 3.2 跨三家的确定问题：候选队列未接上 v2

Desktop 的 `submitChat` 在正在思考时将输入加入 `queuedChatDrafts`，并提示“当前任务完成后会自动继续发送”。但唯一取队首的逻辑位于旧 Codex 事件处理器。v2 `conversation.event` 分流到 `ConversationRecovery` 后直接 return，而 `runtimeUpdateRef` 只清理当前请求，没有消费候选队列。Web 有相同结构。

证据：[加入候选](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:6438)、[旧链路消费](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:2335)、[v2 分流](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:2523)、[v2 终态处理](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:1367)、[Web 对应入队](/Users/youtonghy/github/Project/Todex/TodeX_web/src/renderer/session/useTodeXSession.ts:6467)。这是静态调用链确认，未声称实机点击复现。

短期修复应把消费触发迁到统一终态，等待当前提交结算后再发送，用队列项 ID 防重复。失败、用户取消、未知执行状态时应该暂停队列并解释原因，而非无条件启动下一项。恢复历史的 terminal event 不能启动一条旧队列消息。

中期放到后端持久化：每项带 ID、状态、附件引用、配置快照和创建时间，支持删除、修改、排序。当前 React 内存队列在页面重载后也没有恢复保证。上游原生队列可作为 provider 实现，TodeX 仍要维护统一可见状态。

验收至少覆盖：运行时连发三项、完成自动发下一项、失败暂停、取消暂停、丢 ACK 后不重复、重连回放终态不误发、切后台连接不串队列。

### 3.3 配置需要分成“想要什么、是否送达、何时生效”

目前 `applyConversationModelSelection` 只改变本地会话选择；发 prompt 时才传 model/reasoningEffort。当前模型按钮可在运行时修改，却没有单独展示“本次正在使用”和“下次将使用”。部分旧 tier/personality 控制发出请求后立即显示成功，没有等待对应有效值确认。[本地选择](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:5541)、[prompt 参数](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:5115)、[tier 控制](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:4349)。

建议每次配置变更统一记录：

| 字段 | 含义 |
| --- | --- |
| requested | 用户选择或继承来的值 |
| scope | 全局默认、工作区、会话、下一轮、运行中当前轮 |
| source | 默认/工作区/用户/Agent 或扩展覆写 |
| status | pending、applied、rejected、targetUnavailable、unknown |
| effective | Agent 确认的值；不能用请求参数直接复制充当确认 |
| effectiveFrom | 下一轮、下一次模型调用或后续读取设置的步骤 |
| revision / turnId | 防止过期回复覆盖新选择，防止更新到已结束的一轮 |

按 provider 使用原生语义：

- **Codex**：`thread/settings/update` 影响后续 turn；`turn/settings/update` 是本次源码中的实验接口，发布到活动 turn 后续捕获设置的步骤，已经发出的推理、待批准动作和子会话保持原设置。返回 `applied` 也不保证本轮一定还有下一次推理。必须按安装版本启用，不能宣传为“立即切换正在输出的模型”。[上游定义](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L40)
- **Grok**：用 ACP `set_config_option` 和实际 config 更新通知确认；运行中插话使用专门 interject 通道。模型设置的应用边界必须服从上游 actor，不反推在途请求已经改变。
- **Pi**：已有 `get_state` 可以读真实 model/thinkingLevel，但当前只取其中图片能力信息。先回传实际值，再开放 `set_model`/`set_thinking_level`；扩展改模型或切原生 session 也应同步。Pi 的设置改变不追溯当前已提交的模型请求。

生效权限的显示已经区分 provider-confirmed，值得保留；下一步把模型、推理、tier、模式也纳入同一状态。没有原生确认能力时明确显示“已请求，未能确认”，而不是自动显示成功。

另一个应修的小问题是共享 `providerCapabilityMatrix` 把 `steering` 缺省为 `cancel`。能停止任务不代表能在运行中纠偏，应默认 false，仅由能力证据启用。当前实际按钮还受 `controlActions` 限制，因此这是能力描述错误，不等同于已经有错误按钮可点击。[能力推导](/Users/youtonghy/github/Project/Todex/TodeX_app/src/lib/v2.ts:180)

### 3.4 从“每轮启动器”演进为可控的原生会话

当前三家统一 driver 主要按每轮启动、恢复、结束、关闭运行。它能保留磁盘历史，但不保留所有进程内状态。Codex 的 session approval cache 就是具体例子：用户选择整个 session 允许，下一轮新进程又用空缓存。

推荐引入每个活动原生会话的会话管理器（actor），由统一 supervisor 管理：

1. 一个持续读取 stdout 的任务，所有 response 按请求 ID 找等待者；notification 和 server request 永远不会因“正在等另一个回复”而被吞掉。
2. prompt、steer、配置、取消、审批答复通过命令通道进入，避免多个函数竞争读同一个流。
3. 明确区分连接启动、会话恢复、空闲、执行、等待输入、取消中、终态和进程退出。RPC ack 不直接等同任务完成。
4. 进程按空闲时间和数量上限回收；记录 native session/thread ID 和恢复意图。Pi 找不到原生文件时要报告恢复失败，不能悄悄新建上下文。
5. cancel 先发送原生请求并继续消费到终态，超过有界宽限期再强制结束；用 graceful/forced 标识结果。Grok 当前立即终止的路径应优先补齐。
6. 进程崩溃可以重建连接和回放 TodeX 日志；已发送且未确认的 prompt 不应自动再执行。上游临时授权失效也不能由宿主擅自变成永久授权。

这不是要求立刻把所有会话永久保活。长驻会增加资源占用，需要测首次/续聊延迟、MCP 初始化次数、活跃 worker 数量和取消耗时。报告没有编造可节省的毫秒数，也没有将重启必然等同历史丢失。

### 3.5 返回解析应同时满足四个层次

**收到、保存、归一化、正确展示是四件事。** 建议维护按 upstream event/item 类型列出的覆盖清单，每种都记录这四个状态。

| 层次 | 应保证的行为 | 当前代表性缺口 |
| --- | --- | --- |
| 收到 | 完整识别 JSON-RPC method、response/error、厂商扩展 | Grok 扩展 method 不匹配；Pi pre-ack 通知被消耗 |
| 保存 | 未知类型默认保留原始信息及原生身份；敏感字段沿用脱敏 | Codex 未识别 started/completed item 直接 return，无 fallback |
| 归一化 | message、tool、usage、permission、plan、subagent、compaction、artifact、terminal outcome 分离 | Grok 汇总 metadata、Pi 最终 error；reasoning 分段和来源缺失 |
| 展示 | final 流式；commentary 独立；工具完整；错误可见；图片/结构化结果可用 | assistant_progress 被隐藏；新图片 item 丢失；文本片段 ID 冲突 |

事件身份建议至少包含 provider、nativeSessionId、nativeTurnId、message/item ID、contentIndex 和来源。TodeX turn ID 仍用于本地归属，不替代原生身份。一个用户请求内部可以有多次 LLM 调用，不能只用 turnId+contentIndex 聚合所有思考块。

usage 应区分每次调用和整个 prompt 汇总；后者不能再次累加已计入的调用。失败/取消仍可能消耗 token。输入缓存“已包含/额外计数/未知”要保留现有语义；未知值不能补 0，更不能推算不可靠 TPS。

## 4. 哪些功能可以做：共有能力与各家特色

这里的“特色”指本次审查确认了某家原生协议有直接支持、适合优先利用；没有在另一家发现同等接口，不等于另一家永远不能借助扩展实现。

### 4.1 共有或跨两家可复用的机会

| 功能 | Codex | Grok Build | Pi | TodeX 当前与建议 |
| --- | --- | --- | --- | --- |
| 运行中纠偏/追加信息 | 原生 turn/steer；旧 gateway 已接 | 原生 interject，含图片 | steer | v2 缺统一通路；最高价值新增能力之一，减少停止重做 |
| 原生后续消息队列 | thread/queue 系列，支持管理 | 有中途插话队列，不宜等同完整任务队列 | follow_up、clear_queue、消费模式 | 本地候选已有但 v2 出队缺陷；先修，再做持久队列和区别“纠偏/稍后执行” |
| 会话内模型/推理修改 | thread/turn settings，作用域不同 | config option + live actor | set_model / thinking level | 每轮选择已做；缺回执、真实有效值和运行中控制 |
| 原生分支 | fork，v2 已做 | 原生 fork 未接 | fork/clone 未接 | 将既有 Fork 产品扩展到 Grok/Pi；不是再造一个复制历史按钮 |
| 上下文压缩 | 原生手动/自动；v2 手动已做 | 有自动压缩事件；本次未确认等价手动 RPC | compact/custom instructions + 自动设置 | 开放 Pi 手动压缩，修 Grok 自动状态；不应承诺三家都有相同手动操作 |
| 交互式问答/工具请求 | user input、审批、MCP elicitation | question/plan approval/MCP elicitation | 扩展 select/confirm/input/editor | 基础 UI 已有；补 Codex v2 elicitation、Grok 完整回答选项、Pi timeout/并发 |
| Skills/命令目录 | 原生 skills/命令能力 | builtin + session plugins/skills | extension/prompt/skill commands | 已有能力面板；补动态 session 目录和来源，避免重复造总目录 |
| 子任务观察 | 原生协作事件与新 subAgentActivity | 子 agent 专有事件 | 扩展可实现，不认定为默认原生子 agent 协议 | 面板已有；先修事件映射，再做详情、父子关系和跳转 |
| 结构化结果/产物 | outputSchema、图片、富 item | structured_output、最终 metadata | tools/custom messages、扩展 UI | 增加带类型的产物卡片/下载/预览；先防止数据在后端丢失 |
| 原生历史管理 | 搜索、列表、fork 等 | list/resume/fork/rewind | tree/entries/fork/clone | 原生 CLI 历史导入、从指定节点继续，明确原生历史和本地展示历史 |
| MCP 管理 | 原生 MCP 与旧管理入口已有 | 原生 MCP，支持 session 热更新 | 无通用原生 MCP RPC，当前有 managed MCP | 保留 provider 差异，不显示虚假的“三家统一原生 MCP” |

Codex 的 thread/settings/update、thread/queue 系列、thread/search/searchOccurrences、后台终端 clean/list/terminate 在本次源码中同样标记 experimental。下表及路线中的高级能力均需按安装版协商或受控探测启用。

矩阵依据见各分卷能力表及[源码索引](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/evidence.md)。

### 4.2 Codex 适合优先利用的特色

1. **运行中设置控制台。** 显示本轮 model、effort、tier、reviewer 的已请求/已发布状态；用安装版支持的实验 turn settings 更新，不假装支持热切 sandbox。
2. **跨会话搜索与命中定位。** 利用 thread/search、searchOccurrences，找以前的代码决策、错误和解决方式；本次未发现对应调用。
3. **后台终端管理。** 软件已有终端，也有 clean 类操作；缺的是列出 Agent 原生后台进程并单独终止，与当前任务关联，而不是再做一个普通终端。
4. **图片生成与富结果显示。** 先保证 imageGeneration item 保存和展示，再做图片版本、引用到下一轮、产物查看。
5. **实时语音编程。** 上游有实验 thread/realtime 接口；本地未接。价值明确，但需要独立音频输入输出、暂停、打断和状态同步，不应排在丢事件修复之前。

Goal、Memory、Plugins、Review、account、hooks/list 在旧控制链路已有相应实现，**不应列成“整个软件没做”**；应逐项迁入统一会话并验证回执、数据源和可用范围。

### 4.3 Grok Build 适合优先利用的特色

1. **检查点与 rewind。** 提供清晰的回退点、会话范围和文件变化预览。它的原生恢复代码值得利用，但不能把删除聊天消息当作恢复文件。
2. **按会话更新 MCP 和重载插件。** 当前 nativeMcp=true 不代表用户能在 TodeX 完成新增、重载、确认生效的闭环。
3. **更完整的访谈交互。** 现有基础问答可扩为多选、备注、先讨论、跳过访谈；保留上游 outcome，避免所有结果压成 accepted/cancelled。
4. **更细的取消策略。** 是否连带取消子 agent、无输出时回退等；应在优雅取消和终态确认可靠之后提供。
5. **会话级命令和插件目录。** initialize 只提供内建命令，session catalog 能反映项目真实可用的技能和扩展。

### 4.4 Pi 适合优先利用的特色

1. **原生树状会话。** get_tree、get_entries、fork、clone 可以支持从任意用户节点探索另一条实现路径，保留真实上下文关系。
2. **可控纠偏与后续队列。** steering/follow-up 分开，显示 one-at-a-time/all 等消费策略，支持删除排队消息。
3. **重试面板。** 原生自动重试事件与 abort_retry 可以显示失败原因、重试进度，允许只停重试而不是粗暴停止全部。
4. **轻量扩展 UI。** 除已有输入对话，还可把状态、通知、widget、标题和编辑器预填映射到宿主；不需要执行任意扩展 HTML。
5. **原生统计、HTML 导出、命名同步。** 可在已有用量/历史功能上增加原生一致性。
6. **执行并加入上下文。** RPC bash 可选择是否让结果进入 Agent 上下文；与产品已有独立终端区分，用户明确选择。

Pi 默认没有原生逐工具权限系统，`--approve` 是信任本地资源相关参数；不要把它解释成统一的批准所有工具开关。若未来产品需要隔离执行，应单独设计受约束运行环境，这不是现成 RPC 控件。

## 5. 可实施的路线与验收条件

| 阶段 | 建议交付 | 完成标准 |
| --- | --- | --- |
| A：修复现有承诺 | G2 审批一致性、Pi 终态/pre-ack/纯命令、G1 扩展分派、C1/C3/C5/C6、v2 队列 | 真实形状 fixture 从 transport 到 UI 全链通过；无静默丢失；成功/失败/取消唯一终态 |
| B：连接和配置基础 | 长驻 reader/命令通道、优雅取消、恢复校验、requested/effective 配置 | 两轮续聊状态一致；配置拒绝可见；过期 turn 不误更新；崩溃不重复执行 |
| C：优先新增能力 | 三家纠偏；Codex/Pi 原生队列；Grok/Pi fork；Pi compact | 每个能力以安装版实测/协商结果启用；Desktop/Web 行为一致；队列跨重连可核对 |
| D：差异化体验 | Grok rewind/MCP 热更新、Pi tree/扩展 UI、Codex 搜索/后台终端/富产物 | 每项有独立原生状态、失败处理和可回放结果，不仅是按钮调用 |
| E：较大探索 | Codex 实时语音等实验能力 | 先独立验证接口版本、资源生命周期和中断体验，再接入主对话 |

每阶段都应先写清实际功能边界。对于外部动作，配置失败不能悄悄降级后继续按更宽权限执行；对普通未知事件则应尽量保留并继续处理，避免上游增加一个字段就中断整个任务。

建议固定并保存每个 provider 的 `binaryVersion + protocol/agentVersion + supportedMethods + modelCatalog + schemaFingerprint`。其中 supportedMethods/schemaFingerprint 并非三家都在握手中直接提供；缺少的字段应由安装版 schema 或受控探测生成，不能仅从版本号推定。升级 CLI 时对比协议 schema/事件样本；先运行契约测试，再做隔离工作区的小规模真实 smoke。使用最新 main 开发、却连接不同版本二进制，是当前必须控制的兼容风险。

后续改动涉及 backend、共享 TodeX_app 协议、Desktop 和 Web，应该统一一个事件模型，两个前端共用；UI 按项目要求使用 HeroUI/Pro。当前 Web 目录没有 Git 元数据，共享协议又位于独立仓库，正式实施时需确认这些代码的交付来源和提交边界，但这不妨碍本次只读审查。

## 6. 本次验证结果与仍需验证的部分

已运行：

- 后端 `cargo test --offline --bin todex-agentd`：**227 passed，1 ignored**。首次受沙箱限制有 8 项失败，允许本地测试服务后重跑通过；不将首次环境失败列为产品问题。
- Desktop `pnpm typecheck`：通过。
- Web 会话恢复、请求 ACK、时间线、运行状态、附件相关测试：**5 个文件、24 项通过**。
- 额外 `/tmp` 投影探针：**3 项通过，确认的是当前缺陷表现**——Codex 形状的文本 delta 不显示；error stopReason 配上 turn.completed 仍为 completed；cancel 被错误推导为 steering。它们不是“正确性已经通过”的测试。
- Web `pnpm typecheck`：通过。原始日志见[证据记录](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/evidence.md)。

仍需真实安装版验证：两轮审批恢复、真实扩展命令/pre-ack 时序、MCP elicitation、并发扩展对话超时、取消后的原生历史恢复，以及新 live settings 接口。未构建三家完整上游，也没有执行付费推理；本报告的代码问题和功能机会据此限定，不把潜在后果写成已发生事故。
