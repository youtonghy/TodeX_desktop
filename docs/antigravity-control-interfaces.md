# Antigravity 调用接口与格式（TodeX 驱动层参考）

本文把 `com.google.antigravity`（Antigravity 2.32.1）和它配套的 `agy` CLI（1.5.9）能够被外部程序调用的接口、以及每个接口的报文格式，全部整理出来，并对照 TodeX 现有 `antigravity` driver（`TodeX_backend/src/provider/antigravity.rs`）标出可用但未用、以及用错的地方。

取证时间：2026-11-17。取证手段：`agy --help`/子命令实测、ACP stdio 实测、CLI 日志、`app.asar` 主进程源码、以及 IDA Pro MCP 加载 `agy`（session `4969c9e0`）后对二进制内嵌 protobuf 描述符的解析。

标记约定：

- **实测**：本次运行验证过的行为。
- **源码**：从 `app.asar` 解出的 JS 或打包进 `agy` 的官方技能文档读出。
- **二进制**：从 Mach-O 里的字符串/protobuf 描述符解析得到，未逐个调用验证。
- **未验证**：只能推断，没有直接证据。

---

## 0. 结论先行

1. **`agy acp` 是真实存在的 ACP stdio 服务**（`initialize` → `session/new` → `session/prompt` 全通）。`TodeX_backend/src/provider/antigravity.rs:3` 的注释 “`agy` has no ACP or app-server mode” 对 1.5.9 已经不成立。ACP 提供原生 `session/request_permission`、`session/set_mode`、`session/set_model`、`session/set_config_option`、`session/list`、`session/load`、`session/resume`、`session/cancel`，可以整体替代当前的「`--dangerously-skip-permissions` + 全局 `PreToolUse` 钩子」审批方案。
2. **print 模式还有一条 TodeX 没用的结构化错误通道**：stderr 上的一行 `AGY_ERROR: {json}`，带 `status` / `error_code` / `retryable` / `error_id`。当前 driver 靠对 `result.error` 文本做正则匹配判定配额问题（`antigravity.rs:841-852`），可以改成读这个。
3. **钩子协议比 TodeX 用的宽得多**：6 个事件（`SessionStart` / `PreToolUse` / `PostToolUse` / `PreInvocation` / `PostInvocation` / `Stop`），决策值有 `allow|deny|ask|force_ask`，还能 `permissionOverrides`、`overwrite` 改写工具参数、`injectSteps` 注入消息、`terminationBehavior` 强制继续或终止。当前只用 `PreToolUse` 的 `allow`/`deny`。
4. **桌面应用本身有一套 377 个方法的 Connect-RPC 接口**（`exa.language_server_pb.LanguageServerService`），跑在 `https://127.0.0.1:<port>`，用 `x-codeium-csrf-token` 鉴权。想直接驱动桌面端（不是 CLI）时走这套：`StartCascade` / `SendUserCascadeMessage` / `StreamCascadeReactiveUpdates` / `HandleCascadeUserInteraction`。
5. **`agy` 与桌面应用共用同一套 cascade/language-server 代码**，所以 CLI 的会话、技能、插件、hooks、MCP 配置都在 `~/.gemini` 下共享；TodeX 现在写的全局钩子对桌面应用同样生效（这正是 `CliManagerPanel` 里 “从 Antigravity 移除 TodeX 钩子” 的原因）。

---

## 1. 组件、进程与端口

| 组件 | 路径 | 版本 / 形态 | 作用 |
| :-- | :-- | :-- | :-- |
| Electron 主进程 | `/Applications/Antigravity.app/Contents/Resources/app.asar` → `dist/main.js` | 2.32.1，CommonJS | 窗口、深链、单实例、SSH 远程、内建浏览器、host bridge |
| language server | `Contents/Resources/bin/language_server` | Go 1.28-20261102-RC00，205 MB | **应用本体**：HTTPS UI + Connect-RPC API + cascade agent 运行时 |
| CLI | `~/.local/bin/agy` | 1.5.9，Go 1.28，223 MB | print / ACP / TUI；内嵌同一套 cascade + code assist 代码 |
| 录制编码器 | `Contents/Resources/bin/webm_encoder` | Mach-O | 浏览器录制，与调用无关 |
| WebAuthn BLE | `Contents/Resources/bin/cable_ble_scanner` | Mach-O | caBLE，与调用无关 |

进程模型（**实测** + **源码**）：

- Electron 主进程启动 `language_server`，参数见 §6.1；端口默认 `0`（临时端口），只从 LS 的 stdout/stderr 里 `listening on <proto> port at <N> for HTTP(S)` 这一行拿到。
- 窗口加载 `https://127.0.0.1:<port>/`（`constants.js:7` `WINDOW_ORIGIN = 'https://127.0.0.1'`）。**renderer 不在 asar 里**，它由 LS 自己服务。
- 同一台机器上 `language_server` 会同时监听多个回环端口。本次实测：`52933` = HTTPS UI（对明文 HTTP 返回 `400 Client sent an HTTP request to an HTTPS server`），`52934` = 明文 HTTP 且返回 HTML，`52951`/`52953` = 仅回 `401 unauthorized`（token 门后），另有若干出站连接。端口与用途的逐个映射**未验证**。

---

## 2. `agy` CLI：参数、子命令、输出格式

### 2.1 全局参数（实测 `agy --help`）

| 参数 | 取值 | 说明 |
| :-- | :-- | :-- |
| `--add-dir` | 路径，可重复 | 追加工作区目录 |
| `--agent` | 名称 | 指定 agent |
| `-c`, `--continue` | — | 继续最近一次会话 |
| `--conversation` | 会话 ID | 恢复指定会话 |
| `--dangerously-skip-permissions` | — | 自动批准所有工具权限请求 |
| `--disable-slash-commands` | — | print 模式下关闭斜杠命令与技能展开 |
| `--effort` | `low\|medium\|high\|xhigh\|max` | 本次会话的推理强度 |
| `-i`, `--prompt-interactive` | 文本 | 先给一个 prompt，再进交互 |
| `--input-format` | `text\|stream-json`（默认 `text`） | `stream-json` 从 stdin 逐行读 NDJSON，每条跑一个 turn，且要求 `--output-format stream-json` |
| `--json-schema` | JSON 字符串或文件路径 | 约束结构化输出；stream-json 下只作用于最终 `result` |
| `--log-file` | 路径 | 覆盖 CLI 日志路径 |
| `--mode` | `accept-edits\|auto\|plan` | 会话的 agent 执行模式 |
| `--model` | 模型 ID | 会话模型 |
| `--new-project` | — | 为本次会话新建项目 |
| `--output-format` | `text\|json\|stream-json`（默认 `text`） | print 模式输出格式 |
| `-p`, `--print`, `--prompt` | 文本 | 单轮非交互执行 |
| `--print-timeout` | duration，`0s` = 等到本轮结束 | print 模式时限 |
| `--project` | 项目 ID 或名称 | 指定项目 |
| `--remote-agent` | — | 会话跑在远端 agent 上，`--project` 变成远端项目 |
| `--remote-control` | — | 启动时建立 remote control 连接 |
| `--sandbox` | — | 启用沙箱（终端受限） |
| `--settings` | JSON 对象或文件路径 | **仅本次会话**覆盖 `settings.json` 的键 |

注意：`--effort` 是一等参数，TodeX 目前没有用它，而是把强度折进模型 ID 后缀（`antigravity.rs:115-117`）。

### 2.2 子命令（实测）

| 子命令 | 说明 | 输出格式 |
| :-- | :-- | :-- |
| `acp` | ACP stdio 服务，见 §3 | JSON-RPC over NDJSON |
| `agent` / `agents` | 列出可用 agent | 本次为空输出 |
| `changelog` | 变更日志 | 文本 |
| `install` | 配置 PATH 与 shell 别名（`--dir`、`--skip-path`、`--skip-aliases`） | 文本 |
| `mcp add\|remove\|list\|enable\|disable` | 管理 MCP server | `list` 为固定宽度表格：`NAME TYPE STATUS COMMAND/URL` |
| `mic-serve` | 把本机麦克风暴露给远端 CLI，`--addr` 默认 `127.0.0.1:4713` | HTTP |
| `models` | 列出模型（需登录） | `<id>\t<display>`（TodeX 已按此解析，`antigravity.rs:1156-1219`） |
| `plugin install\|uninstall\|list\|enable\|disable\|import\|validate\|link` | 插件管理；`list --json` 输出 `[{name,enabled,version,source,path,skills[]}]` | 表格或 JSON |
| `remote-control start\|status\|stop` | 后台 daemon：`start` 支持 `--name`、`--session`（登录期有效而非开机自启） | 文本 |
| `update` | 自升级 | 文本 |

`agy mcp add` 的参数：`--type stdio|http`（默认 stdio，http/https URL 自动识别）、`--env KEY=value`、`--header "Key: Value"`；标志必须写在 `<name>` 之前。

### 2.3 print 模式：三种 `--output-format`

**`text`**（默认）：stdout 为回答正文；出错时 stderr 先打 `error: <msg>` 和一行 `AGY_ERROR: {...}`。

**`json`**：stdout 为单个结果对象，字段与下文的 `result` 相同（没有 `event` 包装）：

```json
{"conversation_id":"5c77…","status":"ERROR","response":"","error":"…","duration_seconds":0,
 "num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,
 "cache_read_tokens":0,"total_tokens":0},"finished_reason":"error"}
```

**`stream-json`**：stdout 为 NDJSON，每种帧都有顶层 `event`（**实测**）：

```jsonc
// 1. 开场，永远是第一帧
{"event":"init","conversation_id":"<uuid>",
 "init":{"cwd":"/tmp/x",
         "tools":["ask_permission","browser_click_element","run_command","view_file", …],   // 60 个内置工具名
         "permission_mode":"request-review"}}                                              // 见下方注意

// 2. 步骤状态，0..n 条
{"event":"step_update","step_update":{
   "conversation_id":"<uuid>","step_index":1,"state":"DONE","step_type":"user_input"}}
// state: ACTIVE = 进行中，其它 = 终止态
// step_type 观察到的值: user_input, error_message, （工具/子 agent/模型回答由 step_type 与 tool_info 区分）
// 增量字段（TodeX 解析的）: thinking_delta, text_delta, tool_name, tool_info{name,parameters,output,error}, subagent_info

// 3. 终止帧，turn 结束的唯一标志
{"event":"result","result":{
   "conversation_id":"<uuid>","status":"SUCCESS"|"ERROR","response":"<最终文本>",
   "error":"<错误文本>","duration_seconds":1.2,"num_turns":1,
   "usage":{"input_tokens":..,"output_tokens":..,"thinking_tokens":..,
            "cache_read_tokens":..,"total_tokens":..},
   "finished_reason":"error"|"stop"|…}}
```

> `init.permission_mode` 在**所有**模式下都读 `request-review`，包括 `--mode plan` 和 `--dangerously-skip-permissions`（TodeX 已在 `antigravity.rs:127-131` 记录这一点）。不要用它判断模式。

**stderr 结构化错误**（本次配额耗尽时实测）：

```
error: Individual quota reached. …
AGY_ERROR: {"short_error":"RESOURCE_EXHAUSTED (code 429): …","status":"RESOURCE_EXHAUSTED",
            "error_code":429,"code_kind":"http","retryable":true,"error_id":"89e53734-…-1"}
```

`AGY_ERROR:` 行在配额、鉴权、一般失败时都会出现，是**机器可读的错误分类通道**；`error:` 行是同一错误的人类可读形式。

**退出码**：本次 stream-json/json/text 三种格式在配额错误下都没有拿到非零退出码（`head` 管道掩盖了真实状态，**未验证**）。不要依赖退出码，依赖 `result` 帧。

### 2.4 print 模式：`--input-format stream-json` 的输入帧

**实测**：

| 输入行 | 结果 |
| :-- | :-- |
| `{"event":"user","message":{"role":"user","content":"probe"}}` | 被接受（进入鉴权/turn 流程） |
| `{"event":"user","content":[…]}` | `error: stream input "user" message is missing the "message" field` + `result{status:"ERROR",finished_reason:"error"}` |
| `{"event":"whatever"}` | `warning: ignoring unsupported stream input message event "whatever"`，进程继续 |

