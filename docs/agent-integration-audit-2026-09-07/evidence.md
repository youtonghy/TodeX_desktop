# 源码索引与验证记录

本文件为 [主报告](/Users/youtonghy/github/Project/Todex/TodeX_desktop/docs/agent-integration-audit-2026-09-07/README.md) 的证据入口。GitHub 链接固定本次克隆 SHA；本地行号对应审查时工作树，后续修改可能移动。分卷里的 B/D/A/U 路径缩写分别指 backend/desktop/TodeX_app/对应上游目录。

## Codex

| 问题/能力 | TodeX 证据 | 上游证据 |
| --- | --- | --- |
| C1 Plan 字段被删除 | [normalize_turn_start_params](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/codex_gateway/mod.rs:2931) | [collaborationMode 参数](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L243) |
| C2 运行中设置 | [DriverPrompt 字段](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/types.rs:139)、[前端选择](/Users/youtonghy/github/Project/Todex/TodeX_desktop/src/renderer/session/useTodeXSession.ts:5541) | [实验 turn settings，applied 的边界](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L40)、[thread settings](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L226) |
| C3 phase 与流式正文 | [delta 分类](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/codex.rs:714)、[前端隐藏](/Users/youtonghy/github/Project/Todex/TodeX_app/src/lib/mobileParity.ts:977) | [AgentMessage phase](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L251) |
| C4 每轮进程与 session 授权 | [run_turn](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/codex.rs:302) | [ApprovalStore 默认重建](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/core/src/session/session.rs#L1439)、[工具授权缓存](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/core/src/tools/sandboxing.rs#L67) |
| C5 elicitation | [请求白名单](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/codex.rs:880)、[旧 gateway 实现](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/codex_gateway/mod.rs:3409) | [server requests](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/common.rs#L1747) |
| C6 item 覆盖 | [item 分派](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/codex.rs:681)、[分类白名单](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/codex.rs:824) | [ThreadItem 类型](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L234) |
| C7 reasoning/catalog | [catalog 解析](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/codex.rs:199)、[reasoning delta](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/codex.rs:723) | [模型能力及分页](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/model.rs#L105)、[reasoning 索引](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1443) |
| 原生队列 | 主报告所列当前调用检索范围 | [thread/queue API](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/common.rs#L624) |
| 搜索/命中 | 同上 | [thread search](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/common.rs#L806) |
| 后台终端/语音 | 旧 clean 已有；新增接口未发现调用 | [后台终端](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/common.rs#L710)、[实验 realtime](https://github.com/openai/codex/blob/9f70e348e0227980de97e361cce830236fb18317/codex-rs/app-server-protocol/src/protocol/common.rs#L1033) |

补充核对了 [OpenAI 官方 App Server 文档](https://learn.chatgpt.com/docs/app-server)。具体兼容结论以上述固定源码及安装版探测为准；没有用宣传页替代源码证据。

## Grok Build

上游目录含真实 Rust CLI/TUI 与 runtime；其 `SOURCE_REV` 是 `a549186d9d39311f2d3ee4208db62af8c65aa476`，与 Git 仓库快照 SHA、PATH 中安装二进制 build ID 是三个不同标识。

| 问题/能力 | TodeX 证据 | 上游证据 |
| --- | --- | --- |
| G1 扩展通知 | [method 分派](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/acp.rs:581)、[helper](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/acp.rs:660) | [真实 ExtNotification 发送](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs#L995)、[持久化更新通道](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/extensions/session_updates.rs#L28) |
| G2 load 权限默认值 | [load/new 参数](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/acp.rs:270) | [恢复 yolo/auto 默认值](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/agent/mvp_agent/session_setup.rs#L905) |
| G3 最终 metadata | [prompt response 读取](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/acp.rs:371) | [最终 PromptResponse](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs#L1983) |
| G4 命令发现 | [initialize 目录](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/grok.rs:357) | [session commands/list](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/extensions/session_admin.rs#L859) |
| G5 取消窗口 | [取消后 return](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/acp.rs:351)、[终止进程](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/grok.rs:197) | [上游 cancellation](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs#L2166) |
| G6 live 控制 | [轮前配置](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/acp.rs:324) | [config option](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/agent/handlers/config_option.rs#L8)、[interject](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/extensions/interject.rs#L1) |
| fork / MCP 热更新 | [当前 driver 能力](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/grok.rs:103) | [session admin 路由与实现](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/extensions/session_admin.rs#L10) |
| rewind | 原生动作未开放 | [回退定义](https://github.com/xai-org/grok-build/blob/72a61251fcffb464bcc687aeb5a998e5a98ec0c9/crates/codegen/xai-grok-shell/src/extensions/rewind.rs#L1) |

分卷中 `extensions/...` 相对路径指 `crates/codegen/xai-grok-shell/src/extensions/`。实时扩展构造名和最终 ACP wire method 可能涉及 `_` 前缀，应由完整序列化 fixture 验证，不要只照字符串片段实现。

## Pi

| 问题/能力 | TodeX 证据 | 上游证据 |
| --- | --- | --- |
| PI-01 纯命令不结束 | [主读循环](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:363) | [extension/input handled 提前 return](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/coding-agent/src/core/agent-session.ts#L1167) |
| PI-02 error 被当成功 | [settled 返回](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:394)、[supervisor 成功分支](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/supervisor.rs:1075)、[共享前端终态](/Users/youtonghy/github/Project/Todex/TodeX_app/src/lib/conversationRuntime.ts:136) | [最终错误与 settled](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/coding-agent/src/core/agent-session.ts#L1105) |
| PI-03 pre-ack 事件 | [wait_for_response](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:514) | [RPC prompt ack](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L394) |
| PI-04 扩展 timeout | [UI 等待](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:558)、[统一等待时限](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/types.rs:19) | [原生 timeout 处理](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L115) |
| PI-05 消息身份 | [block ID](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:678) | [消息内 contentIndex](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/ai/src/types.ts#L551) |
| PI-06 配置 readback | [get_state 使用](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:315) | [模型/思考设置](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L472) |
| PI-07 会话缺失 | [session-id 启动](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:188) | [找不到 ID 时创建](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/coding-agent/src/main.ts#L431) |
| steer/queue/compact/tree/export | [当前 capability](/Users/youtonghy/github/Project/Todex/TodeX_backend/src/provider/pi.rs:34) | [RPC command 类型清单](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/packages/coding-agent/src/modes/rpc/rpc-types.ts#L20) |
| 权限边界 | `permissions=false`；工作区信任检查已实现 | [Pi 原生权限说明](https://github.com/earendil-works/pi/blob/c1d4c801114545f47c440921d8b3e04aeb1e565d/README.md#permissions--containerization) |

## 实际运行的验证

| 命令/检查 | 结果 | 日志 |
| --- | --- | --- |
| backend `cargo test --offline --bin todex-agentd`，首次沙箱内 | 219 passed，8 failed，1 ignored；端口绑定/进程检查受限 | [首次日志](/tmp/todex-agent-audit-backend-tests.log) |
| 同一后端测试，允许本地测试服务后重跑 | **227 passed，0 failed，1 ignored** | [最终日志](/tmp/todex-agent-audit-backend-tests-unrestricted.log) |
| Desktop `pnpm typecheck` | **通过** | [日志](/tmp/todex-agent-audit-desktop-typecheck.log) |
| Web `pnpm typecheck` | **通过** | [日志](/tmp/todex-agent-audit-web-typecheck.log) |
| Web 五个相关 unit 文件 | **24 项通过** | [日志](/tmp/todex-agent-audit-web-tests.log) |
| 临时 shared projection 探针 | **3 项观察断言通过** | [测试源码](/tmp/todex-agent-audit-projection.test.ts)、[日志](/tmp/todex-agent-audit-projection-tests.log) |

Web 五个文件：`conversationRecovery.test.ts`、`protocolCommands.test.ts`、`conversationTimeline.test.ts`、`conversationRunStatus.test.ts`、`attachmentSupport.test.ts`。不是 Web 全量测试或浏览器 E2E。

投影探针使用真实共享 `conversationRuntime`/`providerCapabilityMatrix`，输入人工构造的 provider 形状事件。它确认中间层的具体表现，不验证上游二进制会在所有情境发送该样本，也不代表已修复。

本机 `--version` 输出：Codex `codex-cli 0.153.4`，Grok `grok 1.0.13 (5e9a58528b76)`，Pi `0.84.4`。Grok 探测使用 `--no-auto-update`；Codex 同时报告沙箱内无法创建 PATH aliases，但正常输出版本。

## 审查边界和交付说明

- 未修改产品代码、未调用付费模型、未新建真实 Agent 会话、未升级任何 CLI。
- 未构建上游全部仓库；没有把运行中配置“发布成功”推断为在途推理参数已改变。
- 后端工作树在审查时无本地改动；Desktop 原有 `App.tsx`、`AppSidebar.tsx` 和未跟踪 `useSidebarPins.ts` 予以保留，不纳入报告提交。
- Web 目录无 Git 元数据，按当前文件审查；本次没有向 Web 或 TodeX_app 写入源代码。
- `/tmp` 克隆、原始日志和探针用于复核，可能被系统清理。持久交付是本目录主报告、三份分卷和本证据记录；上游固定 SHA 链接可用于重新定位。
- 对 provider 功能“未发现调用”的检索范围包括 backend `src`、Desktop/Web `src/renderer` 和实际共用的 TodeX_app `src/lib`；不是对所有可能外部插件的不存在证明。
