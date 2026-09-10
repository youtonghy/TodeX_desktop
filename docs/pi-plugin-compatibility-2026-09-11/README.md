# Pi 插件兼容性调研（2026-09-11）

结论：自动获取 `/` 命令并在 Todex 中提供入口是正确的第一步，但不足以宣称“常见插件基本兼容”。应当让 Pi 继续执行原来的插件 handler、tools 和 hooks，Todex 补齐交互与会话事件的承接。命令描述不是可执行行为定义，也不是完整菜单或表单 schema。

Todex 当前已经有命令发现、命令透传、持久 RPC 会话和四种标准输入表单。实际优先项是修复命令路由冲突，呈现通知/状态/文本组件与自定义消息，接住空闲期间事件，再针对少数常用 TUI 插件做适配。

## 基线与验证范围

- 本机 Pi：`@earendil-works/pi-coding-agent@0.84.4`，Node 24.15.0。
- Desktop：`e909d69`；backend：`9ddf9dd`。产品代码只读检查，没有实施兼容层改动。
- 从本机 `~/.pi/agent/settings.json` 的 `packages` 读取 13 个启用包，并检查对应已安装版本及源码。这里的“启用”表示配置列出，不代表已验证整套 profile 一起加载成功。
- 真实运行 7 个已安装包的 15 次命令调用，另加 1 次确定性的协议 fixture。逐包使用临时 cwd、临时 `PI_CODING_AGENT_DIR`、`--no-session`、显式 `-e` 加载，禁用其他资源发现和模型工具；不复制凭据或真实会话，不调用模型。MCP 使用该插件公开的 `createMcpAdapter({config:{mcpServers:{}}})` 隔离配置。
- 临时配置不是完整操作系统沙箱，部分插件仍通过 `homedir()` 读取自己的设置；本次仅选择检查过的无模型命令分支，不更改这些设置。`/cache export` 与 `/tasks` 创建的数据都在临时目录。
- 本次没有验证付费搜索、真实 MCP 服务、真实子 agent、浏览器审批或 Todex 前端端到端交互。不能把结果换算成生态兼容率。
- 另运行现有 backend 离线测试：`cargo test --locked provider::pi::tests::rpc_ -- --test-threads=1`，7 passed / 0 failed，5.80 秒。backend 测试前后工作树干净。

本机另有自动发现的 `herdr-agent-state.ts`、`zai-model-filter.ts`，以及配置中指向但不存在的 `extensions/dynamic-openai-provider` 路径。本次没有加载这些用户扩展。npm 目录中存在但未被这 13 条配置启用的包，也没有算入兼容样本。直接执行 `pi list` 因当前沙箱不能创建真实 settings 的锁而失败，其随后输出的 “No packages installed” 不能作为安装情况的依据。

## `/` 能发现什么，不能发现什么

Pi 扩展可注册命令、模型工具、生命周期 hooks、快捷键、自定义 provider 和终端 UI；包还可以带 skills、prompt templates、themes。保留 Pi runtime 时，tools/hooks 不必翻译成 Todex 命令，它们在 Pi 内执行。GUI 需要承接输入、输出、用户交互和进程生命周期。[官方扩展文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)

使用 `get_commands`，不要抓取终端 `/` 补全菜单。0.84.4 的实际响应包含 `name`、`description`、`source`、`sourceInfo`，其中 `source` 区分 extension/prompt/skill。调用时保留原始命令名和参数，通过 `prompt` 发送 `/name args`。内置 TUI 命令如 `/settings` 不在这个目录中；模型/会话操作应使用对应原生 RPC 控制。

该目录没有参数 JSON Schema、嵌套菜单、危险操作标记或完整交互流程，也没有输出 `getArgumentCompletions()` 的结果。实测 `/cache` 描述和目录都不能提供 graph/stats/export 的结构化参数信息；fixture 注册了参数补全回调，RPC 仍只返回命令描述。因此可以自动生成“命令入口 + 自由参数输入”，无法可靠地自动生成任意插件的完整行为面板。