即：唯一受支持的输入事件是 `user`，必填 `message`，`message` 里放 `{role,content}`；TodeX 写的是 `{"event":"user","message":{"role":"user","content":"<text>"}}`（`antigravity.rs:673-678`），格式正确。一行一个 turn，进程在 stdin 关闭且写完历史后退出。

**图片**：`--input-format stream-json` 只接受文本块（TodeX 注释 `antigravity.rs:604`）。所以 TodeX 把图片落盘 + 在 prompt 里写 `Attached image: <path>` + `--add-dir` 是当前唯一可行路径；ACP 模式则原生支持图片内容块（见 §3.3 `promptCapabilities.image`）。

### 2.5 认证与配额

- 凭据放系统 keyring（`keyring.go`），`GEMINI_API_KEY` 走 API key 路径，`AGY_ADC_AUTH` 走 ADC（**二进制**）。
- OAuth 客户端：`1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`，`redirect_uri=https://antigravity.google/oauth-callback`，PKCE S256，scope 含 `cloud-platform`、`aicode`、`cclog`、`experimentsandconfigs`（**实测**：未登录时打印的授权 URL）。
- print 模式未登录会**同步阻塞**在交互 OAuth 上（日志 `printmode.go:409/415/432/472`，30-60 秒后 `auth cancelled or interrupted`），随后输出 `result{status:"ERROR"}`。也就是说：**任何 print 模式调用在未登录时都会卡住一个 OAuth 超时**，TodeX 的 `--print-timeout` 兜底很有必要。
- 配额耗尽时 `result.error` 或 `AGY_ERROR.status = RESOURCE_EXHAUSTED`，`retryable:true`，附带重置时间。

---

## 3. ACP 接口（`agy acp`）

### 3.1 启动参数（实测 `agy help acp`）

| 参数 | 默认 | 说明 |
| :-- | :-- | :-- |
| `--add-dir` | `[]` | 工作区目录，可重复 |
| `--agent` | — | ACP 会话使用的 agent |
| `--app-data-dir` / `--app_data_dir` | `antigravity-cli` | 应用数据目录名（**相对路径**，见 §3.7） |
| `--cli_dir_name` | — | `app_data_dir` 下 CLI 设置/日志的子目录 |
| `--cli_log_file`, `--log-file` | — | 日志路径 |
| `--cloud_code_endpoint` | `https://daily-cloudcode-pa.googleapis.com` | CCPA API |
| `--dangerously-skip-permissions` | — | 自动批准所有工具权限 |
| `--disable-telemetry` / `--disable_telemetry` | — | 关遥测 |
| `--gemini-dir` / `--gemini_dir` | `.gemini` | Gemini 目录（**相对路径**） |
| `--ide-mcp-port` / `--ide_mcp_port` | `0` | **宿主 IDE 工具 MCP server 端口**；需要 `$PATH` 里有 `nc` |
| `--include-default-customizations` | `true` | 是否加载内置定制 |
| `--is_google3_workspace`, `--is_google_internal` | — | Google 内部环境 |
| `--login` | — | 交互登录后退出（ACP 终端鉴权） |
| `--override_user_agent_name` | — | 覆盖 UA |
| `--process-per-session` | — | 每个会话一个隔离子进程 |
| `--sandbox` | — | 沙箱 + 终端限制 |
| `--stdio` | 默认 | stdio JSON-RPC |
| `--use_stubby_auth` | — | LOAS 认证 |
| `--worker` | — | 内部：为 ACP 前端进程服务单个会话 |

传输：**NDJSON 承载的 JSON-RPC 2.0**，每行一个消息，`\n` 结尾，UTF-8，无 `Content-Length` 头（**实测**）。

### 3.2 方法表（逐个实测 1.5.9）

| 方法 | 方向 | 状态 | 备注 |
| :-- | :-- | :-- | :-- |
| `initialize` | C→S | ✅ | 返回 `protocolVersion:1`（请求传 0 也回 1，不做版本协商） |
| `authenticate` | C→S | ✅ | `{methodId}`；成功返回 `_meta.antigravity.tier`；未知 id → `-32602 Unsupported auth method: "<x>"` |
| `logout` | C→S | ✅ | 返回 `{}`；**会真的登出**（见 §8 风险） |
| `session/new` | C→S | ✅ | 必填可省 `cwd`；`mcpServers` 数组；接受 `additionalDirectories` |
| `session/load` | C→S | ✅ | `{sessionId,cwd,mcpServers}`，回放历史 |
| `session/resume` | C→S | ✅ | 同上，不重放历史 |
| `session/list` | C→S | ✅ | 返回 `{sessions:[{sessionId,cwd,title,updatedAt}]}`，按时间倒序 |
| `session/close` | C→S | ✅ | `{}` |
| `session/set_mode` | C→S | ✅ | `{sessionId,modeId}`，回 `{}` + `current_mode_update` + `config_option_update` |
| `session/set_model` | C→S | ✅ | `{sessionId,modelId}`，回 `{}` + `config_option_update` |
| `session/set_config_option` | C→S | ✅ | `{sessionId,configId,value}`，直接返回新的 `configOptions` 数组 |
| `session/prompt` | C→S | ✅ | `{sessionId,prompt:[{type:"text",text}]}`，阻塞到 turn 结束 |
| `session/cancel` | C→S | ✅（通知） | 按 ACP 规范是 **notification**（无 id）；带 id 发送不会得到响应 |
| `session/update` | S→C | ✅ | 通知，见 §3.5 |
| `session/request_permission` | S→C | ✅ | 请求授权，客户端回 `{outcome:{outcome:"selected",optionId:…}}` |
| `ping` | — | ❌ | `-32601 Method not found: ping` |
| `session/set_additional_directories` | — | ❌ | `-32601`（能力里声明了 `additionalDirectories`，但没有对应方法名；`session/new` 参数里传才生效） |
| `auth/logout`、`authenticate/logout` | — | ❌ | `-32601` |
| 任意未知方法 | — | ❌ | `-32601 Method not found: <name>` |

未探测：`fs/read_text_file`、`fs/write_text_file`、`terminal/*`（这些是 ACP 的**客户端**方法，agent 会回调客户端；`clientCapabilities` 里声明才会触发）。

### 3.3 `initialize` 响应（实测，原样）

```json
{"protocolVersion":1,
 "agentCapabilities":{
   "loadSession":true,"load_session":true,
   "promptCapabilities":{"image":true,"audio":false,"embeddedContext":true},
   "sessionCapabilities":{"resume":{},"close":{},"load":{},"list":{},"additionalDirectories":{}},
   "session_capabilities":{"resume":{},"close":{},"load":{},"list":{},"additionalDirectories":{}},
   "auth":{"logout":{}},
   "_meta":{"antigravity":{"tier":true,"systemPrompt":{"append":true}}}},
 "agentInfo":{"name":"Antigravity ACP Server","version":"1.5.9"},
 "authMethods":[
   {"id":"oauth-personal","name":"Log in with Google"},
   {"id":"oauth-business","name":"Log in with Gemini Enterprise"},
   {"id":"gemini-api-key","name":"Gemini API key"},
   {"id":"agent-platform","name":"Gemini Enterprise Agent Platform"}]}
```

两套 camelCase/snake_case 能力键同时下发（兼容不同 ACP 客户端），解析时两套都要认。

### 3.4 `session/new` 响应（实测，结构摘录）

```json
{"sessionId":"<uuid>",
 "models":{"currentModelId":"gemini-4-argon-medium",
           "availableModels":[{"modelId":"gemini-4-argon-medium","name":"Gemini 4 Argon (Medium)"}, …]},
 "modes":{"currentModeId":"default",
          "availableModes":[{"id":"default","name":"Default","description":"Ask before edits and commands…"},
                            {"id":"accept-edits",…},{"id":"auto",…},{"id":"plan",…}]},
 "configOptions":[
   {"id":"model","category":"model","type":"select","currentValue":"gemini-4-argon",
    "options":[{"value":"gemini-4-argon","name":"Gemini 4 Argon"}, …]},
   {"id":"thought_level","category":"thought_level","type":"select","currentValue":"medium",
    "options":[{"value":"low",…},{"value":"medium",…},{"value":"high",…}]},
   {"id":"mode","category":"mode","type":"select","currentValue":"default","options":[…]}
 ],
 "_meta":{"antigravity":{"tier":{"name":"Google AI Pro","id":"g1-pro-tier","upgradeUri":"…"}}}}
```

本次账户下 `availableModels` 共 18 个 ID（`gemini-4-argon-{low,medium,high}`、`gemini-4-hydrogen-{low,medium,high,xhigh}`、`gemini-pro-orchestrator-g1-pro`、`gemini-3.8-flash-{low,medium,high}`、`claude-opus-5-5-{low,medium,high}`、`claude-sonnet-5-5-{low,medium,high}`、`gpt-oss-120b-medium`）。注意 `configOptions.model` 用的是**去后缀的基名**（7 个），`models.availableModels` 用的是**带强度后缀的全名**（18 个），两者粒度不同，切换模型用哪一个都能用，但回读的 `currentValue` 归一到基名。

`session/new` 之后紧跟两条通知：`available_commands_update`（本次 94 条：9 个内置斜杠命令 + 85 个技能/插件命令）和 `usage_update{used:0,size:1048576}`。

### 3.5 `session/update` 的通知类型（实测出现过的）

| `sessionUpdate` | 载荷 |
| :-- | :-- |
| `available_commands_update` | `availableCommands:[{name,description}]`（斜杠命令 + 技能，可直接做 TodeX 的技能选择器） |
| `usage_update` | `{used,size}`，`size` 为上下文窗口令牌数（本次 1048576） |
| `user_message_chunk` | `content:{type:"text",text}`（回显用户输入） |
| `session_info_update` | `title`（会话标题，服务端自动生成） |
| `agent_message_chunk` | `content:{type:"text",text}`（流式回答；**注意**：错误信息也可能作为 chunk 下发，见 §8） |
| `current_mode_update` | `currentModeId` |
| `config_option_update` | `configOptions:[…]`（模式/模型/思考级别任一变化都会重发全量） |

未观测到但 ACP 规范里存在的：`tool_call` / `tool_call_update` / `plan`。agy 的 `session/new` 能力里没有声明 tool-call 更新类型，工具进度很可能只体现在 `agent_message_chunk` 与其后的 `usage_update`——**未验证**。

### 3.6 错误码

| code | 触发 |
| :-- | :-- |
| `-32601` | 未知方法 |
| `-32602` | 参数/枚举非法（如 auth method） |
| `-32603` | 内部失败，例如 `Failed to start Antigravity conversation` |

### 3.7 与 TodeX 现状相关的两个坑

1. **`--app-data-dir` / `--gemini-dir` 是相对路径**。日志里反复出现 `Failed to resolve GeminiDir ".gemini": .gemini must be an absolute path: path is not absolute, falling back to default`，ACP 启动器随后落到 `~/.gemini/antigravity-cli`。print 模式在同一环境下出现过 “not authenticated”，ACP 却能通过 keyring 认证——路径解析差异会改变凭据/状态目录，**调用方应显式传绝对路径**。
2. **`logout` 会真的注销**。枚举方法面时调用了 `logout`，返回 `{}`，之后所有 print 模式调用都开始走交互 OAuth（日志 `printmode.go:409` `not authenticated, silent auth failed`）。这是 ACP 的破坏性方法，TodeX 不应把它暴露给模型，也不应作为能力探测手段。

---

## 4. `hooks.json` 协议（源码：内置 `agy-customizations` 技能 + TodeX 实现）

位置：定制根目录下的 `hooks.json`，全局是 `~/.gemini/config/hooks.json`，工作区是 `<repo>/.agents/hooks.json`（也认 `.agent/`、`_agents/`、`_agent/`）。

### 4.1 文件结构

```json
{
  "todex-approval": {
    "enabled": true,
    "PreToolUse": [
      {"matcher": "*|run_command|run_command\\|view_file|browser_.*",
       "hooks": [{"type": "command", "command": "sh todex-agy-hook.sh", "timeout": 86400}]}
    ]
  },
  "lint-checker": {
    "PostToolUse": [{"matcher": "run_command", "hooks": [{"command": "./scripts/lint.sh", "timeout": 10}]}]
  },
  "greeting": {
    "SessionStart": [{"command": "./scripts/welcome.sh"}]
  },
  "guard": {
    "PreInvocation": [{"command": "./scripts/gate.sh"}],
    "PostInvocation": [{"command": "./scripts/after.sh"}],
    "Stop": [{"command": "./scripts/stop.sh"}]
  }
}
```

顶层键是**钩子名**，不是事件名；同一个事件名可以出现在多个钩子名下，会被合并并按序执行。

- `matcher` 是**正则**，`"*"`/`""` 匹配全部；工具名 = 步骤类型小写并去掉 `CORTEX_STEP_TYPE_` 前缀（`run_command`、`view_file`、`browser_*` …）。
- handler 只有 `type:"command"`（`sh -c` / `cmd /c`），`timeout` 默认 30 秒，工作目录 = `hooks.json` 所在目录，`~` 会展开；插件内的 hook 额外拿 `PLUGIN_ROOT` / `PLUGIN_DATA`。
- 结构差异：`PreToolUse`/`PostToolUse` 是 **grouped**（`matcher` + `hooks` 包裹），其余四个事件是 **flat**（直接列 handler）。

### 4.2 事件与载荷

所有事件共享的公共字段（**camelCase / protojson**）：

```json
{"conversationId":"<uuid>","workspacePaths":["/ws"],"transcriptPath":"…/.gemini/antigravity-cli/transcript.jsonl",
 "artifactDirectoryPath":"…/artifacts","modelName":"auto","lastUserInput":"…","hookEventName":"PreToolUse","cwd":"/ws"}
```

| 事件 | 触发 | 输入（除公共字段） | 输出 |
| :-- | :-- | :-- | :-- |
| `SessionStart` | 新会话开始一次 | —（只有公共字段） | `{"injectSteps":[…],"terminationBehavior":""}` |
| `PreToolUse` | 工具执行前 | `toolCall{id,name,args}`, `stepIdx` | `{"decision":"allow\|deny\|ask\|force_ask","reason":"…","permissionOverrides":["command(npm test)"],"overwrite":{"CommandLine":"ls -la"}}` |
| `PostToolUse` | 工具完成后 | `toolCall{id,name,args}`, `stepIdx`, `error?` | `{}` |
| `PreInvocation` | 调用模型前 | `invocationNum`, `initialNumSteps` | `{"injectSteps":[…],"terminationBehavior":""\|"terminate"}` |
| `PostInvocation` | 工具调用结束后 | 同 `PreInvocation` | `{"injectSteps":[…],"terminationBehavior":""\|"terminate"\|"force_continue"}` |
| `Stop` | 执行循环终止 | `executionNum`, `terminationReason`, `error`, `fullyIdle`, `continuationActive` | `{"decision":"continue","reason":"…"}` |

`injectSteps` 支持的步骤类型：`{"systemMessage":{"systemMessage":"…","metadata":{"user_markdown":"…"}}}`、`{"userMessage":"…"}`、`{"errorMessage":{"userMessage":"…"}}`（已废弃的 `ephemeralMessage`）。

`Stop.terminationReason` 去掉了 `EXECUTOR_TERMINATION_REASON_` 前缀：`NO_TOOL_CALL`、`MAX_INVOCATIONS`、`MAX_FORCED_INVOCATIONS`、`MAX_TOKEN_BUDGET_EXCEEDED`、`ERROR`、`USER_CANCELED`、`TERMINAL_STEP_TYPE`、`TERMINAL_CUSTOM_HOOK`、`INJECTED_RESPONSE`。

### 4.3 TodeX 当前用法 vs 协议能力

| 能力 | TodeX 现状 | 可用而没用 |
| :-- | :-- | :-- |
| 事件 | 只写 `PreToolUse` | `PostToolUse`（正确的工具结果/错误来源）、`Stop`（可靠的 turn 终止信号）、`SessionStart`/`PreInvocation`（注入上下文）、`PostInvocation`（强制继续） |
| 决策值 | `allow` / `deny` | `ask`（走 agy 自己的审批 UI 并吃 “Always allow” 缓存）、`force_ask`（忽略缓存） |
| 改写 | — | `permissionOverrides`（临时授权）、`overwrite`（浅合并工具参数，结果里会告知模型参数被改写） |
| 载荷 | 只读 `/toolCall/name`、`/toolCall/args`、`/artifactDirectoryPath` | `conversationId`、`workspacePaths`、`transcriptPath`、`modelName`、`lastUserInput`、`stepIdx`、`toolCall.id` |
| 注入 | — | `injectSteps` 的 `systemMessage` / `userMessage` / `errorMessage` + `terminationBehavior` |

`permissionOverrides` 对 TodeX 尤其有用：`mcp(todex_ssh/*)` 这类 allow 规则现在只能靠 `--settings` 在**启动时**整体替换 `permissions`，而钩子可以在**运行时**逐次授权。

---

## 5. 配置与状态文件

### 5.1 目录

| 路径 | 归属 | 内容 |
| :-- | :-- | :-- |
| `~/.gemini/config/` | 全局定制（CLI + 桌面 + IDE 共享） | `hooks.json`、`mcp_config.json`、`plugins/`、`plugins.json`、`skills.json`、`config.json`（含 `userSettings.themeMode`）、`config/` |
| `~/.gemini/settings.json` | 全局 | `mcpServers`、`security` 等 |
| `~/.gemini/antigravity-cli/` | CLI 应用数据 | `settings.json`、`conversations/`、`brain/`、`annotations/`、`mcp/`、`log/`、`conversation_summaries.db`、`persistent_terminals/`、`builtin/`、`plugin_data/` |
| `~/.gemini/antigravity/` | 桌面应用数据 | 同名结构 + `presence/`、`daemon/`、`sidecar_data/`、`antigravity_state.pbtxt`、`conversation_summaries.db` |
| `~/.gemini/antigravity-ide/` | IDE 数据 | 同上 |
| `<repo>/.agents/`（或 `.agent/`、`_agents/`、`_agent/`） | 工作区定制 | `hooks.json`、`skills/<name>/SKILL.md`、`rules/*.md`、`skills.json`、`plugins.json` |
| `~/.gemini/GEMINI.md`、`<repo>/GEMINI.md`、`AGENTS.md` | 规则 | 分层加载，从文件目录向上走到 repo 根 |

### 5.2 `mcp_config.json`

```json
{"mcpServers":{
  "stdio-srv":{"command":"node","args":["server.js"],"env":{"K":"V"}},
  "http-srv":{"url":"https://example.com/mcp"}
}}
```

stdio 支持 `command`/`args`/`env`；远程只支持 **Streamable HTTP**（`url`，兼容旧键 `serverUrl`），不支持 2024-11-05 的 HTTP+SSE。TodeX 额外写了一个扩展键 `timeoutSeconds`（`integration.rs:79-80`，TodeX 的注释说它用来把工具超时从 agy 默认的 180 秒延长），它不在官方 schema 里；本次取证没有验证 `agy` 是否真的读取该键。

### 5.3 `settings.json`

TodeX 用到/写入的键（`antigravity.rs:882-948`、`integration.rs`）：

```jsonc
{
  "colorScheme": "light",
  "trustedWorkspaces": ["/abs/path", …],
  "agentMode": "auto",                 // TodeX 在 native-auto 轮里强制写这个
  "permissions": {"allow": ["mcp(todex_ssh/*)", …], "deny": ["…"]}   // --settings 整体替换这个键
}
```

`--settings` 的语义是**逐键覆盖**，但 `permissions` 是整体替换（TodeX 已按此复制用户对象再追加，`antigravity.rs:880-907`）。

桌面应用自己的设置**不在** `settings.json`，而是 `<userData>/app_storage.json` 里的三个键 `runInBackground` / `keepComputerAwake` / `autoCheckForUpdates`（值以字符串 `"true"`/`"false"` 存放，**源码** `services/settingsService.js:13-21`）。

### 5.4 技能 / 插件 / 清单

- 技能：`skills/<name>/SKILL.md`，YAML frontmatter 必须有 `name` 和 `description`（描述决定何时激活）。
- 插件：`plugins/<name>/plugin.json`，可打包 skills、rules、`mcp_config.json`、hooks；`agy plugin validate [path] [--strict] [--json]` 可校验。
- 清单文件：`skills.json` / `plugins.json` 结构一致——`{"inherits":[{path,include_only,exclude}],"entries":[{path,exclude}]}`，路径支持绝对、`~/`、工作区相对三类解析。
- 定制发现顺序：工作区 `.agents/`（从 cwd 向上到 repo 根）→ 全局 `~/.gemini/config/`；内置定制不由发现机制加载，由 agent 配置指定挂载。

---

## 6. 桌面应用层接口

### 6.1 `language_server` 的启动与发现

参数（**源码** `lsDefaults.js:9-33` + `languageServer.js:223-238`）：

```
language_server --standalone --override_ide_name antigravity --subclient_type hub
  --override_ide_version 2.32.1 --override_user_agent_name antigravity
  --https_server_port <port>            # 0 = 临时端口，或 JETSKI_LS_PORT
  --csrf_token <uuid>                   # 每个进程随机
  --app_data_dir antigravity            # 注意：裸名字，不是绝对路径
  --api_server_url https://generativelanguage.googleapis.com
  --cloud_code_endpoint https://daily-cloudcode-pa.googleapis.com
  --enable_sidecars
  [--host_bridge_url=http://127.0.0.1:<p> --host_bridge_token=<hex>]
  [--headless]
```

- **没有端口文件**。端口只从 LS 的 stdout/stderr 匹配 `/listening on \w+ port at (\d+) for HTTP(S)?/i` 得到，启动超时 60 秒。
- 环境变量注入：`AGY_BROWSER_ACTIVE_PORT_FILE`（指向 Chromium 的 `DevToolsActivePort`）、`CHROME_DEVTOOLS_MCP_JS`、以及登录 shell 的环境。
- 崩溃重启：60 秒窗口内最多 3 次，间隔 2 秒，重启参数不变。
- `--remote-debugging-port` 默认被强制设为 `0`（**临时 CDP 端口**），端口与 WS 路径写在 `<userData>/DevToolsActivePort`（0600）。这是从外部接管 UI 的一条现实通道：`--remote-debugging-port=<固定端口>` 可钉住它。

### 6.2 Connect-RPC：`exa.language_server_pb.LanguageServerService`

- 传输：**Connect over HTTPS**，`https://127.0.0.1:<httpsPort>/exa.language_server_pb.LanguageServerService/<Method>`；同一路径也接受 `application/grpc`、`application/grpc-web+proto`。
- 必需头（**源码**，`remote/remoteSidecars.js:104-113`、`remote/sshConnection.js:370-381`）：

  ```
  content-type: application/json
  connect-protocol-version: 1
  x-codeium-csrf-token: <--csrf_token 的值>
  ```

- token 就在 LS 的 argv 里，同用户可读（`ps`）。LS 对 `127.0.0.1`/`localhost` 用自签证书，Electron 侧对该主机跳过证书校验。
- 方法总数 **377**（24 个是流式，含 22 个 server-stream），proto 文件 `third_party/jetski/language_server_pb/language_server.proto`，完整清单见附录 A。

**驱动一套对话所需的最小方法集**（字段名为 proto 字段名）：