0.84.4 随包 `docs/rpc.md:816` 的示例还使用旧 `path/location` 字段；同包 `docs/extensions.md:1560` 和本次实测使用 `sourceInfo`。实现应以版本化协议和实测为准，保留未知元数据，不依赖过时示例。

## 通用交互兼容边界

| 插件能力 | Pi RPC 行为 | Todex 可以采用的策略 |
|---|---|---|
| `select`、`confirm`、`input`、`editor` | 输出请求，等待带原请求 ID 的答复 | 原生表单；保留取消、超时、prefill、并发语义 |
| `notify` | 输出单向消息 | 提示或可回看的通知内容，保留 info/warning/error |
| `setStatus` | 输出 key + 文本 | 按 session/key 更新或清除状态，不不断新增聊天消息 |
| `setWidget` 的字符串数组 | 输出 key + lines + placement | 按 key 更新的文本区域，支持清除 |
| `setTitle`、`setEditorText` | 输出 title / `set_editor_text` | 明确映射会话显示标题、输入草稿，并处理当前用户正在编辑的情况 |
| `sendMessage` 的 custom message | 输出 `role=custom` 消息事件 | 按 `display` 决定可见性；文本/Markdown 兜底，保留 customType/details |
| 自定义工具 | Pi 内执行，输出标准工具事件和 content/details | 通用工具卡保留内容；不要求复现 TUI 的 renderCall/renderResult |
| `ui.custom()` | 返回 undefined，工厂函数根本不执行 | 当前 RPC 没有可以转成网页的 UI 数据，需要插件适配或其他运行方式 |
| widget 工厂、footer/header、自定义编辑器、终端快捷键 | 不支持或退化；不等价于文本 widget | 单独声明能力，不能因为 `/` 存在就标记兼容 |