| 步骤 | 方法 | 请求要点 |
| :-- | :-- | :-- |
| 起会话 | `StartCascade` | `metadata`、`cascade_id`（可自带）、`source_metadata`、`workspace_uris[]`、`requested_model`(enum)、`trajectory_type`、`project_env_config`、`tags[]`、`agent_path` |
| 发消息 | `SendUserCascadeMessage` | `cascade_id`、`items[]`(`TextOrScopeItem`)、`images[]`、`cascade_config`、`blocking`、`client_message_id`、`delivery_strategy`(enum)、`message_origin`(enum)、`editor_state`、`tags[]` |
| 收流 | `StreamCascadeReactiveUpdates`（server-stream） | `cascade_id` |
| 交互（审批/提问） | `HandleCascadeUserInteraction` | `cascade_id`、`interaction`(`CascadeUserInteraction`) |
| 取消 | `CancelCascadeInvocation` | `cascade_id`、`kill_background_tasks`、`notify_parent` |
| 读轨迹 | `GetCascadeTrajectory` / `GetCascadeTrajectorySteps` / `GetTrajectoryTurns` | `cascade_id`、`verbosity`(`ClientTrajectoryVerbosity`)、`step_offset` |
| 列表 | `GetAllCascadeTrajectories` / `SearchConversations` | `exclude_subtrajectories` |
| 回滚 | `RevertToCascadeStep` | `cascade_id`、`step_index`、`conversation_only`、`suppress_error_step` |
| 载入 | `LoadTrajectory` / `ForkConversation` / `DeleteCascadeTrajectory` | `cascade_id` |
| 终止 agent | `ForceStopCascadeTree` / `CancelCascadeSteps` | `cascade_id` |

流式方法全清单（可用于订阅式集成）：`SubscribeToSidecars`、`GetSidecarLogs`、`HandleStreamingCommand`、`WatchDirectory`、`WatchVersionControlState`、`StreamUserTrajectoryReactiveUpdates`、`StreamCascadePanelReactiveUpdates`、`StreamCascadeReactiveUpdates`、`StreamCascadeSummariesReactiveUpdates`、`StreamAgentStateUpdates`、`SubscribeToMcpServerStates`、`StreamTerminalShellCommand`、`StreamTerminalOutput`、`SubscribeToPlugins`、`StreamAudioTranscription`、`StartNarration`、`JetboxSubscribeToState`、`JetboxSubscribeToSummaries`、`JetboxSubscribeToGcertState`、`JetboxSubscribeToOAuthState`、`StreamSearchCode`、`ProjectUpdatesStream`、`SetupJetskiChat`、`SubscribeToAgentBrowserRequests`。

> 枚举值（`Model`、`CortexTrajectorySource`、`BackendType` 等）没有展开；需要时用同一个描述符解析（见附录 B）。

### 6.3 host bridge（LS ↔ Electron 主进程，反向通道）

- `http://127.0.0.1:<临时端口>`，仅回环，请求必须同时满足：peer 是回环地址、`Host` 头精确等于 `127.0.0.1:<port>`、`Authorization: Bearer <token>`（token 32 字节 hex），否则 403/401。
- 只有两个方法（服务 `exa.host_bridge_pb.HostBridgeService`）：
  - `POST …/GetUpdateStatus` → `{status:{current_version,latest_version,update_available}}`
  - `POST …/ApplyUpdate` → `{accepted:bool}`
- LS 通过 argv `--host_bridge_url` / `--host_bridge_token` 得到地址与令牌；与 renderer 的 CSRF token **刻意分开**（避免 UI 令牌能触发升级）。

### 6.4 深链 `antigravity://`

- scheme 由 app 名派生：`Antigravity` → `antigravity`（`main.js:185-198`）。
- 入口：`open-url`（macOS）、`second-instance`（Windows/Linux）、冷启动 `process.argv`。
- 主进程**不解析** URL：只做窗口前置，然后 `hubContents.send('deep-link', url)`；窗口还在加载时存进 `pendingDeepLink`，renderer 通过 IPC `deep-link:get-stored` 取走（取一次即清空）。SSH 远程窗口永远收不到深链。
- **URL 语法不在 asar 里**，由 LS 服务的 renderer 解析，本文无法给出可验证的路径/参数约定。唯一在 asar 里能证明的鉴权回调是 SSH 远程场景的 `GET /auth/callback?state=…`（`remote/signInCallback.js:30-70`），它与 `antigravity://` 无关。

### 6.5 应用开关与环境变量

| 开关/变量 | 作用 |
| :-- | :-- |
| `--ssh-host=<host>` | 启动/二次启动时打开 SSH 远程窗口；有深链参数时不生效 |
| `--wsl-distro=<name>` | Windows：在其中运行 LS |
| `--remote-debugging-port=<n>` | 钉住 CDP 端口（默认被强制为 0） |
| `ELECTRON_OZONE_PLATFORM_HINT=headless` | 无头模式：不建窗口/托盘，错误改走 stderr，仍启动 LS |
| `DEV_URL` | 跳过 LS，直接加载指定 URL（开发用） |
| `JETSKI_LS_PORT` | 钉住 LS 的 HTTPS 端口 |
| `DEV_URL` / `CODEIUM_LANGUAGE_SERVER_BIN` | 开发替换 |
| `ANTIGRAVITY_WSL_DISTRO` | WSL distro 兜底 |

---

## 7. 对 TodeX 的改造建议（按收益排序）

### P0 — 用 ACP 取代「跳过权限 + 全局钩子」

现状：ask/full-access 轮一律 `--dangerously-skip-permissions`，再由全局 `PreToolUse` 钩子把每个工具调用转发回 daemon 审批（`antigravity.rs:12-14`、`agy_hook.rs`）。这条链路有三个结构性代价：钩子是**同步阻塞**的、只覆盖 `PreToolUse`、并且要往用户全局配置里写文件（被桌面应用和 IDE 共享）。

ACP 方案：长驻 `agy acp` 进程 + `session/new`（带 `mcpServers` 直接下发 TodeX 的 MCP，不落全局配置），审批走标准 `session/request_permission`，模式走 `session/set_mode`（`default`/`accept-edits`/`auto`/`plan`），模型与思考级别走 `session/set_config_option`。

落地要点：

- `TodeX_backend/src/provider/acp.rs` 已经有 ACP 客户端，并且 `acp.rs:262` 已经把 `ProviderKind::Antigravity` 映射到 `PLAIN_ACP`，缺的是给 Antigravity 增加一条 ACP 传输路径（可与现有 print 路径并存，按 `agy` 的 `agentCapabilities` 探测择优）。
- `session/prompt` 是**阻塞**的，`session/cancel` 是通知；取消要按通知发，不要等响应。
- 注意 1.5.9 的 `logout` 是破坏性方法，别放进能力探测。

### P0 — 结构化错误与真实终止原因

- 解析 stderr 的 `AGY_ERROR: {status,error_code,code_kind,retryable,error_id}`，替换 `antigravity.rs:841-852` 的正则配额猜测；`retryable` 可直接驱动重试策略，`error_id` 可做去重/上报。
- `result.finished_reason`（`stop`/`error`/…）目前没读，可以区分「正常结束」「被 Stop 钩子终止」「注入响应终止」。

### P1 — 把钩子协议用满

- `PostToolUse`：工具结果与错误的正规来源（现在从 `step_update.tool_info` 拼），并可在工具后做格式化/校验。
- `Stop`：比等 `result` 帧更细的终止信号，`terminationReason` 区分 `NO_TOOL_CALL` / `MAX_INVOCATIONS` / `USER_CANCELED`，`fullyIdle` 表示后台任务是否清空。
- `permissionOverrides`：运行时逐次授权，替代「启动时整体替换 `permissions`」。
- `decision:"ask"` / `"force_ask"`：把选择权交回 agy 自己的审批 UI（带 "Always allow" 缓存）；TodeX 需要自己审批时再回 `allow`/`deny`。
- `SessionStart` / `PreInvocation` 的 `injectSteps.systemMessage`：注入 TodeX 的会话上下文，不必靠拼 prompt 文本。
- `overwrite`：需要改写危险命令时不用 deny。

### P1 — `--json-schema` 与 `--effort`

- `--json-schema`（stream-json 下约束最终 `result`）可以做结构化收尾，省掉一次额外解析/修复。
- `--effort low|medium|high|xhigh|max` 是一等参数，ACP 侧对应 `configOption.thought_level`（只有 low/medium/high）。目前 TodeX 把强度折进模型 ID 后缀，遇到 `xhigh` 或非 Gemini 模型（`gpt-oss-120b-medium`）时映射关系容易错。

### P2 — 会话历史与列表

`session/list`（`{sessionId,cwd,title,updatedAt}`）可以直接做 TodeX 的“原生历史”面板；`session/load` / `session/resume` 区分「回放历史」与「不重放」。现在只有 `--conversation <id>`，无法列出、无法区分回放语义。

### P2 — 稳定化参数

- `--include-default-customizations=false` + `--disable-slash-commands`：print 轮里关闭内置技能与斜杠展开，避免 `-p "…"` 被 `/goal` 之类意外解释。
- `--process-per-session`（ACP）：会话间隔离，避免长驻进程的状态串味。
- `--print-timeout`：未登录时 print 模式会阻塞在交互 OAuth 上，`--print-timeout` 是必要的兜底。
- `--log-file` / `--cli_log_file`：把每次调用的 agy 日志落到 TodeX 的会话目录，便于故障归因。

### P2 — 显式绝对路径

`--app-data-dir` 与 `--gemini-dir` 默认是**相对路径**，`agy` 会先尝试相对解析并在失败后回退。TodeX 目前在 `<workspace>` 下以 workspace 为 cwd 启动，凭据/状态下落目录随 cwd 变化的风险应当显式消除：两个参数都传绝对路径。

### P3 — 桌面端集成（可选）

若目标是「驱动 Antigravity 桌面应用」而不是 CLI：

- 打开工作区/文件：`antigravity://` 深链（语法需从 renderer 侧继续逆向，本文未确认）。
- 直接驱动 agent：LS 的 `StartCascade` + `SendUserCascadeMessage` + `StreamCascadeReactiveUpdates`，token 从 LS argv 的 `--csrf_token` 取（同用户可读），头为 `x-codeium-csrf-token`。
- UI 自动化：`--remote-debugging-port=<固定端口>` → CDP，比截图/坐标点击稳定。

---

## 8. 风险与未确认项

| 项 | 说明 |
| :-- | :-- |
| 版本漂移 | `agy` 1.5.9 与 app 2.32.1 独立升级；ACP 的 `protocolVersion` 固定回 1，没有协商，未来能力变化只能靠字段探测 |
| `logout` | ACP 的破坏性方法，调用会真的注销当前账户（本文取证时发生过一次） |
| ACP 取消 | `session/cancel` 是通知，没有 ack；取消是否保证终止正在进行的一轮**未验证** |
| ACP 工具事件 | 未观测到 `tool_call` / `tool_call_update` 通知；ACP 路径下的工具进度可能只能从 `agent_message_chunk` 推断 |
| 错误伪装成回答 | 配额耗尽时错误文本以 `agent_message_chunk` 下发，`stopReason` 仍是 `end_turn`；必须同时看 `usage_update`/上层错误，不能只看文本 |
| `timeoutSeconds` | TodeX 写在 `mcp_config.json` 里的非标准键，`agy` 是否识别**未验证** |
| `init.permission_mode` | 恒为 `request-review`，不可用于判断模式 |
| print 模式退出码 | 出错时的真实退出码**未验证**（本次被管道掩盖） |
| 深链语法 | `antigravity://` 的路径与参数在 renderer 里解析，未确认 |
| 端口映射 | `language_server` 的多个回环端口与用途的对应关系未逐个确认 |
| 枚举值 | 377 个方法的请求/响应消息已展开到字段级，但 enum 取值未展开 |

---

## 附录 A：`LanguageServerService` 完整方法表（377）

由 `agy` 内嵌的 `FileDescriptorProto` 解码得到（proto：`third_party/jetski/language_server_pb/language_server.proto`，package `exa.language_server_pb`，描述符在文件偏移 `0x436c4d9`，长度 178808 字节）。所有方法都是 `POST /exa.language_server_pb.LanguageServerService/<Method>`。

| Method | Request | Response | Kind |
| :-- | :-- | :-- | :-- |
| `ProvideCompletionFeedback` | `ProvideCompletionFeedbackRequest` | `ProvideCompletionFeedbackResponse` | unary |
| `Heartbeat` | `HeartbeatRequest` | `HeartbeatResponse` | unary |
| `GetRemoteControlInfo` | `GetRemoteControlInfoRequest` | `GetRemoteControlInfoResponse` | unary |
| `GetStatus` | `GetStatusRequest` | `GetStatusResponse` | unary |
| `GetCommandModelConfigs` | `GetCommandModelConfigsRequest` | `GetCommandModelConfigsResponse` | unary |
| `GetCascadeModelConfigs` | `GetCascadeModelConfigsRequest` | `GetCascadeModelConfigsResponse` | unary |
| `GetStandaloneDir` | `GetStandaloneDirRequest` | `GetStandaloneDirResponse` | unary |
| `RecordEvent` | `RecordEventRequest` | `RecordEventResponse` | unary |
| `RecordSidecarEvent` | `RecordSidecarEventRequest` | `RecordSidecarEventResponse` | unary |
| `GetSidecars` | `GetSidecarsRequest` | `GetSidecarsResponse` | unary |
| `SubscribeToSidecars` | `SubscribeToSidecarsRequest` | `SubscribeToSidecarsResponse` | server-stream |
| `GetSidecarEvents` | `GetSidecarEventsRequest` | `GetSidecarEventsResponse` | unary |
| `GetSidecarLogs` | `GetSidecarLogsRequest` | `GetSidecarLogsResponse` | server-stream |
| `ListSidecarLogFiles` | `ListSidecarLogFilesRequest` | `ListSidecarLogFilesResponse` | unary |
| `ManageSidecar` | `ManageSidecarRequest` | `ManageSidecarResponse` | unary |
| `ResolveSidecarConfig` | `ResolveSidecarConfigRequest` | `ResolveSidecarConfigResponse` | unary |
| `ListTriggerOptions` | `ListTriggerOptionsRequest` | `ListTriggerOptionsResponse` | unary |
| `ListTriggers` | `ListTriggersRequest` | `ListTriggersResponse` | unary |
| `CreateTrigger` | `CreateTriggerRequest` | `CreateTriggerResponse` | unary |
| `UpdateTrigger` | `UpdateTriggerRequest` | `UpdateTriggerResponse` | unary |
| `DeleteTrigger` | `DeleteTriggerRequest` | `DeleteTriggerResponse` | unary |
| `RunTrigger` | `RunTriggerRequest` | `RunTriggerResponse` | unary |
| `ListEnvironments` | `ListEnvironmentsRequest` | `ListEnvironmentsResponse` | unary |
| `DeleteAllUserData` | `DeleteAllUserDataRequest` | `DeleteAllUserDataResponse` | unary |
| `GetUserDataDeletionStatus` | `GetUserDataDeletionStatusRequest` | `GetUserDataDeletionStatusResponse` | unary |
| `RegisterGdmUser` | `RegisterGdmUserRequest` | `RegisterGdmUserResponse` | unary |
| `MigrateApiKey` | `MigrateApiKeyRequest` | `MigrateApiKeyResponse` | unary |
| `WellSupportedLanguages` | `WellSupportedLanguagesRequest` | `WellSupportedLanguagesResponse` | unary |
| `RecordSearchDocOpen` | `RecordSearchDocOpenRequest` | `RecordSearchDocOpenResponse` | unary |
| `RecordSearchResultsView` | `RecordSearchResultsViewRequest` | `RecordSearchResultsViewResponse` | unary |
| `HandleStreamingCommand` | `HandleStreamingCommandRequest` | `HandleStreamingCommandResponse` | server-stream |
| `GetMcpServerTemplates` | `GetMcpServerTemplatesRequest` | `GetMcpServerTemplatesResponse` | unary |
| `AddTrackedWorkspace` | `AddTrackedWorkspaceRequest` | `AddTrackedWorkspaceResponse` | unary |
| `RemoveTrackedWorkspace` | `RemoveTrackedWorkspaceRequest` | `RemoveTrackedWorkspaceResponse` | unary |
| `SmartFocusConversation` | `SmartFocusConversationRequest` | `SmartFocusConversationResponse` | unary |
| `StatUri` | `StatUriRequest` | `StatUriResponse` | unary |
| `ReadFile` | `ReadFileRequest` | `ReadFileResponse` | unary |
| `CheckDevToolsActivePort` | `CheckDevToolsActivePortRequest` | `CheckDevToolsActivePortResponse` | unary |
| `WriteFile` | `WriteFileRequest` | `WriteFileResponse` | unary |
| `CreateDebugBundle` | `CreateDebugBundleRequest` | `CreateDebugBundleResponse` | unary |
| `UploadToDrive` | `UploadToDriveRequest` | `UploadToDriveResponse` | unary |
| `ReadDir` | `ReadDirRequest` | `ReadDirResponse` | unary |
| `DeleteFileOrDirectory` | `DeleteFileOrDirectoryRequest` | `DeleteFileOrDirectoryResponse` | unary |
| `CreateDirectory` | `CreateDirectoryRequest` | `CreateDirectoryResponse` | unary |
| `WatchDirectory` | `WatchDirectoryRequest` | `WatchDirectoryResponse` | server-stream |
| `GetKnowledgeItems` | `GetKnowledgeItemsRequest` | `GetKnowledgeItemsResponse` | unary |
| `SetBrowserOpenConversation` | `SetBrowserOpenConversationRequest` | `SetBrowserOpenConversationResponse` | unary |
| `GetBrowserOpenConversation` | `GetBrowserOpenConversationRequest` | `GetBrowserOpenConversationResponse` | unary |
| `RefreshContextForIdeAction` | `RefreshContextForIdeActionRequest` | `RefreshContextForIdeActionResponse` | unary |
| `GetMatchingContextScopeItems` | `GetMatchingContextScopeItemsRequest` | `GetMatchingContextScopeItemsResponse` | unary |
| `RecordChatFeedback` | `RecordChatFeedbackRequest` | `RecordChatFeedbackResponse` | unary |
| `RecordChatPanelSession` | `RecordChatPanelSessionRequest` | `RecordChatPanelSessionResponse` | unary |
| `ShouldEnableUnleash` | `ShouldEnableUnleashRequest` | `ShouldEnableUnleashResponse` | unary |
| `GetWorkspaceEditState` | `GetWorkspaceEditStateRequest` | `GetWorkspaceEditStateResponse` | unary |
| `GetRepoInfos` | `GetRepoInfosRequest` | `GetRepoInfosResponse` | unary |
| `ListGobRepos` | `ListGobReposRequest` | `ListGobReposResponse` | unary |
| `GetWorkspaceInfos` | `GetWorkspaceInfosRequest` | `GetWorkspaceInfosResponse` | unary |
| `GetLocalUserInfo` | `GetLocalUserInfoRequest` | `GetLocalUserInfoResponse` | unary |
| `ResolveWorkspaceUrlPreview` | `ResolveWorkspaceUrlPreviewRequest` | `ResolveWorkspaceUrlPreviewResponse` | unary |
| `SearchDriveFiles` | `SearchDriveFilesRequest` | `SearchDriveFilesResponse` | unary |
| `ListContextProviders` | `ListContextProvidersRequest` | `ListContextProvidersResponse` | unary |
| `SearchContext` | `SearchContextRequest` | `SearchContextResponse` | unary |
| `ResolveContextUri` | `ResolveContextUriRequest` | `ResolveContextUriResponse` | unary |
| `GetChangelistStatus` | `GetChangelistStatusRequest` | `GetChangelistStatusResponse` | unary |
| `GetGerritChangeStatus` | `GetGerritChangeStatusRequest` | `GetGerritChangeStatusResponse` | unary |
| `GetGoogleChatLinkInfo` | `GetGoogleChatLinkInfoRequest` | `GetGoogleChatLinkInfoResponse` | unary |
| `GetWorkspaceChangelists` | `GetWorkspaceChangelistsRequest` | `GetWorkspaceChangelistsResponse` | unary |
| `GetGitHubPullRequests` | `GetGitHubPullRequestsRequest` | `GetGitHubPullRequestsResponse` | unary |
| `CreateWorktree` | `CreateWorktreeRequest` | `CreateWorktreeResponse` | unary |
| `DeleteWorktree` | `DeleteWorktreeRequest` | `DeleteWorktreeResponse` | unary |
| `CheckoutWorktree` | `CheckoutWorktreeRequest` | `CheckoutWorktreeResponse` | unary |
| `GetWorktreeDiff` | `GetWorktreeDiffRequest` | `GetWorktreeDiffResponse` | unary |
| `GetBattleWorktreeDiff` | `GetBattleWorktreeDiffRequest` | `GetBattleWorktreeDiffResponse` | unary |
| `CreateCitcWorkspace` | `CreateCitcWorkspaceRequest` | `CreateCitcWorkspaceResponse` | unary |
| `SetWorkingDirectories` | `SetWorkingDirectoriesRequest` | `SetWorkingDirectoriesResponse` | unary |
| `GetWorkingDirectories` | `GetWorkingDirectoriesRequest` | `GetWorkingDirectoriesResponse` | unary |
| `GetJJWorktrees` | `GetJJWorktreesRequest` | `GetJJWorktreesResponse` | unary |
| `GetRevisionArtifact` | `GetRevisionArtifactRequest` | `GetRevisionArtifactResponse` | unary |
| `GetVersionControlState` | `GetVersionControlStateRequest` | `GetVersionControlStateResponse` | unary |
| `WatchVersionControlState` | `WatchVersionControlStateRequest` | `WatchVersionControlStateResponse` | server-stream |
| `GetVersionControlFileContent` | `GetVersionControlFileContentRequest` | `GetVersionControlFileContentResponse` | unary |
| `GetCommitDetails` | `GetCommitDetailsRequest` | `GetCommitDetailsResponse` | unary |
| `CheckoutCommit` | `CheckoutCommitRequest` | `CheckoutCommitResponse` | unary |
| `DiscardFileChanges` | `DiscardFileChangesRequest` | `DiscardFileChangesResponse` | unary |
| `FigSync` | `FigSyncRequest` | `FigSyncResponse` | unary |
| `FigCommit` | `FigCommitRequest` | `FigCommitResponse` | unary |
| `FigAmend` | `FigAmendRequest` | `FigAmendResponse` | unary |
| `FigUpload` | `FigUploadRequest` | `FigUploadResponse` | unary |
| `JjSync` | `JjSyncRequest` | `JjSyncResponse` | unary |
| `JjCommit` | `JjCommitRequest` | `JjCommitResponse` | unary |
| `JjSquash` | `JjSquashRequest` | `JjSquashResponse` | unary |
| `JjUpload` | `JjUploadRequest` | `JjUploadResponse` | unary |
| `JjAbandon` | `JjAbandonRequest` | `JjAbandonResponse` | unary |
| `CogSync` | `CogSyncRequest` | `CogSyncResponse` | unary |
| `CogCommit` | `CogCommitRequest` | `CogCommitResponse` | unary |
| `CogUpload` | `CogUploadRequest` | `CogUploadResponse` | unary |
| `CogSquash` | `CogSquashRequest` | `CogSquashResponse` | unary |
| `RepoSync` | `RepoSyncRequest` | `RepoSyncResponse` | unary |
| `RepoCommit` | `RepoCommitRequest` | `RepoCommitResponse` | unary |
| `RepoAmend` | `RepoAmendRequest` | `RepoAmendResponse` | unary |
| `RepoUpload` | `RepoUploadRequest` | `RepoUploadResponse` | unary |
| `GitStage` | `GitStageRequest` | `GitStageResponse` | unary |
| `GitUnstage` | `GitUnstageRequest` | `GitUnstageResponse` | unary |
| `GitCommit` | `GitCommitRequest` | `GitCommitResponse` | unary |
| `GitDiscard` | `GitDiscardRequest` | `GitDiscardResponse` | unary |
| `GitPush` | `GitPushRequest` | `GitPushResponse` | unary |
| `GenerateCommitMessage` | `GenerateCommitMessageRequest` | `GenerateCommitMessageResponse` | unary |
| `RecordCommitMessageSave` | `RecordCommitMessageSaveRequest` | `RecordCommitMessageSaveResponse` | unary |
| `UpdatePRForWorktree` | `UpdatePRForWorktreeRequest` | `UpdatePRForWorktreeResponse` | unary |
| `SendActionToChatPanel` | `SendActionToChatPanelRequest` | `SendActionToChatPanelResponse` | unary |
| `GetUserSettings` | `GetUserSettingsRequest` | `GetUserSettingsResponse` | unary |
| `SetUserSettings` | `SetUserSettingsRequest` | `SetUserSettingsResponse` | unary |
| `FetchUserInfo` | `FetchUserInfoRequest` | `FetchUserInfoResponse` | unary |
| `SetUserInfo` | `SetUserInfoRequest` | `SetUserInfoResponse` | unary |
| `GetDebugDiagnostics` | `GetDebugDiagnosticsRequest` | `GetDebugDiagnosticsResponse` | unary |
| `DumpFlightRecorder` | `DumpFlightRecorderRequest` | `DumpFlightRecorderResponse` | unary |
| `DumpPprof` | `DumpPprofRequest` | `DumpPprofResponse` | unary |
| `GetUserAnalyticsSummary` | `GetUserAnalyticsSummaryRequest` | `GetUserAnalyticsSummaryResponse` | unary |
| `GetUserStatus` | `GetUserStatusRequest` | `GetUserStatusResponse` | unary |
| `GetProfileData` | `GetProfileDataRequest` | `GetProfileDataResponse` | unary |
| `GetChangelog` | `GetChangelogRequest` | `GetChangelogResponse` | unary |
| `SetupUniversitySandbox` | `SetupUniversitySandboxRequest` | `SetupUniversitySandboxResponse` | unary |
| `Exit` | `ExitRequest` | `ExitResponse` | unary |
| `Restart` | `RestartRequest` | `RestartResponse` | unary |
| `ResetOnboarding` | `ResetOnboardingRequest` | `ResetOnboardingResponse` | unary |
| `SkipOnboarding` | `SkipOnboardingRequest` | `SkipOnboardingResponse` | unary |
| `GetTermsOfService` | `GetTermsOfServiceRequest` | `GetTermsOfServiceResponse` | unary |
| `AcceptTermsOfService` | `AcceptTermsOfServiceRequest` | `AcceptTermsOfServiceResponse` | unary |
| `ListLicenses` | `ListLicensesRequest` | `ListLicensesResponse` | unary |
| `SelectLicense` | `SelectLicenseRequest` | `SelectLicenseResponse` | unary |
| `SelfAssignLicense` | `SelfAssignLicenseRequest` | `SelfAssignLicenseResponse` | unary |
| `SearchGcpProjects` | `SearchGcpProjectsRequest` | `SearchGcpProjectsResponse` | unary |
| `GetUserTrajectoryDebug` | `GetUserTrajectoryDebugRequest` | `GetUserTrajectoryDebugResponse` | unary |
| `GetUserTrajectoryDescriptions` | `GetUserTrajectoryDescriptionsRequest` | `GetUserTrajectoryDescriptionsResponse` | unary |
| `StreamUserTrajectoryReactiveUpdates` | `StreamReactiveUpdatesRequest` | `StreamReactiveUpdatesResponse` | server-stream |
| `GetCascadeMemories` | `GetCascadeMemoriesRequest` | `GetCascadeMemoriesResponse` | unary |
| `DeleteCascadeMemory` | `DeleteCascadeMemoryRequest` | `DeleteCascadeMemoryResponse` | unary |
| `UpdateCascadeMemory` | `UpdateCascadeMemoryRequest` | `UpdateCascadeMemoryResponse` | unary |
| `GetUserMemories` | `GetUserMemoriesRequest` | `GetUserMemoriesResponse` | unary |
| `UpdateConversationAnnotations` | `UpdateConversationAnnotationsRequest` | `UpdateConversationAnnotationsResponse` | unary |
| `StartCascade` | `StartCascadeRequest` | `StartCascadeResponse` | unary |
| `LoadSharedTrajectory` | `LoadSharedTrajectoryRequest` | `LoadSharedTrajectoryResponse` | unary |
| `GetSlashCommands` | `GetSlashCommandsRequest` | `GetSlashCommandsResponse` | unary |
| `StartBattleMode` | `StartBattleModeRequest` | `StartBattleModeResponse` | unary |
| `GetContribVariants` | `GetContribVariantsRequest` | `GetContribVariantsResponse` | unary |
| `EndBattleMode` | `EndBattleModeRequest` | `EndBattleModeResponse` | unary |
| `EliminateBattleModeArm` | `EliminateBattleModeArmRequest` | `EliminateBattleModeArmResponse` | unary |
| `SetOrVerifyStaticConfig` | `SetOrVerifyStaticConfigRequest` | `SetOrVerifyStaticConfigResponse` | unary |
| `ForkConversation` | `ForkConversationRequest` | `ForkConversationResponse` | unary |
| `CancelCascadeInvocation` | `CancelCascadeInvocationRequest` | `CancelCascadeInvocationResponse` | unary |
| `ForceStopCascadeTree` | `ForceStopCascadeTreeRequest` | `ForceStopCascadeTreeResponse` | unary |
| `CancelCascadeSteps` | `CancelCascadeStepsRequest` | `CancelCascadeStepsResponse` | unary |
| `SendStepsToBackground` | `SendStepsToBackgroundRequest` | `SendStepsToBackgroundResponse` | unary |
| `SkipBrowserSubagent` | `SkipBrowserSubagentRequest` | `SkipBrowserSubagentResponse` | unary |
| `GetCascadeModelConfigData` | `GetCascadeModelConfigDataRequest` | `CascadeModelConfigData` | unary |
| `SendUserCascadeMessage` | `SendUserCascadeMessageRequest` | `SendUserCascadeMessageResponse` | unary |
| `DetectBattleModeAutoTrigger` | `DetectBattleModeAutoTriggerRequest` | `DetectBattleModeAutoTriggerResponse` | unary |
| `SignalExecutableIdle` | `SignalExecutableIdleRequest` | `SignalExecutableIdleResponse` | unary |
| `WaitForConversationFullyIdle` | `WaitForConversationFullyIdleRequest` | `WaitForConversationFullyIdleResponse` | unary |
| `SendAllQueuedMessages` | `SendAllQueuedMessagesRequest` | `SendAllQueuedMessagesResponse` | unary |
| `DeleteQueuedUserInputStep` | `DeleteQueuedUserInputStepRequest` | `DeleteQueuedUserInputStepResponse` | unary |
| `RevertToCascadeStep` | `RevertToCascadeStepRequest` | `RevertToCascadeStepResponse` | unary |
| `GetRevertPreview` | `GetRevertPreviewRequest` | `GetRevertPreviewResponse` | unary |
| `RecordUserStepSnapshot` | `RecordUserStepSnapshotRequest` | `RecordUserStepSnapshotResponse` | unary |
| `GetAllCascadeTrajectories` | `GetAllCascadeTrajectoriesRequest` | `GetAllCascadeTrajectoriesResponse` | unary |
| `HandleCascadeUserInteraction` | `HandleCascadeUserInteractionRequest` | `HandleCascadeUserInteractionResponse` | unary |
| `AcknowledgeCascadeCodeEdit` | `AcknowledgeCascadeCodeEditRequest` | `AcknowledgeCascadeCodeEditResponse` | unary |
| `AcknowledgeCodeActionStep` | `AcknowledgeCodeActionStepRequest` | `AcknowledgeCodeActionStepResponse` | unary |
| `GetCodeValidationStates` | `GetCodeValidationStatesRequest` | `GetCodeValidationStatesResponse` | unary |
| `DeleteCascadeTrajectory` | `DeleteCascadeTrajectoryRequest` | `DeleteCascadeTrajectoryResponse` | unary |
| `GetConversationMetadata` | `GetConversationMetadataRequest` | `GetConversationMetadataResponse` | unary |
| `WarmUpAgentProcess` | `WarmUpAgentProcessRequest` | `WarmUpAgentProcessResponse` | unary |
| `WarmUpEnvironment` | `WarmUpEnvironmentRequest` | `WarmUpEnvironmentResponse` | unary |
| `FetchSandboxPort` | `FetchSandboxPortRequest` | `FetchSandboxPortResponse` | unary |
| `GetVoiceCallDebug` | `GetVoiceCallDebugRequest` | `GetVoiceCallDebugResponse` | unary |
| `GetTurnDiff` | `GetTurnDiffRequest` | `GetTurnDiffResponse` | unary |
| `GetTrajectoryFileDiffs` | `GetTrajectoryFileDiffsRequest` | `GetTrajectoryFileDiffsResponse` | unary |
| `GetCodeActionDiff` | `GetCodeActionDiffRequest` | `GetCodeActionDiffResponse` | unary |
| `InitializeCascadePanelState` | `InitializeCascadePanelStateRequest` | `InitializeCascadePanelStateResponse` | unary |
| `StreamCascadePanelReactiveUpdates` | `StreamReactiveUpdatesRequest` | `StreamReactiveUpdatesResponse` | server-stream |
| `StreamCascadeReactiveUpdates` | `StreamReactiveUpdatesRequest` | `StreamReactiveUpdatesResponse` | server-stream |
| `StreamCascadeSummariesReactiveUpdates` | `StreamReactiveUpdatesRequest` | `StreamReactiveUpdatesResponse` | server-stream |
| `StreamAgentStateUpdates` | `StreamAgentStateUpdatesRequest` | `StreamAgentStateUpdatesResponse` | server-stream |
| `RequestAgentStatePageUpdate` | `AgentStatePageUpdateRequest` | `AgentStatePageUpdateResponse` | unary |
| `ForceBackgroundResearchRefresh` | `ForceBackgroundResearchRefreshRequest` | `ForceBackgroundResearchRefreshResponse` | unary |
| `ResolveOutstandingSteps` | `ResolveOutstandingStepsRequest` | `ResolveOutstandingStepsResponse` | unary |
| `RefreshMcpServers` | `RefreshMcpServersRequest` | `RefreshMcpServersResponse` | unary |
| `ToggleMcpServer` | `ToggleMcpServerRequest` | `ToggleMcpServerResponse` | unary |
| `GetMcpServerStates` | `GetMcpServerStatesRequest` | `GetMcpServerStatesResponse` | unary |
| `SubscribeToMcpServerStates` | `SubscribeToMcpServerStatesRequest` | `SubscribeToMcpServerStatesResponse` | server-stream |
| `CompleteMcpOAuth` | `CompleteMcpOAuthRequest` | `CompleteMcpOAuthResponse` | unary |
| `DisconnectMcpOAuth` | `DisconnectMcpOAuthRequest` | `DisconnectMcpOAuthResponse` | unary |
| `StartMcpOAuthSignIn` | `StartMcpOAuthSignInRequest` | `StartMcpOAuthSignInResponse` | unary |
| `StreamTerminalShellCommand` | `TerminalShellCommandStreamChunk` | `StreamTerminalShellCommandResponse` | client-stream |
| `CreateTerminal` | `CreateTerminalRequest` | `CreateTerminalResponse` | unary |
| `StreamTerminalOutput` | `StreamTerminalOutputRequest` | `StreamTerminalOutputResponse` | server-stream |
| `SendTerminalInput` | `SendTerminalInputRequest` | `SendTerminalInputResponse` | unary |
| `CloseTerminal` | `CloseTerminalRequest` | `CloseTerminalResponse` | unary |
| `ListTerminals` | `ListTerminalsRequest` | `ListTerminalsResponse` | unary |
| `ListBackgroundTasks` | `ListBackgroundTasksRequest` | `ListBackgroundTasksResponse` | unary |
| `GetModelResponse` | `GetModelResponseRequest` | `GetModelResponseResponse` | unary |
| `SaveMediaAsArtifact` | `SaveMediaAsArtifactRequest` | `SaveMediaAsArtifactResponse` | unary |
| `DeleteMediaArtifact` | `DeleteMediaArtifactRequest` | `DeleteMediaArtifactResponse` | unary |
| `GetWebDocsOptions` | `GetWebDocsOptionsRequest` | `GetWebDocsOptionsResponse` | unary |
| `UpdateDevExperiments` | `UpdateDevExperimentsRequest` | `UpdateDevExperimentsResponse` | unary |
| `SetBaseExperiments` | `SetBaseExperimentsRequest` | `SetBaseExperimentsResponse` | unary |
| `GetUnleashData` | `GetUnleashDataRequest` | `GetUnleashDataResponse` | unary |
| `GetMendelFlags` | `GetMendelFlagsRequest` | `GetMendelFlagsResponse` | unary |
| `SetMendelFlagOverrides` | `SetMendelFlagOverridesRequest` | `SetMendelFlagOverridesResponse` | unary |
| `GetModelStatuses` | `GetModelStatusesRequest` | `GetModelStatusesResponse` | unary |
| `GetAllWorkflows` | `GetAllWorkflowsRequest` | `GetAllWorkflowsResponse` | unary |
| `GetAllCustomAgentConfigs` | `GetAllCustomAgentConfigsRequest` | `GetAllCustomAgentConfigsResponse` | unary |
| `CopyBuiltinWorkflowToWorkspace` | `CopyBuiltinWorkflowToWorkspaceRequest` | `CopyBuiltinWorkflowToWorkspaceResponse` | unary |
| `GetAllRules` | `GetAllRulesRequest` | `GetAllRulesResponse` | unary |
| `GetAllSkills` | `GetAllSkillsRequest` | `GetAllSkillsResponse` | unary |
| `GetCustomizationStates` | `GetCustomizationStatesRequest` | `GetCustomizationStatesResponse` | unary |
| `GetSkillMarketplaceLink` | `GetSkillMarketplaceLinkRequest` | `GetSkillMarketplaceLinkResponse` | unary |
| `GenerateSkillInstallationCL` | `GenerateSkillInstallationCLRequest` | `GenerateSkillInstallationCLResponse` | unary |
| `SearchMarketplaceCustomizations` | `SearchMarketplaceCustomizationsRequest` | `SearchMarketplaceCustomizationsResponse` | unary |
| `ScanSkillsConfigFile` | `ScanSkillsConfigFileRequest` | `ScanSkillsConfigFileResponse` | unary |
| `ListMcpResources` | `ListMcpResourcesRequest` | `ListMcpResourcesResponse` | unary |
| `ListMcpPrompts` | `ListMcpPromptsRequest` | `ListMcpPromptsResponse` | unary |
| `GetMcpPrompt` | `GetMcpPromptRequest` | `GetMcpPromptResponse` | unary |
| `GetMcpAppResource` | `GetMcpAppResourceRequest` | `GetMcpAppResourceResponse` | unary |
| `LaunchMcpApp` | `LaunchMcpAppRequest` | `LaunchMcpAppResponse` | unary |
| `CallMcpAppTool` | `CallMcpAppToolRequest` | `CallMcpAppToolResponse` | unary |
| `UpdateEnterpriseExperimentsFromUrl` | `UpdateEnterpriseExperimentsFromUrlRequest` | `UpdateEnterpriseExperimentsFromUrlResponse` | unary |
| `ImportFromCursor` | `ImportFromCursorRequest` | `ImportFromCursorResponse` | unary |
| `CreateCustomizationFile` | `CreateCustomizationFileRequest` | `CreateCustomizationFileResponse` | unary |
| `ListCustomizationPathsByFile` | `ListCustomizationPathsByFileRequest` | `ListCustomizationPathsByFileResponse` | unary |
| `UpdateCustomizationPathsFile` | `UpdateCustomizationPathsFileRequest` | `UpdateCustomizationPathsFileResponse` | unary |
| `GetTeamOrganizationalControls` | `GetTeamOrganizationalControlsRequest` | `GetTeamOrganizationalControlsResponse` | unary |
| `RecordUserGrep` | `RecordUserGrepRequest` | `RecordUserGrepResponse` | unary |
| `CreateTrajectoryShare` | `CreateTrajectoryShareRequest` | `CreateTrajectoryShareResponse` | unary |
| `GetCascadeTrajectory` | `GetCascadeTrajectoryRequest` | `GetCascadeTrajectoryResponse` | unary |
| `GetArtifactSnapshots` | `GetArtifactSnapshotsRequest` | `GetArtifactSnapshotsResponse` | unary |
| `GetUserTrajectory` | `GetUserTrajectoryRequest` | `GetUserTrajectoryResponse` | unary |
| `GetCascadeTrajectorySteps` | `GetCascadeTrajectoryStepsRequest` | `GetCascadeTrajectoryStepsResponse` | unary |
| `GetTrajectoryTurns` | `GetTrajectoryTurnsRequest` | `GetTrajectoryTurnsResponse` | unary |
| `GetChapterTitles` | `GetChapterTitlesRequest` | `GetChapterTitlesResponse` | unary |
| `GetCascadeTrajectoryGeneratorMetadata` | `GetCascadeTrajectoryGeneratorMetadataRequest` | `GetCascadeTrajectoryGeneratorMetadataResponse` | unary |
| `GetCascadeTrajectoryExecutorMetadatas` | `GetCascadeTrajectoryExecutorMetadatasRequest` | `GetCascadeTrajectoryExecutorMetadatasResponse` | unary |
| `GetPatchAndCodeChange` | `GetPatchAndCodeChangeRequest` | `GetPatchAndCodeChangeResponse` | unary |
| `ConvertTrajectoryToMarkdown` | `ConvertTrajectoryToMarkdownRequest` | `ConvertTrajectoryToMarkdownResponse` | unary |
| `LoadTrajectory` | `LoadTrajectoryRequest` | `LoadTrajectoryResponse` | unary |
| `ImportProjectFromUrl` | `ImportProjectFromUrlRequest` | `ImportProjectFromUrlResponse` | unary |
| `GetAvailableCascadePlugins` | `GetAvailableCascadePluginsRequest` | `GetAvailableCascadePluginsResponse` | unary |
| `InstallCascadePlugin` | `InstallCascadePluginRequest` | `InstallCascadePluginResponse` | unary |
| `GetCascadePluginById` | `GetCascadePluginByIdRequest` | `GetCascadePluginByIdResponse` | unary |
| `GetAllPlugins` | `GetAllPluginsRequest` | `GetAllPluginsResponse` | unary |
| `SubscribeToPlugins` | `SubscribeToPluginsRequest` | `SubscribeToPluginsResponse` | server-stream |
| `GetPlugin` | `GetPluginRequest` | `GetPluginResponse` | unary |
| `ResolveCommandPlugin` | `ResolveCommandPluginRequest` | `ResolveCommandPluginResponse` | unary |
| `ListPluginAuthProviders` | `ListPluginAuthProvidersRequest` | `ListPluginAuthProvidersResponse` | unary |
| `SignInPluginAuthProvider` | `SignInPluginAuthProviderRequest` | `SignInPluginAuthProviderResponse` | unary |
| `SignOutPluginAuthProvider` | `SignOutPluginAuthProviderRequest` | `SignOutPluginAuthProviderResponse` | unary |
| `StartPluginAuthSignIn` | `StartPluginAuthSignInRequest` | `StartPluginAuthSignInResponse` | unary |
| `SetDefaultPluginAuthAccount` | `SetDefaultPluginAuthAccountRequest` | `SetDefaultPluginAuthAccountResponse` | unary |
| `SetPluginAuthAccountLabel` | `SetPluginAuthAccountLabelRequest` | `SetPluginAuthAccountLabelResponse` | unary |
| `GetBuildWithGooglePlugins` | `GetBuildWithGooglePluginsRequest` | `GetBuildWithGooglePluginsResponse` | unary |
| `DownloadBuildWithGooglePlugin` | `DownloadBuildWithGooglePluginRequest` | `DownloadBuildWithGooglePluginResponse` | unary |
| `DeletePlugin` | `DeletePluginRequest` | `DeletePluginResponse` | unary |
| `DeleteSkill` | `DeleteSkillRequest` | `DeleteSkillResponse` | unary |
| `SearchMarketplace` | `SearchMarketplaceRequest` | `SearchMarketplaceResponse` | unary |
| `GetMarketplaceCustomization` | `GetMarketplaceCustomizationRequest` | `GetMarketplaceCustomizationResponse` | unary |
| `GetMarketplaceBundles` | `GetMarketplaceBundlesRequest` | `GetMarketplaceBundlesResponse` | unary |
| `GetMarketplaceFeatured` | `GetMarketplaceFeaturedRequest` | `GetMarketplaceFeaturedResponse` | unary |
| `GetOnboardingPersonas` | `GetOnboardingPersonasRequest` | `GetOnboardingPersonasResponse` | unary |
| `InstallCustomization` | `InstallCustomizationRequest` | `InstallCustomizationResponse` | unary |
| `IncludeBundleMember` | `IncludeBundleMemberRequest` | `IncludeBundleMemberResponse` | unary |
| `UpdateCustomization` | `UpdateCustomizationRequest` | `UpdateCustomizationResponse` | unary |
| `GetAgentScripts` | `GetAgentScriptsRequest` | `GetAgentScriptsResponse` | unary |
| `ListProfiles` | `ListProfilesRequest` | `ListProfilesResponse` | unary |
| `SaveAgentScriptCommandSpec` | `SaveAgentScriptCommandSpecRequest` | `SaveAgentScriptCommandSpecResponse` | unary |
| `RecordLints` | `RecordLintsRequest` | `RecordLintsResponse` | unary |
| `ReplayGroundTruthTrajectory` | `ReplayGroundTruthTrajectoryRequest` | `ReplayGroundTruthTrajectoryResponse` | unary |
| `LoadReplayConversation` | `LoadReplayConversationRequest` | `LoadReplayConversationResponse` | unary |
| `RecordInteractiveCascadeFeedback` | `RecordInteractiveCascadeFeedbackRequest` | `RecordInteractiveCascadeFeedbackResponse` | unary |
| `GetCascadeNuxes` | `GetCascadeNuxesRequest` | `GetCascadeNuxesResponse` | unary |
| `RegisterInteraction` | `RegisterInteractionRequest` | `RegisterInteractionResponse` | unary |
| `GetTranscription` | `GetTranscriptionRequest` | `GetTranscriptionResponse` | unary |
| `StreamAudioTranscription` | `StartAudioTranscriptionRequest` | `StreamAudioTranscriptionResponse` | server-stream |
| `SendAudioChunk` | `SendAudioChunkRequest` | `SendAudioChunkResponse` | unary |
| `EndAudioSession` | `EndAudioSessionRequest` | `EndAudioSessionResponse` | unary |
| `StartNarration` | `StartNarrationRequest` | `StreamNarrationResponse` | server-stream |
| `SendNarrationTurn` | `SendNarrationTurnRequest` | `SendNarrationTurnResponse` | unary |
| `EndNarration` | `EndNarrationRequest` | `EndNarrationResponse` | unary |
| `GetInputCompletion` | `GetInputCompletionRequest` | `GetInputCompletionResponse` | unary |
| `SendInputCompletionFeedback` | `SendInputCompletionFeedbackRequest` | `SendInputCompletionFeedbackResponse` | unary |
| `GetStaticExperimentStatus` | `GetStaticExperimentStatusRequest` | `GetStaticExperimentStatusResponse` | unary |
| `RecordAnalyticsEvent` | `RecordAnalyticsEventRequest` | `RecordAnalyticsEventResponse` | unary |
| `RecordError` | `RecordErrorRequest` | `RecordErrorResponse` | unary |
| `RecordObservabilityData` | `RecordObservabilityDataRequest` | `RecordObservabilityDataResponse` | unary |
| `ListPages` | `ListPagesRequest` | `ListPagesResponse` | unary |
| `BrowserValidateCascadeOrCancelOverlay` | `BrowserValidateCascadeOrCancelOverlayRequest` | `BrowserValidateCascadeOrCancelOverlayResponse` | unary |
| `OpenUrl` | `OpenUrlRequest` | `OpenUrlResponse` | unary |
| `FocusUserPage` | `FocusUserPageRequest` | `FocusUserPageResponse` | unary |
| `AddToBrowserWhitelist` | `AddToBrowserWhitelistRequest` | `AddToBrowserWhitelistResponse` | unary |
| `CaptureConsoleLogs` | `CaptureConsoleLogsRequest` | `CaptureConsoleLogsResponse` | unary |
| `StartScreenRecording` | `StartScreenRecordingRequest` | `StartScreenRecordingResponse` | unary |
| `SaveScreenRecording` | `SaveScreenRecordingRequest` | `SaveScreenRecordingResponse` | unary |
| `GetBrowserWhitelistFilePath` | `GetBrowserWhitelistFilePathRequest` | `GetBrowserWhitelistFilePathResponse` | unary |
| `HandleScreenRecording` | `HandleScreenRecordingRequest` | `HandleScreenRecordingResponse` | unary |
| `GetAllBrowserWhitelistedUrls` | `GetAllBrowserWhitelistedUrlsRequest` | `GetAllBrowserWhitelistedUrlsResponse` | unary |
| `CaptureScreenshot` | `CaptureScreenshotRequest` | `CaptureScreenshotResponse` | unary |
| `SmartOpenBrowser` | `SmartOpenBrowserRequest` | `SmartOpenBrowserResponse` | unary |
| `SimulateSegFault` | `SimulateSegFaultRequest` | `SimulateSegFaultResponse` | unary |
| `ReconnectExtensionServer` | `ReconnectExtensionServerRequest` | `ReconnectExtensionServerResponse` | unary |
| `SetCloudCodeURL` | `SetCloudCodeURLRequest` | `SetCloudCodeURLResponse` | unary |
| `GetTokenBase` | `GetTokenBaseRequest` | `GetTokenBaseResponse` | unary |
| `RunCommand` | `RunCommandRequest` | `RunCommandResponse` | unary |
| `ValidateTerminalSetupScript` | `ValidateTerminalSetupScriptRequest` | `ValidateTerminalSetupScriptResponse` | unary |
| `JetboxWriteState` | `JetboxWriteStateRequest` | `JetboxWriteStateResponse` | unary |
| `JetboxSubscribeToState` | `JetboxSubscribeToStateRequest` | `JetboxSubscribeToStateResponse` | server-stream |
| `JetboxReadAppState` | `JetboxReadAppStateRequest` | `JetboxReadAppStateResponse` | unary |
| `JetboxReadUserConfig` | `JetboxReadUserConfigRequest` | `JetboxReadUserConfigResponse` | unary |
| `JetboxWriteSummary` | `JetboxWriteSummaryRequest` | `JetboxWriteSummaryResponse` | unary |
| `JetboxDeleteSummary` | `JetboxDeleteSummaryRequest` | `JetboxDeleteSummaryResponse` | unary |
| `JetboxSubscribeToSummaries` | `JetboxSubscribeToSummariesRequest` | `JetboxSubscribeToSummariesResponse` | server-stream |
| `JetboxSubscribeToGcertState` | `JetboxSubscribeToGcertStateRequest` | `JetboxSubscribeToGcertStateResponse` | server-stream |
| `JetboxSubscribeToOAuthState` | `JetboxSubscribeToOAuthStateRequest` | `JetboxSubscribeToOAuthStateResponse` | server-stream |
| `SearchFiles` | `SearchFilesRequest` | `SearchFilesResponse` | unary |
| `SearchCode` | `SearchCodeRequest` | `SearchCodeResponse` | unary |
| `StreamSearchCode` | `SearchCodeRequest` | `StreamSearchCodeResponse` | server-stream |
| `SearchConversations` | `SearchConversationsRequest` | `SearchConversationsResponse` | unary |
| `GetAgentTeamMetadata` | `GetAgentTeamMetadataRequest` | `GetAgentTeamMetadataResponse` | unary |
| `GetCodeFrequencyForRepo` | `GetCodeFrequencyForRepoRequest` | `GetCodeFrequencyForRepoResponse` | unary |
| `SendAgentMessage` | `SendAgentMessageRequest` | `SendAgentMessageResponse` | unary |
| `DeleteAgentMessage` | `DeleteAgentMessageRequest` | `DeleteAgentMessageResponse` | unary |
| `GetLoadCodeAssist` | `GetLoadCodeAssistRequest` | `GetLoadCodeAssistResponse` | unary |
| `GetAvailableModels` | `GetAvailableModelsRequest` | `GetAvailableModelsResponse` | unary |
| `RetrieveUserQuotaSummary` | `RetrieveUserQuotaSummaryRequest` | `RetrieveUserQuotaSummaryResponse` | unary |
| `CreateProject` | `CreateProjectRequest` | `CreateProjectResponse` | unary |
| `CreateMagicProject` | `CreateMagicProjectRequest` | `CreateMagicProjectResponse` | unary |
| `GetPermissionSettings` | `GetPermissionSettingsRequest` | `GetPermissionSettingsResponse` | unary |
| `UpdatePermissionSettings` | `UpdatePermissionSettingsRequest` | `UpdatePermissionSettingsResponse` | unary |
| `UpdateProject` | `UpdateProjectRequest` | `UpdateProjectResponse` | unary |
| `DeleteProject` | `DeleteProjectRequest` | `DeleteProjectResponse` | unary |
| `GenerateEnvironmentName` | `GenerateEnvironmentNameRequest` | `GenerateEnvironmentNameResponse` | unary |
| `AddEnvironmentToProject` | `AddEnvironmentToProjectRequest` | `AddEnvironmentToProjectResponse` | unary |
| `GetProjectTrustStatus` | `GetProjectTrustStatusRequest` | `GetProjectTrustStatusResponse` | unary |
| `SetWorkspaceTrust` | `SetWorkspaceTrustRequest` | `SetWorkspaceTrustResponse` | unary |
| `ResolveFolder` | `ResolveFolderRequest` | `ResolveFolderResponse` | unary |
| `CloneGitHubRepo` | `CloneGitHubRepoRequest` | `CloneGitHubRepoResponse` | unary |
| `ProjectUpdatesStream` | `ProjectUpdatesStreamRequest` | `ProjectUpdatesStreamResponse` | server-stream |
| `ReadProject` | `ReadProjectRequest` | `ReadProjectResponse` | unary |
| `ReadProjects` | `ReadProjectsRequest` | `ReadProjectsResponse` | unary |
| `ListProjects` | `ListProjectsRequest` | `ListProjectsResponse` | unary |
| `ListResourceProviders` | `ListResourceProvidersRequest` | `ListResourceProvidersResponse` | unary |
| `ListAvailableResources` | `ListAvailableResourcesRequest` | `ListAvailableResourcesResponse` | unary |
| `ListRemotePlugins` | `ListRemotePluginsRequest` | `ListRemotePluginsResponse` | unary |
| `DisconnectRemotePlugin` | `DisconnectRemotePluginRequest` | `DisconnectRemotePluginResponse` | unary |
| `GetDefaultProjectDir` | `GetDefaultProjectDirRequest` | `GetDefaultProjectDirResponse` | unary |
| `GetAuthStatus` | `GetAuthStatusRequest` | `GetAuthStatusResponse` | unary |
| `LoginWithBrowser` | `LoginWithBrowserRequest` | `LoginWithBrowserResponse` | unary |
| `Login` | `LoginRequest` | `LoginResponse` | unary |
| `GetLoginSession` | `GetLoginSessionRequest` | `GetLoginSessionResponse` | unary |
| `CancelLogin` | `CancelLoginRequest` | `CancelLoginResponse` | unary |
| `SwitchLoginToAuthCode` | `SwitchLoginToAuthCodeRequest` | `SwitchLoginToAuthCodeResponse` | unary |
| `SubmitLoginAuthCode` | `SubmitLoginAuthCodeRequest` | `SubmitLoginAuthCodeResponse` | unary |
| `AuthLogout` | `AuthLogoutRequest` | `AuthLogoutResponse` | unary |
| `HasAuthToken` | `HasAuthTokenRequest` | `HasAuthTokenResponse` | unary |
| `ValidateProject` | `ValidateProjectRequest` | `ValidateProjectResponse` | unary |
| `GetGrantedScopes` | `GetGrantedScopesRequest` | `GetGrantedScopesResponse` | unary |
| `CreateScratchProjectFolder` | `CreateScratchProjectFolderRequest` | `CreateScratchProjectFolderResponse` | unary |
| `SetupJetskiChat` | `SetupJetskiChatRequest` | `SetupJetskiChatResponse` | server-stream |
| `GetServerConfiguration` | `GetServerConfigurationRequest` | `GetServerConfigurationResponse` | unary |
| `GetCapabilities` | `GetCapabilitiesRequest` | `GetCapabilitiesResponse` | unary |
| `FetchAdminControls` | `FetchAdminControlsRequest` | `FetchAdminControlsResponse` | unary |
| `GetHover` | `GetHoverRequest` | `GetHoverResponse` | unary |
| `GetDefinition` | `GetDefinitionRequest` | `GetDefinitionResponse` | unary |
| `GetReferences` | `GetReferencesRequest` | `GetReferencesResponse` | unary |
| `ApplyUpdate` | `ApplyUpdateRequest` | `ApplyUpdateResponse` | unary |
| `GetUpdateStatus` | `GetUpdateStatusRequest` | `GetUpdateStatusResponse` | unary |
| `SubscribeToAgentBrowserRequests` | `SubscribeToAgentBrowserRequestsRequest` | `SubscribeToAgentBrowserRequestsResponse` | server-stream |
| `FulfillAgentBrowserRequest` | `FulfillAgentBrowserRequestRequest` | `FulfillAgentBrowserRequestResponse` | unary |
| `UpdateAgentBrowserSubscription` | `UpdateAgentBrowserSubscriptionRequest` | `UpdateAgentBrowserSubscriptionResponse` | unary |
## 附录 B：复现方法