上述 RPC 支持边界见[官方 RPC 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md#extension-ui-protocol)，并已用协议 fixture 验证：四个对话框正确往返，文本 widget 会输出事件，widget 工厂不执行，`customCalled=false`、`customUndefined=true`、`mode=rpc`、`hasUI=true`。

`hasUI=true` 只表示 RPC 的标准 UI 能用，不保证终端 UI 能用。不应为规避 TUI 统一改成 false：本机 Plannotator 的 `index.ts:1231–1257` 在 `!ctx.hasUI || !hasPlanBrowserHtml()` 时会自动批准计划。兼容改造必须保留审批含义，而非触发插件的无交互 fallback。

## 本机实测结果

以下是在真实 Pi RPC 下的结果，不是已经在 Todex 界面里成功使用这些插件。

| 插件版本 | 测试动作 | 实际结果 | 判断 |
|---|---|---|---|
| `pi-cache-graph@1.0.2` | `/cache` | notify 给出用法 | 命令可调；还需 Todex 显示通知 |
| 同上 | `/cache graph`、`/cache stats` | success + idle，无任何 UI 帧 | 核心面板不兼容；成功 ACK 不代表有功能 |
| 同上 | `/cache export` | 临时目录生成 session.csv，发 notify | 文件导出有效 |
| `@tmustier/pi-usage-extension@0.9.4` | `/usage` | success + idle，无 UI 帧 | 仪表盘依赖 custom TUI |
| `better-custom@0.4.1` | `/better-custom` | success + idle，无 UI 帧 | 首个选择界面就是 custom，后续 input 无法到达 |
| `pi-context-usage@1.0.2` | `/context`、`/context details` | 空会话提示缺少 usage | 只验证空数据分支；有数据时 details 用 custom，来自源码证据 |
| `pi-context-prune@1.4.0` | `/pruner stats` | notify 输出未调用 summarizer | 标准反馈可承接 |
| 同上 | `/pruner settings` | success + idle，无 UI 帧 | 设置面板不兼容 |
| 同上 | `/pruner`，选择 stats | select → notify → success | 动态菜单分支可以按需转成原生交互 |
| `@tintinweb/pi-tasks@0.9.0` | `/tasks` → Create task → 两次输入 → 取消菜单 | 4 次标准 UI 请求，临时 JSON 中确实新增任务 | 创建功能可用；未启动子 agent |
| 同上 | `/tasks` → Settings | 顶层 select 后直接返回顶层 select | Settings 的 custom 面板没有出现 |
| `pi-mcp-adapter@2.32.1` | 空配置 `/mcp`、`/mcp tools` | notify 返回无 server/tools；目录还有 `/pi-mcp` 别名 | RPC 状态 fallback 有效；未测试真实连接/授权 |

所有 15 次插件命令都回了成功 ACK，随后状态为 idle，且没有模型运行。这恰好说明不能用 ACK 成功率衡量功能兼容。观测到的静默退化与各插件 `ui.custom()` 调用点一致；协议 fixture 又直接证明其工厂在 RPC 不执行。

可复现脚本为 [probe.mjs](probe.mjs)，归档的精简原始帧为 [evidence.json](evidence.json)。证据去除了机器绝对路径和无关模型元数据，保留命令、来源、UI 请求、custom 消息、ACK 与 idle 状态。

## 13 个启用包按功能评估

这里是版本限定的源码判断；“可承接”指 Pi 提供相应协议，不代表 Todex 已完整实现或全部实测。

| 包 | 可通用承接的功能 | 需要额外适配/验证的部分 |
|---|---|---|
| `pi-mcp-adapter 2.32.1` | MCP tools、状态文本、标准 elicitation/approval | MCP apps/专用面板、认证/浏览器流程、动态工具和资源更新；`/mcp` 路由冲突 |
| `pi-web-access 0.27.0` | 搜索/抓取 tools、`/search` 的 select、文本 activity widget | 默认 summary-review 打开 curator 浏览器；异步抓取和缓存生命周期、快捷键 |
| `@tintinweb/pi-subagents 0.19.0` | Agent/Workflow/result/steer tools、顶层 `/agents` select | Fleet/Settings/会话查看器 custom TUI；后台 agent 和 scheduler；`@direct` 在 RPC 主动禁用 |
| `pi-context-prune 1.4.0` | context/tool hooks、stats、部分标准菜单 | settings/tree 面板 custom；真实摘要调用和进度组件未测 |
| `@plannotator/pi-extension 0.27.11` | 阶段 hooks、提交计划工具、通知/文本 widget | 外部浏览器审批/批注、异步 follow-up、远端地址可达性；不能降级为无 UI 自动批准 |
| `pi-context-usage 1.0.2` | context summary 通知 | details custom TUI；不把同包 `/release` 当只读命令测试 |
| `pi-cache-graph 1.0.2` | CSV 导出、用法提示 | graph/stats custom TUI |
| `@tmustier/pi-usage-extension 0.9.4` | 命令发现 | loader 和整个仪表盘都是 custom TUI |
| `better-custom 0.4.1` | 后续 input/confirm 协议本身可承接 | 入口及多选使用 custom；provider 配置管理需要专用界面 |
| `pi-exa 0.6.1` | tools、登录 input、notify/status、启用工具 hooks | 初始化可能发现远端 MCP tools；不属于无网络的命令枚举，真实搜索未测 |
| `@tintinweb/pi-tasks 0.9.0` | 任务 tools、标准创建/查看菜单 | Settings custom、组件工厂 widget、自动调度/子 agent 集成 |
| `pi-agenticoding 0.5.0` | readonly/tool hooks、文本警告 widget、持久状态 | notebook/model-groups custom 面板；handoff 与会话/模型行为 |
| `pi-observability 1.3.2` | hooks、统计收集与文本通知 | footer、dashboard、settings 依赖 TUI |

主要本机源码锚点（均相对已安装包根）：

- cache：`src/index.ts:17/56/102`；usage：`index.ts:932/939/980`；better-custom：`index.ts:246/1524`。
- tasks：`src/index.ts:1222/1243/1338`、`src/ui/settings-menu.ts:32`；prune：`dist/index.js:3867/4045/4106`；context usage：`src/context/index.ts:522/537`。
- MCP：`commands.ts:36–47` 明确区分 `mode=tui`，支持文本 fallback；`index.ts:734` 注册命令和补全；`elicitation-handler.ts` / `sampling-handler.ts` 使用标准 UI。
- Web：`index.ts:1749/2328/2427/2771` 注册 tools，`:1753/1766` 默认 summary-review，`:3479/3489` 标准选择；`curator-server.ts:682` 本地 HTTP server。
- Exa：`src/index.ts:427/475/499`；`src/exa_mcp.ts:68–95` 缓存过期时远端 listTools。
- Subagents：`src/index.ts:789` scheduler 启动，`:869–887` TUI-only direct mentions，`:2946/3010/3069/3856` 顶层与 custom 菜单；`src/ui/fleet-list.ts:223` widget 工厂。
- Plannotator：`index.ts:654–674` 浏览器决定后异步 follow-up，`:1120` 注册 submit-plan tool，`:1231` 无交互自动批准，`:1370/1389` 工具门禁与上下文注入。
- Agenticoding：`index.ts:525/647/901`，`model-groups/command.ts:19`；observability：`extensions/observability.ts:485/592/663`。

## Todex 当前的实际缺口

### 已有能力应复用

Backend `src/provider/pi.rs:291` 已调用 `get_commands`，`:335` 保留来源；Desktop `src/renderer/session/useTodeXSession.ts:1347` 发现命令，`src/renderer/screens/ChatPanel.tsx:274` 展示动态补全。Backend `pi.rs:400` 起复用会话进程，`:677` 的 prompt ACK + get_state 屏障处理纯命令完成，`:1284` 等待控制回应时缓冲事件。`:1260/1333` 支持四类 UI、并发、超时及取消。

旧 `docs/agent-integration-audit-2026-09-07/pi.md` 中“每轮重启进程”“纯命令一直运行”“等待 ACK 丢事件”的结论已被当前实现修复，不能继续作为本次发现。

### 优先修复

1. **原生命令被 Todex 同名分支截走。** `useTodeXSession.ts:6146` 的 `/mcp`，以及 `/review`、`/status`、`/plan` 等内置分支，在 `:6499` 动态命令匹配之前 return。本机 MCP adapter 正好注册 `/mcp`，这是可对应真实插件的冲突。不能只把命令追加到菜单；需要明确 provider/来源路由，同时为 Todex 自身操作保留独立入口。
2. **非阻塞 UI 透传后没有用户界面映射。** `pi.rs:1279` 将 notify/status/widget/editor 等输出为 `provider.event`，共享 `TodeX_app/src/lib/mobileParity.ts:916–1058` 没有对应分支，最终返回 null。因此标准通知型插件也可能执行了但没有可见结果。
3. **custom 消息不呈现。** `pi.rs:1527/1566` 的完成消息转换仅将 assistant 的 stop/length 作为消息输出。协议 fixture 已实测 `pi.sendMessage()` 在 ACK 前产生 `role=custom` 的 message_start/message_end；这是可显示的文本内容，不需要 TUI 渲染器，却缺少 Todex 显示路径。
4. **回合结束后的插件事件缺失。** `pi.rs:452–475` 的 idle worker 消费但忽略帧，输入请求直接取消，空闲 300 秒回收进程。持久会话已经比每轮重启好，但仍会影响后台搜索、浏览器返回、定时任务和子 agent 完成消息。
5. **目录和活动会话可能不一致。** 命令发现使用独立临时 Pi 进程，缓存按 provider 保存（`useTodeXSession.ts:453/1347`），不跟随 session 动态变化；发现失败还会保留旧目录。应尽量从活动 runtime 查询，并按 backend/workspace/provider/session 及资源版本绑定缓存。Pi 初始化本身可能启动连接，不能把创建发现进程当纯字符串枚举。

本次没有改 shared frontend，故没有触发 desktop/web 同步改动；后续实施上述路由、事件投影与 UI 时应同时覆盖双端，并包含共享协议/后端变更。

## 建议实施顺序

### 第一阶段：完成通用 RPC 插件交互

- 用原生 `get_commands` 和原 handler 执行；明确命令来源与同名优先级，保留原始名称（含上游可能的 `:1` 后缀），参数先使用自由文本。
- 复用已有标准表单；补 notify、按 key 更新/清除的 status 和文本 widget、editor/title 的明确映射。
- custom message 和工具 content/details 提供通用展示，尊重 `display=false`；自定义 TUI renderer 不影响文本兜底。
- 让会话级事件分发覆盖 idle，明确有后台工作或等待浏览器时的回收规则。超时/取消必须解除原 Pi 请求，不能只关闭 Todex 卡片。

这一阶段可以定位为“Pi RPC 兼容插件支持”。验收重点是 `/tasks` 创建/查看、`/pruner` 文本分支、MCP 状态/标准表单、通知和 custom 消息、后台事件，而不是命令数量。

### 第二阶段：适配常用 TUI 和浏览器功能

- 对 cache/context/usage 等统计类插件，为数据增加结构化出口，由 Todex 展示；对 better-custom/tasks settings/subagents 管理面板，优先为插件增加 RPC 分支或 adapter。不要从命令描述猜出配置并直接执行。
- 为 Plannotator、web curator 接通显式 URL、可访问的运行宿主地址和用户决定回流。桌面与远端 Web 的 localhost 含义不同，不能默认插件自动打开的浏览器就是用户当前浏览器。
- 记录能力来源和已验证版本；允许同一插件同时具有“标准菜单可用”“高级面板需终端”的状态。

### 第三阶段：决定是否需要完整终端兜底

`ui.custom()` 接收任意组件工厂和键盘处理代码，既不是 HTML 也不是表单 schema；当前 RPC 不执行工厂，因此宿主连组件数据也收不到。仅修改 Todex 的 `/` 菜单无法解决。

若要求不修改插件而保留任意终端界面，可评估在 Todex 中运行交互式 Pi TUI + PTY/终端容器；这能保留终端行为，但不会自动获得 Todex 原生控件和会话语义，且必须设计状态共享。SDK 自定义 UI bridge/虚拟终端也是独立工程，不能视为现有 RPC 的一个小映射。默认建议先做前两阶段，对最常用插件逐项适配。

## 复现

```sh
node docs/pi-plugin-compatibility-2026-09-11/probe.mjs /absolute/path/to/pi /absolute/path/to/npm/node_modules
```

脚本先检查命令确实被发现再调用，避免未知 slash 变成模型 prompt。使用独立临时目录；只保留 PATH/TMPDIR/LANG 环境，并设置专用配置和任务文件路径；每包独立进程，结束后关闭。它验证导出文件、任务落盘、四种表单往返和 custom UI 边界。未删除临时目录，便于检查结果。

脚本输出“success”表示原命令返回成功，不能当作完整兼容性通过。随着插件版本变化，需重新审查这些命令分支；此脚本不是用于执行任意未知插件的沙箱。

现有后端回归测试覆盖纯命令、pre-ACK 事件、复用、错误/重试、并发表单/超时、配置/队列、压缩/克隆/恢复与关闭队列；不覆盖前端映射、真实插件 TUI 或浏览器工作流。调研阶段只新增文档和探针，当时未运行双端 UI 构建；实施后的构建与界面验证见 [IMPLEMENTATION.md](IMPLEMENTATION.md)。

## 实现后的真实 Pi 联调（2026-09-11）

以上表格保留调研时的原生 RPC 结果。兼容层实施后，另使用本机 **Pi 0.84.4** 和当前任务新构建的 Todex 后端完成了无模型 HTTP 联调。证据在 [live-evidence.json](live-evidence.json)，脚本为 [live-smoke.mjs](live-smoke.mjs)，确定性扩展为 [live-fixture.ts](live-fixture.ts)。

本轮实际经过 `POST /prompt` → Pi 插件 → Todex 事件日志 → `POST /permissions/:id` → Pi handler，完成 **11 个命令回合**。后端记录 **17 个交互请求**：16 个得到回答或取消；最后一个空闲输入保持挂起，再由独立的停止后台运行操作结清。

| 验收对象 | 本轮证据 |
|---|---|
| 四类标准表单及取消 | select、confirm、input、editor 的回复值都回到真实 Pi handler；多行文本完整；取消返回 undefined |
| 状态、文本组件、标题、草稿 | `extension.ui` 保留 `setStatus`、上下两个 placement 的 `setWidget`、`setTitle` 和 `set_editor_text`；clear 省略值字段 |
| custom 消息 | 3 个 `extension.message` 保留正文与 `display`，包含显式隐藏消息和后台消息 |
| 空闲消息及表单 | 原生事件出现在命令 ACK 之后；Todex 事件带 `scope=session`、同一 runtimeId，且没有错误归属上一轮的 turnId；后台表单可回答 |
| 活动进程命令目录 | 通过 conversationId 查询返回 `catalogSource=session`，runtimeId 与该会话事件一致；cache、mcp、tasks、pruner 四包的 packageName/packageVersion 与实际 manifest 精确匹配 |
| `@tintinweb/pi-tasks@0.9.0` | 创建 1 个任务，临时 JSON 落盘；再次打开列表及详情，题目和描述完整往返 |
| `pi-context-prune@1.4.0` | `/pruner stats` 与 `/pruner` → stats 均完成并在 Todex 日志产生通知 |
| `pi-cache-graph@1.0.2` | `/cache export` 在临时工作区生成 4 行 CSV，并产生包含导出路径的通知 |
| `pi-mcp-adapter@2.32.1` | 显式空配置下 `/mcp` 和 `/mcp tools` 均完成并产生通知；不连接真实 MCP 服务 |
| 停止后台运行 | 挂起空闲输入时调用 `POST /runtime/stop`，请求结清，`provider.runtime` 变为 stopped，原有会话日志仍可读取 |
| 原生 abort 与进程结束 | 原生 abort 返回成功后 get_state 仍为空闲；结束有挂起输入的测试 Pi 进程后确认退出 |

复现完整联调：

```sh
node docs/pi-plugin-compatibility-2026-09-11/live-smoke.mjs /absolute/path/to/pi \
  --backend /absolute/path/to/todex-agentd \
  --packages /absolute/path/to/npm/node_modules
```

不传 `--backend` 时只测原生 Pi RPC。`--packages` 限定上述 4 个已审查版本，版本变化时脚本会要求重新审查命令分支。每次运行创建新的临时 Pi 配置、后端数据目录和工作区，仅监听 `127.0.0.1`；不传递模型密钥、不加载其他用户扩展。直接加载 MCP 原包入口，并通过该版本支持的 `PI_MCP_CONFIG_MODE=exclusive` 限定只读取临时 Pi 配置目录内的空 `mcp.json`，跳过真实共享、项目和包配置。`PI_TASKS`、MCP exclusive 与内存鉴权缓存覆盖写在测试可执行包装器中，因为后端会过滤不在白名单内的继承环境变量。所有任务、CSV 和临时配置均留在测试目录中便于检查。

这组证据覆盖真实插件与后端 HTTP/日志协议，**不等同于浏览器或桌面 UI 的端到端实测**。custom 消息的显隐标志在此验证至日志层；隐藏消息不显示、草稿不自动覆盖、通知不重复弹出由共享状态与界面测试验证。未调用付费模型、真实搜索服务、真实 MCP 服务或子 agent，任意自定义 TUI 的兼容边界不变。