```bash
# 1. CLI 参数面
agy --help; for c in acp agent mcp models plugin remote-control mic-serve install changelog; do agy help $c; done
agy help mcp add
agy mcp list; agy plugin list --json; agy remote-control status

# 2. ACP 握手（NDJSON 承载 JSON-RPC 2.0）
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},"clientInfo":{"name":"probe","version":"0"}}}' \
  | agy acp --log-file /tmp/acp.log
# 之后依次发 session/new、session/set_mode、session/set_config_option、session/list、session/prompt
# 注意：不要发 logout

# 3. print 模式 NDJSON 帧
agy -p "hello" --output-format stream-json
printf '%s\n' '{"event":"user","message":{"role":"user","content":"hello"}}' \
  | agy --input-format stream-json --output-format stream-json

# 4. 钩子/定制协议：随 CLI 打包的官方文档
ls ~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/    # hooks.md / mcp_servers.md / skills.md / plugins.md / json_configs.md

# 5. 桌面应用侧
npx --yes @electron/asar extract /Applications/Antigravity.app/Contents/Resources/app.asar /tmp/agy_asar
grep -n "startLanguageServer\|WINDOW_ORIGIN\|csrf" /tmp/agy_asar/app/dist/languageServer.js /tmp/agy_asar/app/dist/lsDefaults.js
# 端口发现：LS 的 stdout/stderr 里 "listening on <proto> port at <N> for HTTP(S)"
# Connect 调用（token 取自 LS 的 --csrf_token argv）
curl -sS -k -X POST "https://127.0.0.1:<port>/exa.language_server_pb.LanguageServerService/GetStatus" \
  -H 'content-type: application/json' -H 'connect-protocol-version: 1' \
  -H "x-codeium-csrf-token: <token>" -d '{}'

# 6. protobuf 描述符（IDA Pro MCP 或直接扫二进制）
#    agy 里 language_server.proto 的 FileDescriptorProto 位于文件偏移 0x436c4d9，长度 178808
#    解开后可得 377 个方法与 887 个消息的字段/编号/类型
```
