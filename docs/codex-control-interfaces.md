# Codex 调用接口与格式（TodeX 控制层参考）

本文把 `com.openai.codex`（OpenAI Codex 桌面应用）以及它自带的 CLI 暴露给外部程序的**全部调用接口**和**每个接口的报文格式**整理出来，并对照 TodeX 现有的两条 Codex 控制链路（`TodeX_backend/src/provider/codex.rs` 与 `TodeX_backend/src/codex_gateway/mod.rs`）标出可用但未用、以及用法与新版本不一致的地方。

## 取证对象

| 对象 | 路径 | 标识 |
| :-- | :-- | :-- |
| 桌面应用 | `/Applications/ChatGPT.app` | `CFBundleIdentifier = com.openai.codex`，`CFBundleName = ChatGPT`，`productName = Codex`，版本 **26.1111.21308**（Electron 壳，Chromium `157.0.8103.78`，`app.asar` 748 MB） |
| 随应用打包的 CLI | `Contents/Resources/codex-cli/bin/codex` → `CodexCLI.app/Contents/MacOS/codex` | **`codex-cli 0.169.0-alpha.11.1`**，aarch64-apple-darwin，Mach-O 268 MB |
| 同包附件 | `bin/codex-exec-server`（63 MB）、`bin/codex-code-mode-host`（70 MB）、`codex-path/rg` | 见 §9 |
| 独立工具 | `~/.local/bin/codex` | `codex-cli 0.167.0`（Homebrew，非本文基准；接口与 0.169 有差异） |

取证时间 **2026-11-17**。取证手段：

- **实测**：`codex` 全部子命令 `--help`、`app-server` 三种 transport 的握手与全链路调用、`app-server daemon`/`proxy`、`exec --json`、`command/exec`、`fs/*`、审批拒绝路径。
- **协议**：`codex app-server generate-json-schema --experimental` 导出的官方协议（`ClientRequest` 184 个方法、`ServerNotification` 86 个、`ServerRequest` 11 个、`codex_app_server_protocol.v2.schemas.json` 864 个类型定义）。
- **二进制**：IDA Pro MCP 加载 `CodexCLI.app/Contents/MacOS/codex`（session `codex169`）后确认的协议常量、socket 名与字符集。
- **源码**：从 `app.asar` 解出的主进程/preload JS（`early-bootstrap*.js`、`.vite/build/preload.js`）。

标记约定：

- **实测**：本次运行直接验证过行为。
- **协议**：来自 `generate-json-schema` 导出的官方 schema。
- **源码**：从 `app.asar` 解出的 JS 读出。
- **二进制**：从 Mach-O 字符串/常量确认，未逐个调用验证。
- **推断**：没有直接证据，只能从命名和相邻代码判断。

---

## 0. 结论先行

1. **协议封套不是标准 JSON-RPC 2.0**。请求可以不带 `"jsonrpc"` 字段；响应只有 `{"id", "result"}` / `{"id", "error"}`；服务端通知只有 `{"method", "params", "emittedAtMs"}`，比 JSON-RPC 多了 `emittedAtMs`（墙钟毫秒）。服务端→客户端的**请求**（审批等）复用了同一个 `method` 字段，`id` 是**从 0 开始的小整数**，和客户端自增 `id` 完全不在一个命名空间里。**实测**
2. **三条 transport，语义不同**：`stdio://` 是逐行 NDJSON；`unix://PATH` **不是** NDJSON，而是**跑在 Unix domain socket 上的 WebSocket**（RFC 6455，文本帧，握手回 `x-codex-websocket-max-unfragmented-message-bytes: 16777216`）；`ws://IP:PORT` 是同一种 WebSocket，另外多两个 HTTP 探针 `/readyz`、`/healthz`。**实测**。TodeX 现在只用了 stdio。
3. **有一条常驻 daemon 链路 TodeX 完全没用**：`codex app-server daemon start` 会把 CLI 装进 `~/.codex/packages/app-server-daemon/` 并以 `app-server --listen unix:// --managed-daemon` 常驻，控制 socket 固定在 `$CODEX_HOME/app-server-control/app-server-control.sock`。`codex app-server daemon version|stop|restart|update` 是它的管理面；`codex app-server proxy [--sock PATH]` 号称把 stdio 桥到该 socket，但实测对这个 socket 只建立连接不回包（见 §2.4），别用。**实测**。TodeX 现在是「每个会话起一个 `app-server --listen stdio://` 子进程」（`provider/codex.rs:206`、`codex_gateway/mod.rs:1716`），进程和模型上下文缓存都不能跨会话共享。
4. **`initialize.capabilities.experimentalApi` 是硬开关**。不开就直接 `-32600 collaborationMode/list requires experimentalApi capability`。同组还有 `optOutNotificationMethods`（按方法名静音通知）、`requiredHumanApproval`、`requestAttestation`、`extensions`。**实测**
5. **方法面 184 个（稳定 109），TodeX 一共只碰了十几个**（`thread/start`、`thread/resume`、`turn/start`、`turn/steer`、`turn/interrupt`、`review/start`、`thread/compact/start`、`model/list`、`account/read`、`mcpServer*`，见 §4.4）。剩下的大块空白里，对 TodeX 直接有用的是 `command/exec`（不建会话直接跑命令，返回 `{exitCode, stdout, stderr}`）、`process/*`（PTY/流式）、`fs/*`（绕过 TodeX 本地文件 API，直接走服务端沙箱视图）、`thread/queue/*`、`thread/items/list`（分页读历史）、`turn/settings/update`（运行中改推理强度）、`remoteControl/*`。**协议** + **实测**
6. **二进制里还留着 3 个 v1 老方法**，schema 生成器已经不输出，但 `app-server` 仍然接受：`getAuthStatus`、`getConversationSummary`、`gitDiffToRemote`。**实测**（见 §4.3）。TodeX 的 `codex_gateway` 按方法名透传，如果前端还在发这三个，现在是能通的，但没有任何契约保护。
7. **审批契约比 TodeX 实现的宽**：`ServerRequest` 里 6 个交互型请求，每个都自带 `availableDecisions`（服务端告诉客户端这次允许哪些决策），决策枚举含 `accept` / `acceptForSession` / `acceptWithExecpolicyAmendment` / `applyNetworkPolicyAmendment` / `decline` / `cancel`。`decline` 让本轮继续、`cancel` 直接中断本轮。此外还有一个 `serverRequest/resolved` 通知，用于通知「这个审批已被别的客户端/自己被判定掉了」。**实测** + **协议**
8. **`approvalsReviewer: "auto_review"` 是原生的自动审批**：服务端用子代理做风险判定，TodeX 现在靠外层钩子和自建审批循环模拟「auto 模式」，可以换成这个值。**协议**。另外 `AskForApproval` 支持 `granular{ rules, sandbox_approval, mcp_elicitations, request_permissions, skill_approval }` 粒度配置，TodeX 只暴露了 `untrusted|on-request|never`。
9. **`codex mcp-server` 已经不存在了**：0.167.0 和 0.169.0-alpha.11.1 的子命令表里都没有，直接跑 `codex mcp-server` 会被当成「无子命令 + prompt」交给交互式 CLI。要「把 Codex 当工具给别的 agent 用」，现在只能直接说 app-server 的 JSON-RPC。**实测**
10. **桌面应用对外只有深链和它自己拉起的 app-server**：`codex://` 是注册的 URL scheme（`codex-dev:` 在开发版），路由包括 `codex://threads/<uuid>`（可带 `hostId`/`path`/`view`）、`codex://threads/new?prompt=…`、`codex://launch`、`codex://dots`、`codex://settings/...`、`codex://plugins/<id>`、`codex://health` 等；`codex://review?...`、`codex://shared-thread`、`codex://threads/<uuid>/wake` 只接受应用内触发（见 §9.5）。Electron 的 `codex_desktop:*` IPC 通道只对自家 renderer 开放，外部用不了。**源码** + **实测**（Info.plist）

---

## 1. 组件、进程、socket

| 组件 | 路径 / 形态 | 作用 |
| :-- | :-- | :-- |
| Electron 主进程 | `Contents/Resources/app.asar` → `.vite/build/early-bootstrap.js`（609 KB）+ `early-bootstrap-*.js` 分块 | 窗口、深链、SSH 远程、内建浏览器、git worker、app-server 生命周期 |
| Renderer | `.vite/build/webview/`（asar 内） | UI，通过 `preload.js` 暴露的桥通信 |
| `app-server` | `codex app-server`，Mach-O 268 MB | **协议本体**：会话/轮次/工具执行/审批/配置/MCP/文件系统全部在这里 |
| 托管 daemon | `~/.codex/packages/app-server-daemon/releases/local-<hash>-aarch64-apple-darwin/` | `daemon start` 时把 CLI 整包复制进来再常驻，见 §2.4 |
| exec-server | `codex exec-server` | 独立的 WebSocket 远程执行服务，见 §9.3 |
| code-mode host | `codex-code-mode-host` | code-mode（`features.code_mode_host`）的宿主进程，见 §9.4 |
| 语音宿主 | `codex-resources/voice/bin/codex-voice-host`（GStreamer） | 实时语音，见 `Thread/realtime/*` |

### 1.1 socket 与目录（实测）

| 路径 | 协议 | 谁创建 | 说明 |
| :-- | :-- | :-- | :-- |
| `$CODEX_HOME/app-server-control/app-server-control.sock` | WebSocket over UDS | `app-server daemon start`／`app-server --listen unix://`（默认路径） | 常驻 app-server 的控制面 |
| `/private/tmp/codex-daemon-<uid>/<sha256>` | 同上 | 同上 | 真正的 socket 实体，上面那个是符号链接 |
| `$CODEX_HOME/ipc/ipc.sock` | **4 字节小端长度前缀 + JSON** | 桌面应用主进程／CLI 会话命令 | 与 app-server 无关的独立 IPC，见 §9.8 |
| `/private/tmp/codex-ipc/ipc-<uid>.sock` | 同上 | 路径超长时的替代 | `$CODEX_HOME/ipc/ipc.sock` 超过 `sun_path` 上限时改用它，并在 `/private/tmp/codex-ipc-<uid>/<sha256>` 放符号链接 |
| `\\.\pipe\codex-ipc` | 同上 | 同上 | Windows 命名管道 |
| `$CODEX_HOME/app-server-control/app-server.log` | 文本 | 桌面 SSH 模式启动脚本 | 远端 app-server 的 stdout/stderr |
| `$CODEX_HOME/app-server-control/forwarded-ssh-agent.sock` | — | 同上 | 转发到远端的 `SSH_AUTH_SOCK` |

`$CODEX_HOME` 默认 `~/.codex`（环境变量 `CODEX_HOME` 覆盖）。所有 socket 目录权限 `0700`、socket 文件 `0600`，且创建时会校验属主是本用户——**跨用户挂不上去**。**源码**（`early-bootstrap-824`：`ipc.sock` 的 `mkdirSync(mode 0o700)` / `lstat.uid !== getuid()` 校验）

### 1.2 桌面应用怎么起 app-server（源码）

- 本地默认：`codex -c features.code_mode_host=true app-server --analytics-default-enabled`，stdio 传输。
- 设置 `CODEX_APP_SERVER_USE_LOCAL_DAEMON=1`（且未设 `CODEX_APP_SERVER_FORCE_CLI`、未设 `CODEX_CLI_PATH`）时先试 `codex app-server daemon version`，成功就连 `$CODEX_HOME/app-server-control/app-server-control.sock`，失败才回落到自己 spawn。
- SSH 远程：在远端跑
  ```
  (umask 077; mkdir -p -- ${CODEX_HOME:-$HOME/.codex}/app-server-control \
    && pkill -9 -U "$uid" -f '<cli>.*[d]esktop-ssh-websocket-v0.sock' || true \
    && ln -sfn -- "$SSH_AUTH_SOCK" .../forwarded-ssh-agent.sock \
    && : > .../app-server.log) \
  && { SSH_AUTH_SOCK=... nohup <cli> -c features.code_mode_host=true app-server --listen unix://…& }
  ```
  socket 名形如 `<cli>...desktop-ssh-websocket-v0.sock`，让 `pkill` 能精确回收。

外部程序如果想驱动**桌面应用正在用的那个** app-server，走 `daemon start` + 控制 socket 最稳；走 `--listen unix://` 自己开一个也完全可以，两者协议一致。

---

## 2. app-server 的 transport

`--listen <URL>` 的取值（**实测** `--help`）：

| 值 | 含义 |
| :-- | :-- |
| `stdio://`（默认） | stdin/stdout，逐行 JSON |
| `unix://` | 默认控制 socket 路径，WebSocket over UDS |
| `unix://PATH` | 指定路径，WebSocket over UDS |
| `ws://IP:PORT` | TCP WebSocket；只绑本机，远端要靠 SSH 端口转发 |
| `off` | 不监听任何东西（配合 `remote-control` 之类使用） |

`--stdio` 是 `--listen stdio://` 的别名。

### 2.1 `stdio://`（实测）

- 一行一条 JSON，`\n` 分隔，UTF-8，不允许多行。
- stdout = 协议流（**不能混入日志**）；stderr = 日志（tracing，默认带 ANSI 颜色）。
- 退出即连接断开；服务端不重连。

TodeX 目前就是这个模式（`codex_gateway/mod.rs:1716` 的 `app-server --listen stdio://`）。

### 2.2 `unix://[PATH]`（实测）

**不是 NDJSON，是 WebSocket。** 直接往 socket 写 `{"id":1,...}\n` 会被服务端立刻断开（broken pipe）。正确的握手：

```
GET / HTTP/1.1
Host: localhost
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: <base64 16 字节随机>

→ HTTP/1.1 101 Switching Protocols
  connection: Upgrade
  upgrade: websocket
  sec-websocket-accept: ...
  x-codex-websocket-max-unfragmented-message-bytes: 16777216
```

之后每条 JSON-RPC 消息一个 **文本帧**，内容与 stdio 完全一致（没有额外的长度前缀）。单帧上限 16 MiB。

`unix://` 不带路径时会创建 `$CODEX_HOME/app-server-control/app-server-control.sock`（符号链接到 `/private/tmp/codex-daemon-<uid>/<sha256>`）。

### 2.3 `ws://IP:PORT`（实测）

同一个 WebSocket 协议，但根路径同时也是 HTTP 服务器，多两个探针：

```
GET /readyz   → HTTP/1.1 200 OK, content-length: 0
GET /healthz  → HTTP/1.1 200 OK, content-length: 0
```
非 upgrade 的普通 `GET /` 返回 `400 Bad Request` + `Connection header did not include 'upgrade'`。启动时打印：

```
codex app-server (WebSockets)
  listening on: ws://127.0.0.1:8765
  readyz: http://127.0.0.1:8765/readyz
  healthz: http://127.0.0.1:8765/healthz
  note: binds localhost only (use SSH port-forwarding for remote access)
```

远端访问的鉴权：CLI 侧是 `--remote-auth-token-env <ENV>`（TUI）/ `--remote <ADDR>`，即 WebSocket 握手带 `Authorization: Bearer <token>`。

### 2.4 `app-server daemon` 与 `app-server proxy`（实测）

```
codex app-server daemon start        # 装包 + 常驻，stdout 打 JSON 事件
codex app-server daemon stop|restart|update|version
codex app-server daemon enable-remote-control|disable-remote-control
codex app-server daemon bootstrap    # 给 SSH 场景装「持久管理」
codex app-server proxy [--sock PATH] # stdio ⇄ 控制 socket 双向桥
```

`daemon start` 的输出（**实测**，逐行 JSON 事件 + 一行最终状态）：

```json
{"timestampMs":1794891971893,"processPid":95209,"stage":"process_spawn","outcome":"succeeded","elapsedMs":2,"failure":null}
{"timestampMs":1794891971893,"processPid":95209,"event":"process_spawned","details":{"pid":95299}}
...
{"status":"started","backend":"pid","pid":95299,
 "managedCodexPath":"/Users/you/.codex/packages/app-server-daemon/current/bin/codex",
 "managedCodexVersion":"0.169.0-alpha.11.1",
 "socketPath":"/Users/you/.codex/app-server-control/app-server-control.sock",
 "cliVersion":"0.169.0-alpha.11.1","appServerVersion":"0.169.0-alpha.11.1"}
```

`daemon version` 返回同样结构的 `{"status":"running",...}`。daemon 的进程命令行是：

```
<managed>/bin/../CodexCLI.app/Contents/MacOS/codex app-server --listen unix:// --analytics-default-enabled --managed-daemon
```

注意 `--managed-daemon` 这个隐藏开关：由 daemon 管理器拉起时必须带上，否则 `daemon version` 认不出来。

**`proxy` 的坑（实测）**：CLI 描述是「Proxy stdio bytes to the running app-server control socket」，但对一个**已确认可用**的 daemon 控制 socket（同一路径用自己的 WebSocket 客户端 `initialize` 能正常拿到响应），`codex app-server proxy` 和 `codex app-server proxy --sock <同一路径>` 都是**建立连接后静默**：往 stdin 写 `initialize` 一行，15 秒内 stdout/stderr 都是 0 字节。要么它有未文档化的前置帧格式，要么 0.169 这个子命令本身有问题。**结论：别用 proxy，直接自己连 `--listen unix://PATH`（WebSocket）或 daemon 控制 socket。**

---

## 3. 报文封套

### 3.1 客户端 → 服务端请求（实测）

```json
{"id": 3, "method": "turn/start", "params": { ... }}
```

- `id`：允许数字或字符串（`RequestId` = `int64 | string`）。实测字符串 id 也接受。
- `method`：**必填**，精确匹配 §4 的目录，大小写敏感。
- `params`：多数方法必填（schema 里 `required` 含 `params`），少数无参方法（`memory/reset`、`rollout/compress`、`account/gatewayOAuth/read|login|cancel`、`server/diagnostics`、`userVerification/status|enroll|delete`、`account/gatewayOAuth/*`）可不传。
- `"jsonrpc": "2.0"` **不需要**，带上也不报错。

### 3.2 服务端 → 客户端响应（实测）

```json
{"id": 3, "result": { ... }}
{"id": 4, "error": {"code": -32600, "message": "Invalid request: missing field `processHandle`"}}
```

- 没有 `"jsonrpc"` 回显，只有 `id` + `result` 或 `id` + `error`。
- `error.code` 实测只见过 `-32600`（invalid request / not initialized / invalid params / capability 不足），`message` 是给人看的英文串，**不要做正则匹配**，要看 `error.data` 或结构化字段（本版本 `data` 基本为空）。
- **响应可以和通知交错到达**，顺序不保证。TodeX 的 `read_rpc_response_cancellable` 已经是「循环读到匹配 id 为止」，这一点没问题。

### 3.3 错误样例（实测）

| 触发 | 返回 |
| :-- | :-- |
| 未 `initialize` 就调方法 | `{"error":{"code":-32600,"message":"Not initialized"},"id":1}` |
| 未知方法 | `{"error":{"code":-32600,"message":"Invalid request: unknown variant `does/not/exist`, expected one of `initialize`, `server/diagnostics`, …"},"id":11}` —— **错误串里带完整合法方法表**（本版 188 个，见 §4.3 与 §11.3） |
| 参数缺字段 | `{"error":{"code":-32600,"message":"Invalid request: missing field `processHandle`"},"id":4}` |
| 需要 experimental | `{"error":{"code":-32600,"message":"collaborationMode/list requires experimentalApi capability"},"id":7}` |

### 3.4 服务端 → 客户端通知（实测）

```json
{"method": "turn/started", "params": { ... }, "emittedAtMs": 1794892057983}
```

- 没有 `id`。
- `emittedAtMs` 是**墙钟毫秒**（Unix epoch ms），不是单调时钟。实测同一轮里 `turn/started` 的 `emittedAtMs` 与 `params.turn.startedAt`（秒）能对上。TodeX 现在按到达顺序打时间戳，可以改用 `emittedAtMs` 做端到端延迟观测。

### 3.5 服务端 → 客户端请求（实测）

审批、提问、动态工具调用等，是**带 `id` 的 `method` 消息**，客户端要按 `id` 回一个 `{"id": <同一个 id>, "result": {...}}`：

```json
{"method":"item/commandExecution/requestApproval","id":0,"params":{...}}
```

- `id` 是**整数**，从 0 开始按连接内自增——和客户端自己的 `id` 空间**完全独立**。TodeX 的 `LocalCodexAdapter` 把服务端请求 id 当字符串处理（`value_to_request_id`），能工作，但要注意别和客户端 id 冲突去重。
- 客户端回包后，服务端还会发一条 `serverRequest/resolved`（`params.requestId`）——实测在回包之后立刻到。这条也必须消费，否则「请求已被解决」的状态推不到前端。

### 3.6 握手（实测）

```json
→ {"id":1,"method":"initialize","params":{
     "clientInfo":{"name":"todex-agentd","title":"TodeX","version":"0.5.0"},
     "capabilities":{"experimentalApi":true}}}
← {"id":1,"result":{
     "userAgent":"todex-agentd/0.169.0-alpha.11.1 (Mac OS 27.2.1; arm64) xterm-ghostty (todex-agentd; 0.5.0)",
     "codexHome":"/Users/you/.codex",
     "platformFamily":"unix",
     "platformOs":"macos"}}
→ {"method":"initialized"}
```

- `clientInfo.name` / `clientInfo.version` 必填；`title` 可选。
- `userAgent` 是服务端拼的：`<clientName>/<serverVersion> (<platform>; <arch>) <term> (<clientName>; <clientVersion>)`。`thread/start` 响应里的 `originator` 就是 `clientInfo.name`。
- **`initialized` 是不带参数的 notification**（`ClientNotification` 全集只有这一个）。不发也能继续调方法，但按语义应该发。
- `capabilities` 全字段：

| 字段 | 类型 | 作用 |
| :-- | :-- | :-- |
| `experimentalApi` | bool，默认 false | 打开实验性方法与字段（`collaborationMode/list`、`turn/settings/update`、`thread/queue/*`、`remoteControl/*`、`windowsSandbox/*`、`process/*` 等） |
| `optOutNotificationMethods` | string[] | 按方法名**精确屏蔽**通知，例如 `["thread/started","mcpServer/startupStatus/updated"]`，立刻能砍掉大部分噪音 |
| `requiredHumanApproval` | bool | 把 `humanCommand` 类审批强制交给人，返回一次性决策；**要求先开 `experimentalApi`** |
| `requestAttestation` | bool，默认 false | 打开后服务端会发 `attestation/generate` 请求，客户端需回上游用的 `x-oai-attestation` |
| `explicitGatewayOauth` | bool | 本连接起改用显式 gateway OAuth 登录（之后不可撤销） |
| `extensions` | object | MCP 扩展声明，新客户端用 `{"openai/form": …}` 取代旧的 `mcpServerOpenaiFormElicitation` |
| `mcpServerOpenaiFormElicitation` | bool | 旧版 opt-in（兼容用） |

---

## 4. 客户端 → 服务端方法目录

`--experimental` 导出共 **184** 个；不带 `--experimental` 的稳定集 **109** 个。下表按顶层命名空间分组，参数列标 `*` 的是必填，`=type` 是字段类型（`?` 表示可为 null/可省略）。

> 完整逐字段说明用 `codex app-server generate-json-schema --experimental --out DIR` 自行导出；`DIR/ClientRequest.json` 里每个方法的 `params` 就是 `$ref`。

### 4.1 稳定集合（109）

稳定集是实验集的子集，差的这 75 个方法必须开 `experimentalApi` 才能调：

`server/diagnostics`、`userVerification/status|enroll|delete|verify|cancel`、`thread/sample`、`thread/sample/cancel`、`thread/increment_elicitation`、`thread/decrement_elicitation`、`thread/prediction/request`、`thread/queue/add|list|update|delete|reorder|start`、`thread/settings/update`、`thread/memoryMode/set`、`thread/memory/read`、`memory/status`、`memory/reset`、`rollout/compress`、`thread/backgroundTerminals/clean|list|terminate`、`project/list|read|create|import|update|move|delete`、`thread/search`、`thread/searchOccurrences`、`thread/readState/update`、`thread/items/read`、`thread/guardianReview`、`thread/prepareApprovedPlan`、`plugin/search`、`turn/settings/update`、`thread/realtime/start|appendAudio|appendText|appendSpeech|stop|listVoices`、`thread/timeline/list`、`remoteControl/enable|disable|client/list|client/revoke`、`remoteControl/status/read`、`remoteControl/pairing/start|status`、`collaborationMode/list`、`mock/experimentalMethod`、`environment/add|info|status`、`mcpServer/event/stream/start|stop`、`account/bedrock/discover|setup|checkGovCloudRequirements`、`account/gcp/setup`、`accountSession/list|switch`、`process/spawn|writeStdin|kill|resizePty`、`fuzzyFileSearch/sessionStart|sessionUpdate|sessionStop`。

> 注意 **`process/*` 全是实验性**，`command/exec` 和 `fs/*` 是稳定的。

### 4.2 全部方法（184）


**`initialize/*`**（1）

| method | params |
| :-- | :-- |
| `initialize` | capabilities=InitializeCapabilities?, clientInfo*=ClientInfo |

**`server/*`**（1）

| method | params |
| :-- | :-- |
| `server/diagnostics` | — |

**`userVerification/*`**（5）

| method | params |
| :-- | :-- |
| `userVerification/status` | — |
| `userVerification/enroll` | — |
| `userVerification/delete` | — |
| `userVerification/verify` | challenge*=str, description*=str, title*=str |
| `userVerification/cancel` | requestId*=RequestId |

**`thread/*`**（57）

| method | params |
| :-- | :-- |
| `thread/start` | allowProviderModelFallback=bool, approvalPolicy=AskForApproval?, approvalsReviewer=ApprovalsReviewer?, baseInstructions=str?, config=obj?, cwd=str?, daybreakEnabled=bool?, developerInstructions=str?, dynamicTools=[]?, environments=[]?, ephemeral=bool?, experimentalRawEvents=bool, historyMode=ThreadHistoryMode?, mockExperimentalField=str?, model=str?, modelProvider=str?, multiAgentMode=MultiAgentMode?, permissions=str?, personality=Personality?, projectId=str?, runtimeWorkspaceRoots=[]?, sandbox=SandboxMode?, selectedCapabilityRoots=[]?, serviceName=str?, serviceTier=str?, sessionStartSource=ThreadStartSource?, threadSource=ThreadSource? |
| `thread/resume` | approvalPolicy=AskForApproval?, approvalsReviewer=ApprovalsReviewer?, baseInstructions=str?, config=obj?, cwd=str?, developerInstructions=str?, excludeTurns=bool, history=[]?, initialTurnsPage=ThreadResumeInitialTurnsPageParams?, model=str?, modelProvider=str?, path=str?, permissions=str?, personality=Personality?, runtimeWorkspaceRoots=[]?, sandbox=SandboxMode?, serviceTier=str?, threadId*=str |
| `thread/fork` | approvalPolicy=AskForApproval?, approvalsReviewer=ApprovalsReviewer?, attachToSource=bool, baseInstructions=str?, beforeTurnId=str?, config=obj?, cwd=str?, deferGoalContinuation=bool, developerInstructions=str?, ephemeral=bool, excludeTurns=bool, experimentalDisablePredictionMcp=bool, experimentalPredictionMode=bool, lastTurnId=str?, model=str?, modelProvider=str?, path=str?, permissions=str?, runtimeWorkspaceRoots=[]?, sandbox=SandboxMode?, serviceTier=str?, threadId*=str, threadSource=ThreadSource? |
| `thread/sample` | allowInProgressTurn=bool, disableMcp=bool, effort=ReasoningEffort?, expectedTurnId*=str, interruptOnCancel=bool?, prompt*=str, responsesapiClientMetadata=obj?, threadId*=str, threadSource=ThreadSource?, turnTrigger=str? |
| `thread/sample/cancel` | requestId*=RequestId |
| `thread/archive` | threadId*=str |
| `thread/delete` | threadId*=str |
| `thread/unsubscribe` | threadId*=str |
| `thread/increment_elicitation` | threadId*=str |
| `thread/decrement_elicitation` | threadId*=str |
| `thread/name/set` | name*=str, threadId*=str |
| `thread/prediction/request` | sourceTurnId*=str, threadId*=str |
| `thread/goal/set` | objective=str?, origin=ThreadGoalMutationOrigin?, status=ThreadGoalStatus?, threadId*=str, tokenBudget=int? |
| `thread/goal/get` | threadId*=str |
| `thread/goal/clear` | origin=ThreadGoalMutationOrigin?, threadId*=str |
| `thread/queue/add` | clientUserMessageId*=str, input*=[]UserInput, responsesapiClientMetadata=obj?, threadId*=str |
| `thread/queue/list` | cursor=str?, limit=int?, threadId*=str |
| `thread/queue/update` | input*=[]UserInput, queuedSubmissionId*=str, responsesapiClientMetadata=obj?, threadId*=str |
| `thread/queue/delete` | queuedSubmissionId*=str, threadId*=str |
| `thread/queue/reorder` | queuedSubmissionIds*=[]str, threadId*=str |
| `thread/queue/start` | queuedSubmissionId=str?, threadId*=str |
| `thread/metadata/update` | daybreakEnabled=bool?, gitInfo=ThreadMetadataGitInfoUpdateParams?, projectId=str?, threadId*=str |
| `thread/attachment/add` | attachmentType*=str, identityKey*=str, payload*=?, threadId*=str |
| `thread/attachment/list` | cursor=str?, limit=int?, threadId*=str |
| `thread/attachmentOwner/list` | archived=bool?, attachmentType*=str, cursor=str?, identityKey*=str, limit=int? |
| `thread/attachment/remove` | attachmentType*=str, identityKey*=str, threadId*=str |
| `thread/section/move` | beforeThreadId=str?, sectionId*=str?, threadId*=str |
| `thread/settings/update` | approvalPolicy=AskForApproval?, approvalsReviewer=ApprovalsReviewer?, collaborationMode=CollaborationMode?, cwd=str?, disabledPluginIds=[]?, effort=ReasoningEffort?, environments=[]?, model=str?, multiAgentMode=MultiAgentMode?, permissions=str?, personality=Personality?, sandboxPolicy=SandboxPolicy?, serviceTier=str?, summary=ReasoningSummary?, threadId*=str |
| `thread/memoryMode/set` | mode*=ThreadMemoryMode, threadId*=str |
| `thread/memory/read` | threadId*=str |
| `thread/unarchive` | threadId*=str |
| `thread/compact/start` | threadId*=str |
| `thread/shellCommand` | command*=str, threadId*=str, timeoutMs=int? |
| `thread/approveGuardianDeniedAction` | event*=any, threadId*=str |
| `thread/backgroundTerminals/clean` | threadId*=str |
| `thread/backgroundTerminals/list` | cursor=str?, limit=int?, threadId*=str |
| `thread/backgroundTerminals/terminate` | processId*=str, threadId*=str |
| `thread/revert` | beforeTurnId*=str, threadId*=str |
| `thread/list` | ancestorThreadId=str?, archived=bool?, attachedToThreadId=str?, currentAccountOnly=bool, cursor=str?, cwd=ThreadListCwdFilter?, excludedThreadIds=[]?, includeAttachedThreads=bool, limit=int?, modelProviders=[]?, originators=[]?, parentThreadId=str?, projectId=str?, searchTerm=str?, sectionId=str?, sortDirection=SortDirection?, sortKey=ThreadSortKey?, sourceKinds=[]?, useStateDbOnly=bool |
| `thread/search` | archived=bool?, currentAccountOnly=bool, cursor=str?, includeAttachedThreads=bool, limit=int?, searchTerm*=str, sortDirection=SortDirection?, sortKey=ThreadSearchSortKey?, sourceKinds=[]? |
| `thread/searchOccurrences` | cursor=str?, limit=int?, searchTerm*=str, threadId*=str |
| `thread/loaded/list` | cursor=str?, limit=int? |
| `thread/read` | includeTurns=bool, threadId*=str |
| `thread/readState/update` | expectedRevision*=str, operation*=ThreadReadStateOperation, threadId*=str |
| `thread/turns/list` | cursor=str?, itemsView=TurnItemsView?, limit=int?, sortDirection=SortDirection?, threadId*=str |
| `thread/items/list` | cursor=ThreadItemsListCursor?, deferOutput=ThreadItemOutputDeferral?, limit=int?, sortDirection=SortDirection?, threadId*=str, turnId=str? |
| `thread/items/read` | itemIds*=[]str, threadId*=str, turnId*=str |
| `thread/guardianReview` | threadId*=str |
| `thread/inject_items` | items*=[]?, threadId*=str |
| `thread/prepareApprovedPlan` | attachmentPath=str?, markdown*=str, threadId*=str |
| `thread/realtime/start` | backendReasoningStatus=bool, clientManagedHandoffs=bool?, codexResponseHandoffChannelPrefixes=obj?, codexResponseHandoffMode=CodexResponseHandoffMode?, codexResponseItemPrefix=str?, codexResponsesAsItems=bool?, delegationAckFiller=bool?, flushTranscriptTailOnSessionEnd=bool?, includeStartupContext=bool?, initialItems=[]?, model=str?, outputModality*=RealtimeOutputModality, prompt=str?, realtimeEndInstructions=str?, realtimeSessionId=str?, realtimeStartInstructions=str?, threadId*=str, transport=ThreadRealtimeStartTransport?, version=RealtimeConversationVersion?, voice=RealtimeVoice?, voiceSessionId=str? |
| `thread/realtime/appendAudio` | audio*=ThreadRealtimeAudioChunk, threadId*=str |
| `thread/realtime/appendText` | role=ConversationTextRole, text*=str, threadId*=str |
| `thread/realtime/appendSpeech` | text*=str, threadId*=str |
| `thread/realtime/stop` | threadId*=str |
| `thread/timeline/list` | cursor=str?, limit=int?, threadId*=str |
| `thread/realtime/listVoices` | — |

**`memory/*`**（2）

| method | params |
| :-- | :-- |
| `memory/status` | minConsolidatedThreads=int? |
| `memory/reset` | — |

**`rollout/*`**（1）

| method | params |
| :-- | :-- |
| `rollout/compress` | — |

**`project/*`**（7）

| method | params |
| :-- | :-- |
| `project/list` | cursor=str?, limit=int?, sortDirection=SortDirection?, sortKey=ProjectSortKey? |
| `project/read` | projectId*=str |
| `project/create` | idempotencyKey*=str, metadata=obj?, name*=str, roots*=[]ProjectRoot |
| `project/import` | idempotencyKey*=str, metadata=obj?, name*=str, roots*=[]ProjectRoot, threads=[]? |
| `project/update` | metadata=obj?, name=str?, projectId*=str, roots=[]? |
| `project/move` | beforeProjectId=str?, projectId*=str |
| `project/delete` | projectId*=str |

**`threadSection/*`**（4）

| method | params |
| :-- | :-- |
| `threadSection/list` | cursor=str?, limit=int? |
| `threadSection/create` | appearance=ThreadSectionAppearance?, name*=str |
| `threadSection/update` | appearance=ThreadSectionAppearance?, name*=str, sectionId*=str |
| `threadSection/delete` | sectionId*=str |

**`skills/*`**（3）

| method | params |
| :-- | :-- |
| `skills/list` | cwds=[]str, forceReload=bool |
| `skills/extraRoots/set` | extraRoots*=[]AbsolutePathBuf |
| `skills/config/write` | enabled*=bool, name=str?, path=AbsolutePathBuf? |

**`hooks/*`**（1）

| method | params |
| :-- | :-- |
| `hooks/list` | cwds=[]str, threadId=str? |

**`marketplace/*`**（3）

| method | params |
| :-- | :-- |
| `marketplace/add` | refName=str?, source*=str, sparsePaths=[]? |
| `marketplace/remove` | marketplaceName*=str |
| `marketplace/upgrade` | marketplaceName=str? |

**`plugin/*`**（13）

| method | params |
| :-- | :-- |
| `plugin/list` | cwds=[]?, forceRefetch=bool, marketplaceKinds=[]? |
| `plugin/search` | cursor=str?, cwds=[]?, limit=int?, scope=PluginSearchScope?, searchTerm*=str |
| `plugin/installed` | cwds=[]?, installSuggestionPluginNames=[]? |
| `plugin/reconcile` | reason=str? |
| `plugin/read` | marketplacePath=AbsolutePathBuf?, pluginName*=str, remoteMarketplaceName=str? |
| `plugin/skill/read` | remoteMarketplaceName*=str, remotePluginId*=str, skillName*=str |
| `plugin/share/save` | discoverability=PluginShareDiscoverability?, pluginPath*=AbsolutePathBuf, remotePluginId=str?, shareTargets=[]? |
| `plugin/share/updateTargets` | discoverability*=PluginShareUpdateDiscoverability, remotePluginId*=str, shareTargets*=[]PluginShareTarget |
| `plugin/share/list` | — |
| `plugin/share/checkout` | remotePluginId*=str |
| `plugin/share/delete` | remotePluginId*=str |
| `plugin/install` | installAttemptId=str?, marketplacePath=AbsolutePathBuf?, pluginName*=str, remoteMarketplaceName=str? |
| `plugin/uninstall` | pluginId*=str |

**`app/*`**（3）

| method | params |
| :-- | :-- |
| `app/read` | appIds*=[]str, includeTools=bool, threadId=str? |
| `app/list` | cursor=str?, forceRefetch=bool, limit=int?, threadId=str? |
| `app/installed` | forceRefresh=bool, threadId=str? |

**`fs/*`**（9）

| method | params |
| :-- | :-- |
| `fs/readFile` | path*=AbsolutePathBuf |
| `fs/writeFile` | dataBase64*=str, path*=AbsolutePathBuf |
| `fs/createDirectory` | path*=AbsolutePathBuf, recursive=bool? |
| `fs/getMetadata` | path*=AbsolutePathBuf |
| `fs/readDirectory` | path*=AbsolutePathBuf |
| `fs/remove` | force=bool?, path*=AbsolutePathBuf, recursive=bool? |
| `fs/copy` | destinationPath*=AbsolutePathBuf, recursive=bool, sourcePath*=AbsolutePathBuf |
| `fs/watch` | path*=AbsolutePathBuf, watchId*=str |
| `fs/unwatch` | watchId*=str |

**`turn/*`**（4）

| method | params |
| :-- | :-- |
| `turn/start` | additionalContext=obj?, approvalPolicy=AskForApproval?, approvalsReviewer=ApprovalsReviewer?, clientUserMessageId=str?, collaborationMode=CollaborationMode?, cwd=str?, cyberAccessProgram=CyberAccessProgram?, disabledPluginIds=[]?, effort=ReasoningEffort?, environments=[]?, input*=[]UserInput, model=str?, multiAgentMode=MultiAgentMode?, outputSchema=any, parentTurnId=str?, permissions=str?, personality=Personality?, responsesapiClientMetadata=obj?, responsesapiClientMetadataPatch=obj?, rootTurnId=str?, runtimeWorkspaceRoots=[]?, sandboxPolicy=SandboxPolicy?, serviceTier=str?, serviceTierForTurn=str?, summary=ReasoningSummary?, threadId*=str, toolOutput=TurnToolOutput?, turnTrigger=str? |
| `turn/settings/update` | approvalsReviewer=ApprovalsReviewer?, effort=ReasoningEffort?, environments=[]?, model=str?, serviceTier=str?, summary=ReasoningSummary?, threadId*=str, turnId*=str |
| `turn/steer` | additionalContext=obj?, clientUserMessageId=str?, expectedTurnId*=str, input*=[]UserInput, responsesapiClientMetadata=obj?, responsesapiClientMetadataPatch=obj?, threadId*=str |
| `turn/interrupt` | threadId*=str, turnId*=str |

**`review/*`**（1）

| method | params |
| :-- | :-- |
| `review/start` | delivery=ReviewDelivery?, target*=ReviewTarget, threadId*=str |

**`model/*`**（1）

| method | params |
| :-- | :-- |
| `model/list` | cursor=str?, includeHidden=bool?, limit=int?, modelProvider=str? |

**`account/*`**（17）

| method | params |
| :-- | :-- |
| `account/gatewayOAuth/read` | — |
| `account/gatewayOAuth/login` | — |
| `account/gatewayOAuth/cancel` | — |
| `account/login/start` | — |
| `account/bedrock/discover` | — |
| `account/bedrock/setup` | — |
| `account/gcp/setup` | credentialFile=str?, location=str?, projectId*=str |
| `account/bedrock/checkGovCloudRequirements` | — |
| `account/login/cancel` | loginId*=str |
| `account/logout` | — |
| `account/securitySetup/read` | — |
| `account/rateLimits/read` | — |
| `account/rateLimitResetCredit/consume` | creditId=str?, idempotencyKey*=str |
| `account/usage/read` | — |
| `account/workspaceMessages/read` | — |
| `account/sendAddCreditsNudgeEmail` | creditType*=AddCreditsNudgeCreditType |
| `account/read` | refreshToken=bool |

**`modelProvider/*`**（3）

| method | params |
| :-- | :-- |
| `modelProvider/list` | — |
| `modelProvider/config/write` | settings*=ProviderSettingsPatch |
| `modelProvider/capabilities/read` | — |

**`experimentalFeature/*`**（2）

| method | params |
| :-- | :-- |
| `experimentalFeature/list` | cursor=str?, limit=int?, threadId=str? |
| `experimentalFeature/enablement/set` | enablement*=obj |

**`permissionProfile/*`**（1）

| method | params |
| :-- | :-- |
| `permissionProfile/list` | cursor=str?, cwd=str?, limit=int? |

**`remoteControl/*`**（7）

| method | params |
| :-- | :-- |
| `remoteControl/enable` | — |
| `remoteControl/disable` | — |
| `remoteControl/status/read` | — |
| `remoteControl/pairing/start` | manualCode=bool |
| `remoteControl/pairing/status` | manualPairingCode=str?, pairingCode=str? |
| `remoteControl/client/list` | cursor=str?, environmentId*=str, limit=int?, order=RemoteControlClientsListOrder? |
| `remoteControl/client/revoke` | clientId*=str, environmentId*=str |

**`collaborationMode/*`**（1）

| method | params |
| :-- | :-- |
| `collaborationMode/list` | — |

**`mock/*`**（1）

| method | params |
| :-- | :-- |
| `mock/experimentalMethod` | value=str? |

**`environment/*`**（3）

| method | params |
| :-- | :-- |
| `environment/add` | authBearerToken=str?, connectTimeoutMs=int?, environmentId*=str, execServerUrl*=str, skills=EnvironmentSkillsParams?, websocketRequestId=str? |
| `environment/info` | environmentId*=str |
| `environment/status` | environmentId*=str |

**`mcpServer/*`**（5）

| method | params |
| :-- | :-- |
| `mcpServer/oauth/login` | clientRegistration=McpServerOauthClientRegistration?, name*=str, scopes=[]?, threadId=str?, timeoutSecs=int? |
| `mcpServer/resource/read` | _meta=obj?, connectorId=str?, originCallId=str?, server*=str, target=McpResourceReadTarget?, threadId=str?, uri*=str |
| `mcpServer/event/stream/start` | _meta=?, arguments*=?, name*=str, server*=str, subscriptionId*=str, threadId*=str |
| `mcpServer/event/stream/stop` | subscriptionId*=str |
| `mcpServer/tool/call` | _meta=?, arguments=?, server*=str, threadId*=str, tool*=str |

**`config/*`**（4）

| method | params |
| :-- | :-- |
| `config/mcpServer/reload` | — |
| `config/read` | cwd=str?, includeLayers=bool |
| `config/value/write` | expectedVersion=str?, filePath=str?, keyPath*=str, mergeStrategy*=MergeStrategy, value*=? |
| `config/batchWrite` | edits*=[]ConfigEdit, expectedVersion=str?, filePath=str?, reloadUserConfig=bool |

**`mcpServerStatus/*`**（1）

| method | params |
| :-- | :-- |
| `mcpServerStatus/list` | cursor=str?, detail=McpServerStatusDetail?, limit=int?, serverName=str?, threadId=str? |

**`windowsSandbox/*`**（2）

| method | params |
| :-- | :-- |
| `windowsSandbox/setupStart` | cwd=AbsolutePathBuf?, mode*=WindowsSandboxSetupMode |
| `windowsSandbox/readiness` | — |

**`accountSession/*`**（2）

| method | params |
| :-- | :-- |
| `accountSession/list` | refreshWorkspaceMetadata=bool |
| `accountSession/switch` | accountId*=str, allowBrowserLogin=bool, sessionId*=str |

**`feedback/*`**（2）

| method | params |
| :-- | :-- |
| `feedback/upload` | classification*=str, extraLogFiles=[]?, includeLogs=bool, reason=str?, tags=obj?, threadId=str? |
| `feedback/save` | classification*=str, extraLogFiles=[]?, includeLogs=bool, reason=str?, savePath*=LegacyAppPathString, tags=obj?, threadId=str? |

**`command/*`**（4）

| method | params |
| :-- | :-- |
| `command/exec` | command*=[]str, cwd=str?, disableOutputCap=bool, disableTimeout=bool, env=obj?, outputBytesCap=int?, permissionProfile=str?, processId=str?, sandboxPolicy=SandboxPolicy?, size=CommandExecTerminalSize?, streamStdin=bool, streamStdoutStderr=bool, timeoutMs=int?, tty=bool |
| `command/exec/write` | closeStdin=bool, deltaBase64=str?, processId*=str |
| `command/exec/terminate` | processId*=str |
| `command/exec/resize` | processId*=str, size*=CommandExecTerminalSize |

**`process/*`**（4）

| method | params |
| :-- | :-- |
| `process/spawn` | command*=[]str, cwd*=AbsolutePathBuf, env=obj?, outputBytesCap=int?, processHandle*=str, size=ProcessTerminalSize?, streamStdin=bool, streamStdoutStderr=bool, timeoutMs=int?, tty=bool |
| `process/writeStdin` | closeStdin=bool, deltaBase64=str?, processHandle*=str |
| `process/kill` | processHandle*=str |
| `process/resizePty` | processHandle*=str, size*=ProcessTerminalSize |

**`externalAgentConfig/*`**（4）

| method | params |
| :-- | :-- |
| `externalAgentConfig/detect` | cwds=[]?, includeHome=bool, maxSessionAgeDays=int?, maxSessions=int?, migrationSource=str?, source=str? |
| `externalAgentConfig/import` | migrationItems*=[]ExternalAgentConfigMigrationItem, migrationSource=str?, providerId=str?, source=str? |
| `externalAgentConfig/import/recordHistory` | itemTypeResults*=[]ExternalAgentConfigImportHistoryRecordTypeResultParams, providerId*=str |
| `externalAgentConfig/import/readHistories` | — |

**`configRequirements/*`**（1）

| method | params |
| :-- | :-- |
| `configRequirements/read` | — |

**`fuzzyFileSearch/*`**（4）

| method | params |
| :-- | :-- |
| `fuzzyFileSearch` | cancellationToken=str?, query*=str, roots*=[]str |
| `fuzzyFileSearch/sessionStart` | roots*=[]str, sessionId*=str |
| `fuzzyFileSearch/sessionUpdate` | query*=str, sessionId*=str |
| `fuzzyFileSearch/sessionStop` | sessionId*=str |

### 4.3 二进制里仍接受、但 schema 不再导出的 v1 老方法（实测）

`app-server` 接受的方法表是 **188** 个，比 `--experimental` 导出的 184 个多 4 个，其中 3 个是没进 schema 的 v1 老接口：

| method | params | 返回（实测） |
| :-- | :-- | :-- |
| `getAuthStatus` | `{}` | `{"authMethod":"apikey","authToken":null,"requiresOpenaiAuth":true}` |
| `getConversationSummary` | `{"conversationId": "<uuid>"}` **或** `{"rolloutPath": "<path>"}`（untagged enum） | `{"summary":{"conversationId":…,"path":"~/.codex/sessions/…jsonl","preview":…,…}}` |
| `gitDiffToRemote` | `{"cwd":"<abs path>"}` | `{"sha":"<40 hex>","diff":"<unified diff>"}` |

这些方法没有 schema 保护，行为随时可能被删。TodeX 若在用，建议迁到 `account/read`、`thread/list`、`thread/read`。**`codex mcp-server` 同理已删除**（见 §9.6）。

### 4.4 TodeX 现在用到的方法

| 位置 | 方法 |
| :-- | :-- |
| `provider/codex.rs` + `provider/codex/runtime.rs` | `initialize`、`initialized`、`thread/start`、`thread/resume`、`thread/fork`、`thread/compact/start`、`thread/memoryMode/set`、`turn/start`、`turn/steer`、`turn/interrupt`、`turn/settings/update`、`thread/queue/add\|delete\|list\|start`、`thread/goal/set\|get\|clear`、`model/list`、`account/read`、`account/rateLimits/read` |
| `codex_gateway/mod.rs` | `initialize`、`initialized`、`turn/start`、`turn/steer`、`turn/interrupt`、`review/start`、`mcpServerStatus/list`、`mcpServer/resource/read`、`mcpServer/tool/call`、`mcpServer/oauth/login`、`config/mcpServer/reload`，其余按 `request_type` 原样透传 |

按方法名字面统计：`provider/codex.rs` 覆盖约 26 个、`codex_gateway/mod.rs` 覆盖 23 个（含通知与服务端请求），相对 86 + 11 的总量仍有大量未消费的方法——具体缺口见 §6.1 与 §10。

---

## 5. 核心流程与实测报文

以下全部是 2026-11-17 在 `codex-cli 0.169.0-alpha.11.1` 上跑出来的**原始报文**（用 `--listen unix://` + WebSocket 客户端 + `ephemeral: true` 的线程抓的，不落盘）。

### 5.1 起一个线程

请求：

```json
{"id":2,"method":"thread/start","params":{
  "cwd":"/tmp","ephemeral":true,
  "approvalPolicy":"never","sandbox":"danger-full-access",
  "model":"gpt-6.1-sol"}}
```

响应（实测，字段裁剪）：

```json
{"id":2,"result":{
  "thread":{
    "id":"01a1e7e7-3267-7550-b0ca-aedb7f7e3f47",
    "environments":[{"environmentId":"local","cwd":"/tmp","runtimeWorkspaceRoots":["/tmp"]}],
    "extra":null,"sessionId":"01a1e7e7-3267-7550-b0ca-aedb7f7e3f47",
    "forkedFromId":null,"attachedToThreadId":null,"parentThreadId":null,
    "preview":"","ephemeral":true,"section":null,"sectionEnteredAt":null,"projectId":null,
    "historyMode":"paginated","modelProvider":"custom","model":"gpt-6.1-sol",
    "reasoningEffort":"low",
    "createdAt":1794892051,"updatedAt":1794892051,"recencyAt":1794892051,
    "status":{"type":"idle"},"path":null,"cwd":"/tmp",
    "cliVersion":"0.169.0-alpha.11.1","originator":"todex-probe",
    "source":"vscode","canAcceptDirectInput":true,"threadSource":null,
    "agentNickname":null,"agentRole":null,"gitInfo":null,"name":null,
    "daybreakEnabled":null,"turns":[]},
  "model":"gpt-6.1-sol","modelProvider":"custom","serviceTier":null,
  "disabledPluginIds":[],"cwd":"/tmp","runtimeWorkspaceRoots":["/tmp"],
  "instructionSources":["/Users/you/.codex/AGENTS.md"],
  "approvalPolicy":"never","approvalsReviewer":"user",
  "sandbox":{"type":"dangerFullAccess"},
  "activePermissionProfile":null,"reasoningEffort":"low",
  "multiAgentMode":"explicitRequestOnly"}}
```

要点：

- `thread.sessionId` 与 `thread.id` 本版相同；`thread.path` 在 `ephemeral: true` 时为 `null`（不写 rollout，这就是 TodeX `private_conversations()` 依赖的行为）。
- 响应**不是** `Thread` 对象本身，而是 `ThreadStartResponse`：`thread` + 这次实际生效的一整套设置（`model`、`approvalPolicy`、`sandbox`、`reasoningEffort`、`cwd`、`runtimeWorkspaceRoots`、`instructionSources`、`serviceTier`、`disabledPluginIds`、`multiAgentMode`）。TodeX 的 `provider/codex.rs:593` 已经拿这个做「实际生效值」，思路对。
- `source` 是服务端判定的客户端类型（实测报 `"vscode"`），`originator` 才是 `clientInfo.name`。
- `instructionSources` 告诉你这次到底加载了哪些 `AGENTS.md`——排查「指令没生效」直接看这里。

### 5.2 起一轮

```json
{"id":3,"method":"turn/start","params":{
  "threadId":"01a1e7e7-…","input":[{"type":"text","text":"Reply with exactly: ok"}]}}
```

响应只回一个 turn 骨架，**不等本轮结束**：

```json
{"id":3,"result":{"turn":{
  "id":"01a1e7e7-4d77-7332-be23-97e3a39e0af3",
  "rootTurnId":"01a1e7e7-4d77-7332-be23-97e3a39e0af3",
  "items":[],"itemsView":"notLoaded","status":"inProgress",
  "error":null,"startedAt":null,"completedAt":null,"durationMs":null}}}
```

`input` 数组的元素类型（`UserInput` union，协议）：

| `type` | 其它字段 | 说明 |
| :-- | :-- | :-- |
| `text` | `text*`、`text_elements`（默认 `[]`） | `text_elements` 是 UI 自定义 span，`{byteRange:{start,end}, placeholder?}` |
| `image` | `url` **或** `fileId`，`detail?` | 远端图 / 已上传文件 |
| `localImage` | `path*`、`detail?` | 本地图片路径 |
| `audio` | — | 音频 |

`turn/start` 在**本轮已 active** 时的语义：追加输入到当前轮（协议对 `parentTurnId` 的描述明确写了 "Ignored when this request adds input to an active turn"）。这一点和 TodeX 的 `codex.turn.input` → `turn/steer` 是两条不同路径：`turn/start` 追加输入不需要 `expectedTurnId`，`turn/steer` 需要。桌面应用的默认行为由配置 `desktop.followUpQueueMode = "steer"` 决定。

### 5.3 一轮完整通知序列（实测，简单问答）

按到达顺序，共 14 条：

```
mcpServer/startupStatus/updated   ×3   (node_repl / cua_repl / context7 各自 ready)
thread/status/changed                  {"status":{"type":"active","activeFlags":[]}}
turn/started
item/started                           userMessage
item/completed                         userMessage（含 contentTokenCount:null）
item/started                           agentMessage（text 空、phase=final_answer）
item/agentMessage/delta
item/completed                         agentMessage（text 完整、contentTokenCount:2）
thread/tokenUsage/updated
account/rateLimits/updated
thread/status/changed                  {"status":{"type":"idle"}}
turn/completed
```

关键报文（原文）：

```json
{"method":"turn/started","params":{
  "threadId":"01a1e7e7-4d57-…",
  "turn":{"id":"01a1e7e7-4d77-…","rootTurnId":"01a1e7e7-4d77-…","items":[],
          "itemsView":"notLoaded","status":"inProgress","error":null,
          "startedAt":1794892057,"completedAt":null,"durationMs":null}},
 "emittedAtMs":1794892057983}

{"method":"item/started","params":{
  "item":{"type":"agentMessage","moderation":null,"id":"msg_04d44813…",
          "text":"","phase":"final_answer","memoryCitation":null,
          "delivery":null,"questions":null,
          "startedAtMs":1794892061370,"completedAtMs":null},
  "threadId":"01a1e7e7-4d57-…","turnId":"01a1e7e7-4d77-…",
  "startedAtMs":1794892061370},
 "emittedAtMs":1794892061370}

{"method":"item/completed","params":{
  "item":{"type":"agentMessage","id":"msg_04d44813…","text":"ok",
          "phase":"final_answer", …,"startedAtMs":1794892061370,"completedAtMs":1794892061371},
  "threadId":"…","turnId":"…","contentTokenCount":2,"completedAtMs":1794892061371},
 "emittedAtMs":1794892061371}

{"method":"thread/tokenUsage/updated","params":{
  "threadId":"…","turnId":"…",
  "tokenUsage":{
    "total":{"totalTokens":20342,"inputTokens":20337,"cachedInputTokens":4224,
             "cacheWriteInputTokens":0,"outputTokens":5,"reasoningOutputTokens":0},
    "last":{"totalTokens":20342,"inputTokens":20337,"cachedInputTokens":4224,
            "cacheWriteInputTokens":0,"outputTokens":5,"reasoningOutputTokens":0},
    "modelContextWindow":258400}},
 "emittedAtMs":1794892061466}

{"method":"turn/completed","params":{
  "threadId":"…",
  "turn":{"id":"01a1e7e7-4d77-…","rootTurnId":"…",
          "items":[{ "type":"agentMessage","text":"ok","phase":"final_answer", … }],
          "itemsView":"summary","status":"completed","error":null,
          "startedAt":1794892057,"completedAt":1794892061,"durationMs":3503}},
 "emittedAtMs":1794892061484}
```

要点：

- `turn/completed` 里的 `items` 是 `itemsView: "summary"` 的摘要，**默认只含最终 agentMessage**；要完整项就靠 `item/*` 通知或 `thread/items/list`。
- 每个 item 的 `phase` 有 `commentary`（中间叙述）与 `final_answer`（最终答复）两种，实测都会出现。TodeX 的 `provider/codex.rs:1294` 已经按 `phase == "commentary"` 把 block 分成 `assistant_progress` / `assistant_final`，这一块是对的；但 `codex_gateway` 侧没有任何 phase 处理（`codex.item.completed` 原样透传），前端从 gateway 走的时候要靠自己判。
- `thread/tokenUsage/updated` 的 `total` 是线程累计、`last` 是本轮增量，两个都要，TodeX 的 context 占用条应该用 `last.totalTokens` 对 `modelContextWindow`。
- `run started` 后先到 3 条 `mcpServer/startupStatus/updated`——这些是每线程一次的 MCP 启动事件，可以直接用 `optOutNotificationMethods` 静音。

### 5.4 审批全链路（实测）

线程用 `approvalPolicy: "on-request"` + `sandbox: "read-only"`，让模型跑 `echo hi > /tmp/probe_approval2.txt`，实得：

```json
{"method":"thread/status/changed",
 "params":{"threadId":"01a1e7e8-…","status":{"type":"active","activeFlags":["waitingOnApproval"]}},
 "emittedAtMs":1794892121965}

{"method":"item/started","params":{
  "item":{"type":"commandExecution","id":"exec-8c4ff544-92e4-4824-b256-68844f9424a6",
          "pluginId":null,"scriptPath":null,
          "command":"/bin/zsh -lc 'echo hi > /tmp/probe_approval2.txt'",
          "cwd":"/tmp","processId":null,"source":"agent","status":"inProgress",
          "commandActions":[{"type":"unknown","command":"echo hi > /tmp/probe_approval2.txt"}],
          "aggregatedOutput":null,"exitCode":null,"durationMs":null,
          "startedAtMs":1794892121965,"completedAtMs":null},
  "threadId":"…","turnId":"…","startedAtMs":1794892121965},
 "emittedAtMs":1794892121965}

{"method":"item/commandExecution/requestApproval","id":0,"params":{
  "kind":"command",
  "threadId":"01a1e7e8-…","turnId":"01a1e7e8-…",
  "itemId":"exec-8c4ff544-92e4-4824-b256-68844f9424a6",
  "startedAtMs":1794892121965,
  "environmentId":"local",
  "reason":"Allow writing hi to /tmp/probe_approval2.txt?",
  "command":"/bin/zsh -lc 'echo hi > /tmp/probe_approval2.txt'",
  "cwd":"/tmp",
  "commandActions":[{"type":"unknown","command":"echo hi > /tmp/probe_approval2.txt"}],
  "proposedExecpolicyAmendment":["/bin/zsh","-lc","echo hi > /tmp/probe_approval2.txt"],
  "availableDecisions":[
    "accept",
    {"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["/bin/zsh","-lc","echo hi > …"]}},
    "cancel" ]}}
```

- `reason` 是**给人看的一句话**，可以直接当 UI 副标题；`kind: "command"` 表示这是命令类（另外还有网络/文件变更类的 `kind`）。
- **`availableDecisions` 是服务端给的可选集**，客户端必须只在这个集合里选。注意这次没有 `decline`（只有 `cancel`）——因为 read-only 沙箱下拒绝这条命令就等于放弃整轮。实测回 `{"decision":"decline"}` 服务端也接受，但语义上属于越界使用；**正确做法是按 `availableDecisions` 渲染按钮**。
- `proposedExecpolicyAmendment` 是「以后同类命令自动放行」的规则内容，对应 `acceptWithExecpolicyAmendment` 决策。
- 客户端回包：`{"id":0,"result":{"decision":"decline"}}`。
- 回包后立刻收到：

```json
{"method":"serverRequest/resolved","params":{"threadId":"…","requestId":0}}
{"method":"item/completed","params":{"item":{"type":"commandExecution","status":"declined",
   "aggregatedOutput":null,"exitCode":null, …}}}
{"method":"thread/status/changed","params":{"status":{"type":"active","activeFlags":[]}}}
```

`commandExecution.status` 由 `inProgress` 变为 `declined`。

**`decline` 让本轮继续**（模型会自己绕开），`cancel` 会直接把本轮中断成 `interrupted`，两者语义不同。TodeX 的 `codex_gateway/mod.rs:4230 approval_outcome_from_response` 把 `accept|accepted|approve|approved|allow|allowed` 归到 `Accepted`、`deny|denied|reject|rejected|decline|declined` 归到 `Denied`，其余一律报 `unknown CodeX approval decision`——也就是说：

- 从前端回上来的 `cancel` 会**直接报错**（`provider/codex.rs` 那条路径是好的：`:1598` 已经把 `AbortTurn → "cancel"` 映射了，缺的只是 gateway 这一层）；
- `acceptForSession`、`acceptWithExecpolicyAmendment{...}`、`applyNetworkPolicyAmendment{...}` 这三个**合法的**决策值也会报错（`provider/codex.rs:1595` 单独映射了 `AllowAlways → acceptForSession`，但 gateway 这条路径没有）；
- 对象型决策（`{acceptWithExecpolicyAmendment:{...}}`）在 `payload_string` 里根本取不到字符串。

建议：`CodexApprovalOutcome` 扩成 `Accepted | AcceptedForSession | AcceptedWithAmendment | Declined | Cancelled`，并且把 `availableDecisions` 原样透传给前端做按钮渲染。

### 5.5 不建会话直接跑命令（实测，TodeX 没用）

```json
→ {"id":2,"method":"command/exec","params":{"command":["/bin/sh","-c","echo hi; pwd"],"cwd":"/tmp","timeoutMs":10000}}
← {"id":2,"result":{"exitCode":0,"stdout":"hi\n/tmp\n","stderr":""}}
```

`CommandExecParams` 全字段：`command*`（**argv 数组，不是字符串**）、`cwd?`、`env?`（值为 `null` 表示删除该变量）、`timeoutMs?` / `disableTimeout`、`outputBytesCap?` / `disableOutputCap`、`sandboxPolicy?` / `permissionProfile?`（二者互斥）、`tty?`、`size?`、`processId?`、`streamStdin`、`streamStdoutStderr`。

- `tty: true` 隐含 `streamStdin` + `streamStdoutStderr`，需要客户端自己给 `processId`。
- 流式模式下 stdout/stderr 走 `command/exec/outputDelta` 通知，**且不会重复出现在最终响应里**；最终响应在进程退出、且所有 outputDelta 都发完之后才发。
- 后续操作：`command/exec/write`（写 stdin 字节）、`command/exec/resize`（TTY 尺寸）、`command/exec/terminate`。

这条通道对 TodeX 很有价值：**结构化 shell 执行**（不需要起会话、不走模型），可以直接替掉部分「在宿主上 exec 子进程」的实现，还能顺带拿到服务的沙箱策略。

`process/spawn`（实验性）是它的宿主版：不经 Codex 沙箱，直接在被 spawn 的 app-server 所在机器上起进程，返回 `processHandle`，输出走 `process/outputDelta`、退出走 `process/exited`。

---

## 6. 服务端 → 客户端通知（86 个）

全部通知共用封套 `{"method", "params", "emittedAtMs"}`。下表是第一行的参数结构。想减少噪音用 `initialize.capabilities.optOutNotificationMethods` 精确静音。

| method | params |
| :-- | :-- |
| `error` | error*=TurnError, threadId*=str, turnId*=str, willRetry*=bool |
| `thread/started` | thread*=Thread |
| `thread/status/changed` | status*=ThreadStatus, threadId*=str |
| `thread/readState/changed` | readState*=ThreadReadState, threadId*=str |
| `thread/archived` | threadId*=str |
| `thread/deleted` | threadId*=str |
| `thread/unarchived` | threadId*=str |
| `thread/closed` | threadId*=str |
| `thread/reverted` | threadId*=str |
| `skills/changed` | — |
| `thread/name/updated` | threadId*=str, threadName=str? |
| `thread/section/changed` | sectionId*=str?, threadId*=str |
| `thread/attachment/updated` | attachmentId*=str, attachmentType*=str, identityKey*=str, operation*=ThreadAttachmentOperation, threadId*=str |
| `thread/goal/updated` | goal*=ThreadGoal, threadId*=str, turnId=str? |
| `thread/prediction/updated` | result*=ThreadPredictionResult, sourceTurnId*=str, threadId*=str |
| `thread/goal/cleared` | threadId*=str |
| `thread/queue/changed` | threadId*=str |
| `project/changed` | changeType*=ProjectChangeType, projectId*=str |
| `thread/project/updated` | projectId*=str?, threadId*=str |
| `thread/environment/connected` | environmentId*=str, threadId*=str |
| `thread/environment/disconnected` | environmentId*=str, threadId*=str |
| `thread/settings/updated` | threadId*=str, threadSettings*=ThreadSettings |
| `thread/tokenUsage/updated` | threadId*=str, tokenUsage*=ThreadTokenUsage, turnId*=str |
| `turn/started` | threadId*=str, turn*=Turn |
| `hook/started` | run*=HookRunSummary, threadId*=str, turnId=str? |
| `turn/completed` | threadId*=str, turn*=Turn |
| `hook/completed` | run*=HookRunSummary, threadId*=str, turnId=str? |
| `turn/diff/updated` | diff*=str, threadId*=str, turnId*=str |
| `turn/plan/updated` | explanation=str?, plan*=[]TurnPlanStep, threadId*=str, turnId*=str |
| `item/started` | item*=ThreadItem, startedAtMs*=int, threadId*=str, turnId*=str |
| `item/autoApprovalReview/started` | action*=GuardianApprovalReviewAction, review*=GuardianApprovalReview, reviewId*=str, startedAtMs*=int, targetItemId=str?, threadId*=str, turnId*=str |
| `item/autoApprovalReview/completed` | action*=GuardianApprovalReviewAction, completedAtMs*=int, decisionSource*=AutoReviewDecisionSource, review*=GuardianApprovalReview, reviewId*=str, startedAtMs*=int, targetItemId=str?, threadId*=str, turnId*=str |
| `autoApprovalReview/strictReviewRequired` | startedAtMs*=int, threadId*=str, turnId*=str |
| `item/completed` | completedAtMs*=int, contentTokenCount=int?, item*=ThreadItem, threadId*=str, turnId*=str |
| `item/agentMessage/delta` | delta*=str, itemId*=str, threadId*=str, turnId*=str |
| `item/plan/delta` | delta*=str, itemId*=str, threadId*=str, turnId*=str |
| `command/exec/outputDelta` | capReached*=bool, deltaBase64*=str, processId*=str, stream*=CommandExecOutputStream |
| `process/outputDelta` | capReached*=bool, deltaBase64*=str, processHandle*=str, stream*=ProcessOutputStream |
| `process/exited` | exitCode*=int, outputDrainTimedOut=bool?, processHandle*=str, stderr*=str, stderrCapReached*=bool, stdout*=str, stdoutCapReached*=bool |
| `item/commandExecution/outputDelta` | delta*=str, itemId*=str, threadId*=str, turnId*=str |
| `item/commandExecution/terminalInteraction` | itemId*=str, processId*=str, stdin*=str, threadId*=str, turnId*=str |
| `item/fileChange/outputDelta` | delta*=str, itemId*=str, threadId*=str, turnId*=str |
| `item/fileChange/patchUpdated` | changes*=[]FileUpdateChange, itemId*=str, threadId*=str, turnId*=str |
| `serverRequest/resolved` | requestId*=RequestId, threadId*=str |
| `item/mcpToolCall/progress` | itemId*=str, message*=str, threadId*=str, turnId*=str |
| `mcpServer/oauthLogin/completed` | error=str?, loginId=str?, name*=str, success*=bool, threadId=str? |
| `mcpServer/startupStatus/updated` | error=str?, failureReason=McpServerStartupFailureReason?, name*=str, status*=McpServerStartupState, threadId=str? |
| `mcpServer/event/stream/notification` | notification*=McpServerEventNotification, subscriptionId*=str |
| `account/updated` | authMode=AuthMode?, planType=PlanType? |
| `account/gatewayOAuth/changed` | authUrl=str?, error=str?, loginId=str?, providerId*=str, status*=GatewayOAuthStatus |
| `account/rateLimits/updated` | rateLimits*=RateLimitSnapshot |
| `app/list/updated` | data*=[]AppInfo |
| `remoteControl/status/changed` | environmentId=str?, installationId*=str, serverName*=str, status*=RemoteControlConnectionStatus |
| `externalAgentConfig/import/progress` | importId*=str, itemTypeResults*=[]ExternalAgentConfigImportTypeResult |
| `externalAgentConfig/import/completed` | importId*=str, itemTypeResults*=[]ExternalAgentConfigImportTypeResult |
| `fs/changed` | changedPaths*=[]AbsolutePathBuf, watchId*=str |
| `item/reasoning/summaryTextDelta` | delta*=str, itemId*=str, summaryIndex*=int, threadId*=str, turnId*=str |
| `item/reasoning/summaryPartAdded` | itemId*=str, summaryIndex*=int, threadId*=str, turnId*=str |
| `item/reasoning/textDelta` | contentIndex*=int, delta*=str, itemId*=str, threadId*=str, turnId*=str |
| `thread/compacted` | threadId*=str, turnId*=str |
| `model/rerouted` | fromModel*=str, reason*=ModelRerouteReason, threadId*=str, toModel*=str, turnId*=str |
| `model/verification` | threadId*=str, turnId*=str, verifications*=[]ModelVerification |
| `modelProvider/authRecoveryStarted` | message*=str, provider*=str, threadId*=str, turnId*=str |
| `modelProvider/authRecoveryCompleted` | message*=str, provider*=str, threadId*=str, turnId*=str |
| `turn/moderationMetadata` | metadata*=?, threadId*=str, turnId*=str |
| `model/safetyBuffering/updated` | fasterModel=str?, model*=str, reasons*=[]str, showBufferingUi*=bool, threadId*=str, turnId*=str, useCases*=[]str |
| `warning` | message*=str, threadId=str? |
| `guardianWarning` | message*=str, threadId*=str |
| `deprecationNotice` | details=str?, summary*=str |
| `configWarning` | details=str?, path=str?, range=TextRange?, summary*=str |
| `fuzzyFileSearch/sessionUpdated` | files*=[]FuzzyFileSearchResult, query*=str, sessionId*=str |
| `fuzzyFileSearch/sessionCompleted` | sessionId*=str |
| `thread/realtime/started` | realtimeSessionId=str?, threadId*=str, version*=RealtimeConversationVersion |
| `thread/realtime/itemAdded` | item*=?, threadId*=str |
| `thread/realtime/item/started` | item*=ThreadRealtimeItem, threadId*=str |
| `thread/realtime/item/transcript/delta` | delta*=str, itemId*=str, threadId*=str |
| `thread/realtime/item/completed` | item*=ThreadRealtimeItem, threadId*=str |
| `thread/realtime/transcript/delta` | delta*=str, role*=str, threadId*=str |
| `thread/realtime/transcript/done` | role*=str, text*=str, threadId*=str |
| `thread/realtime/outputAudio/delta` | audio*=ThreadRealtimeAudioChunk, threadId*=str |
| `thread/realtime/sdp` | sdp*=str, threadId*=str |
| `thread/realtime/error` | message*=str, threadId*=str |
| `thread/realtime/closed` | reason=str?, threadId*=str |
| `windows/worldWritableWarning` | extraCount*=int, failedScan*=bool, samplePaths*=[]str |
| `windowsSandbox/setupCompleted` | error=str?, mode*=WindowsSandboxSetupMode, success*=bool |
| `account/login/completed` | error=str?, loginId=str?, onboardingEntrypoint=DesktopOnboardingEntrypoint?, success*=bool |

### 6.1 通知分组说明

| 分组 | 方法 | 用途 / 注意 |
| :-- | :-- | :-- |
| 线程生命周期 | `thread/started`、`thread/status/changed`、`thread/closed`、`thread/archived`、`thread/unarchived`、`thread/deleted`、`thread/reverted`、`thread/compacted` | `thread/status/changed` 的 `status.type` ∈ `notLoaded|idle|systemError|active`，`active` 带 `activeFlags[]`（`waitingOnApproval` / `waitingOnUserInput`）——**这是 UI 上「等审批」指示灯的正确数据源** |
| 轮次 | `turn/started`、`turn/completed`、`turn/diff/updated`、`turn/plan/updated`、`turn/moderationMetadata` | TodeX 已消费前两个；`turn/diff/updated` 是**整轮 diff**（不是每文件），`turn/plan/updated` 是计划模式的 step 列表 |
| item 流 | `item/started`、`item/completed`、`item/agentMessage/delta`、`item/plan/delta`、`item/reasoning/textDelta`、`item/reasoning/summaryTextDelta`、`item/reasoning/summaryPartAdded`、`item/commandExecution/outputDelta`、`item/commandExecution/terminalInteraction`、`item/fileChange/outputDelta`、`item/fileChange/patchUpdated`、`item/mcpToolCall/progress` | `delta` 系列都带 `itemId`，要按 itemId 拼流；`terminalInteraction` 是 TTY 里的按键回显 |
| 命令/进程 | `command/exec/outputDelta`、`process/outputDelta`、`process/exited` | 只在 `command/exec` / `process/spawn` 的流式模式下出现 |
| 审批与安全 | `serverRequest/resolved`、`item/autoApprovalReview/started|completed`、`autoApprovalReview/strictReviewRequired`、`guardianWarning`、`warning` | `autoApprovalReview/*` 是 `approvalsReviewer: auto_review` 的子代理判定过程，可以直接渲染成「自动审批中…」 |
| 用量与会话态 | `thread/tokenUsage/updated`、`account/rateLimits/updated`、`account/updated`、`account/login/completed` | 见 §5.3 的 `tokenUsage` 结构；`account/rateLimits/updated` 的 `rateLimits` 在 API key 登录下全是 null |
| MCP | `mcpServer/startupStatus/updated`、`mcpServer/oauthLogin/completed`、`mcpServer/event/stream/notification` | 每线程启动 MCP 时逐个 `ready`/`failed` |
| 配置告警 | `configWarning`、`deprecationNotice`、`error` | `configWarning` 实测在握手后立刻来一条（本次是 `mcp_servers.context7.type is ignored`）；TodeX 现在完全没消费，建议至少打日志 |
| 实时语音 | `thread/realtime/started|closed|error|sdp|itemAdded|item/started|item/completed|item/transcript/delta|transcript/delta|transcript/done|outputAudio/delta` | WebRTC SDP 协商在应用内的语音功能里 |
| 环境与文件 | `thread/environment/connected|disconnected`、`fs/changed`、`app/list/updated`、`skills/changed`、`project/changed` | `fs/changed` 只在 `fs/watch` 之后来 |
| 远程控制 | `remoteControl/status/changed` | 实测握手后就来一条 `{"status":"disabled","serverName":"<hostname>.local","installationId":"<uuid>","environmentId":null}` |

---

## 7. 服务端 → 客户端请求（11 个）

这些方法带 `id`，客户端必须回 `{"id": <同一 id>, "result": {…}}`。

| method | params |
| :-- | :-- |
| `item/commandExecution/requestApproval` | additionalPermissions=AdditionalPermissionProfile?, approvalId=str?, availableDecisions=[]?, command=str?, commandActions=[]?, cwd=LegacyAppPathString?, environmentId=str?, itemId*=str, kind=CommandExecutionApprovalKind, networkApprovalContext=NetworkApprovalContext?, proposedExecpolicyAmendment=[]?, proposedNetworkPolicyAmendments=[]?, reason=str?, startedAtMs*=int, threadId*=str, turnId*=str |
| `item/fileChange/requestApproval` | grantRoot=str?, itemId*=str, reason=str?, startedAtMs*=int, threadId*=str, turnId*=str |
| `item/tool/requestUserInput` | autoResolutionMs=int?, isBlocking*=bool, itemId*=str, questions*=[]ToolRequestUserInputQuestion, threadId*=str, turnId*=str |
| `mcpServer/elicitation/request` | serverName*=str, threadId*=str, turnId=str? |
| `item/permissions/requestApproval` | cwd*=LegacyAppPathString, environmentId=str?, itemId*=str, permissions*=RequestPermissionProfile, reason=str?, startedAtMs*=int, threadId*=str, turnId*=str |
| `item/tool/call` | arguments*=?, callId*=str, namespace=str?, threadId*=str, tool*=str, turnId*=str |
| `account/chatgptAuthTokens/refresh` | previousAccountId=str?, reason*=ChatgptAuthTokensRefreshReason |
| `attestation/generate` | — |
| `currentTime/read` | threadId*=str |
| `applyPatchApproval` | callId*=str, conversationId*=ThreadId, fileChanges*=obj, grantRoot=str?, reason=str? |
| `execCommandApproval` | approvalId=str?, callId*=str, command*=[]str, conversationId*=ThreadId, cwd*=str, parsedCmd*=[]ParsedCommand, reason=str? |

### 7.1 各请求的响应格式（协议 + 实测）

| 请求 | 客户端回包 |
| :-- | :-- |
| `item/commandExecution/requestApproval` | `{"decision": CommandExecutionApprovalDecision}`，见下 |
| `item/fileChange/requestApproval` | `{"decision": FileChangeApprovalDecision}` = `accept\|acceptForSession\|decline\|cancel` |
| `item/permissions/requestApproval` | `{"permissions": GrantedPermissionProfile*, "scope": "turn"(默认)|…, "strictAutoReview": bool?}`；`permissions` 逐项授予，全 null 视为拒绝（TodeX 的 `permissions_response_grants_anything` 已按此实现） |
| `item/tool/requestUserInput` | `{"answers": {"<questionId>": ToolRequestUserInputAnswer}}`（**对象不是数组**）；`params.questions[]` 里每项含 `id`、`header`、`question`、`options[]`、`isOther`、`isSecret` |
| `item/tool/call` | `{"contentItems": [...DynamicToolCallOutputContentItem], "success": bool}`（字段叫 `contentItems`，不是 `content`） |
| `mcpServer/elicitation/request` | `{"action": "accept|decline|cancel", "content": <结构化用户输入, 可空>, "_meta": <表单模式元数据, 可空>}` |
| `account/chatgptAuthTokens/refresh` | `{"accessToken*": "...", "chatgptAccountId*": "...", "chatgptPlanType": "..." | null}` |
| `attestation/generate` | `{"token*": "<x-oai-attestation>"}`（仅在 `capabilities.requestAttestation` 时才会来） |
| `currentTime/read` | `{"currentTimeAt*": <Unix 秒, int64>}`（字段名 `currentTimeAt`，秒不是毫秒） |
| `execCommandApproval` / `applyPatchApproval` | **v1 老审批接口**，仍在 `ServerRequest` 里；新流程不走它 |

`CommandExecutionApprovalDecision` 全枚举：

```json
"accept"
| "acceptForSession"
| {"acceptWithExecpolicyAmendment": {"execpolicy_amendment": ["<argv>", …]}}
| {"applyNetworkPolicyAmendment": {"network_policy_amendment": {…}}}
| "decline"   // 拒绝，本轮继续
| "cancel"    // 拒绝，并且立即中断本轮
```

`availableDecisions` 字段（在 `params` 里）给出本次**允许**的子集，客户端必须按它渲染。实测 read-only 沙箱下只给 `["accept", {"acceptWithExecpolicyAmendment":…}, "cancel"]`，没有 `decline`。

---

## 8. 核心数据结构与枚举

### 8.1 `Thread`（协议，实测字段齐）

`id`、`sessionId`、`forkedFromId`、`attachedToThreadId`、`parentThreadId`、`preview`、`ephemeral`、`section`、`sectionEnteredAt`、`projectId`、`historyMode`（`legacy|paginated`）、`modelProvider`、`model`、`reasoningEffort`、`createdAt`/`updatedAt`/`recencyAt`（**Unix 秒**）、`status`（`ThreadStatus`）、`path`（rollout 路径，`ephemeral` 时为 null）、`cwd`、`cliVersion`、`originator`、`source`、`canAcceptDirectInput`、`threadSource`、`agentNickname`、`agentRole`、`gitInfo`、`name`、`daybreakEnabled`、`turns[]`、`environments[]`、`extra`。

### 8.2 `Turn`（实测）

`id`、`rootTurnId`、`items[]`、`itemsView`（`notLoaded|summary|full`）、`status`（`completed|interrupted|failed|inProgress`）、`error`（`TurnError`）、`startedAt`/`completedAt`（**Unix 秒**）、`durationMs`。

### 8.3 `ThreadItem` 的 19 种（协议）

每个 item 都有 `id`，多数还有 `startedAtMs` / `completedAtMs`（**毫秒**，注意和 `Thread`/`Turn` 的秒不一致）。

| `type` | 其它字段 |
| :-- | :-- |
| `userMessage` | clientId=str?, content*=[]UserInput, id*=str |
| `hookPrompt` | fragments*=[]HookPromptFragment, id*=str |
| `agentMessage` | delivery=AgentMessageDelivery?, id*=str, memoryCitation=MemoryCitation?, moderation=AgentMessageModeration?, phase=MessagePhase?, questions=[]?, text*=str |
| `functionCallOutput` | id*=str, name*=str, namespace=str?, output*=FunctionCallOutputBody |
| `plan` | id*=str, text*=str |
| `reasoning` | content=[]str, id*=str, summary=[]str |
| `commandExecution` | aggregatedOutput=str?, command*=str, commandActions*=[]CommandAction, cwd*=LegacyAppPathString, durationMs=int?, exitCode=int?, id*=str, pluginId=str?, processId=str?, scriptPath=str?, source=CommandExecutionSource, status*=CommandExecutionStatus |
| `fileChange` | changes*=[]FileUpdateChange, id*=str, status*=PatchApplyStatus |
| `mcpToolCall` | appContext=McpToolCallAppContext?, arguments*=?, durationMs=int?, error=McpToolCallError?, id*=str, mcpAppResourceUri=str?, mcpAppUi=McpAppUi?, pluginId=str?, readOnlyHint=bool?, result=McpToolCallResult?, server*=str, status*=McpToolCallStatus, tool*=str |
| `dynamicToolCall` | arguments*=?, contentItems=[]?, durationMs=int?, id*=str, namespace=str?, status*=DynamicToolCallStatus, success=bool?, tool*=str |
| `collabAgentToolCall` | agentsStates*=obj, id*=str, model=str?, prompt=str?, reasoningEffort=ReasoningEffort?, receiverThreadIds*=[]str, senderThreadId*=str, status*=CollabAgentToolCallStatus, tool*=CollabAgentTool |
| `subAgentActivity` | agentPath*=str, agentThreadId*=str, id*=str, kind*=SubAgentActivityKind, model=str?, reasoningEffort=ReasoningEffort? |
| `webSearch` | action=WebSearchAction?, id*=str, query*=str, results=[]? |
| `imageView` | id*=str, path*=LegacyAppPathString |
| `sleep` | durationMs*=int, id*=str |
| `imageGeneration` | failure=ImageGenerationFailure?, generationId=str?, id*=str, inputImages=[]ImageGenerationInputImage, revisedPrompt=str?, savedPath=AbsolutePathBuf?, status*=str, transparentBackground=bool? |
| `enteredReviewMode` | id*=str, review*=str |
| `exitedReviewMode` | id*=str, review*=str |
| `contextCompaction` | id*=str |

TodeX 现在只把 `agentMessage`、`reasoning`、`commandExecution`、`fileChange`、`mcpToolCall`、`webSearch`、`collabAgentToolCall` 映射成前端事件（`provider/codex.rs` 的 `is_codex_tool_item` 一带），剩下 10 多种（`plan`、`dynamicToolCall`、`imageView`、`imageGeneration`、`sleep`、`subAgentActivity`、`functionCallOutput`、`enteredReviewMode`/`exitedReviewMode`、`contextCompaction`、`hookPrompt`）都落不到 UI 上。`plan` 和 `contextCompaction` 尤其值得补：前者是计划模式的 step，后者是自动压缩的落点（TodeX 的 `compact_session` 现在靠轮询 `item/completed` 里 `item.type == "contextCompaction"` 来判定完成，本身就是这个类型的第一个消费者）。

### 8.4 枚举

| 枚举 | 取值 |
| :-- | :-- |
| `SandboxMode`（用在 `thread/start.sandbox`、`thread/resume.sandbox`、`thread/fork.sandbox`） | `read-only` \| `workspace-write` \| `danger-full-access` |
| `SandboxPolicy`（`turn/start.sandboxPolicy`、`thread/settings/update.sandboxPolicy`、`command/exec.sandboxPolicy`） | `{"type":"dangerFullAccess"}` \| `{"type":"readOnly","networkAccess":bool}` \| `{"type":"workspaceWrite","writableRoots":[], "networkAccess":bool,"excludeTmpdirEnvVar":bool,"excludeSlashTmp":bool}` \| `{"type":"externalSandbox","networkAccess":"restricted|…"}` |
| `AskForApproval`（`approvalPolicy`） | `untrusted` \| `on-request` \| `never` \| `{"granular":{"rules":bool,"sandbox_approval":bool,"mcp_elicitations":bool,"request_permissions":bool?,"skill_approval":bool?}}` |
| `ApprovalsReviewer` | `user` \| `auto_review` \| `guardian_subagent`（legacy 兼容值） |
| `ReasoningEffort` | **开放字符串**（`minLength: 1`），取值由模型自述；`model/list` 返回 `supportedReasoningEfforts[]`，实测本机模型有 `low/medium/high/xhigh/max/ultra` |
| `ThreadStatus` | `{"type":"notLoaded"}` \| `{"type":"idle"}` \| `{"type":"systemError"}` \| `{"type":"active","activeFlags":["waitingOnApproval"|"waitingOnUserInput"]}` |
| `TurnStatus` | `completed` \| `interrupted` \| `failed` \| `inProgress` |
| `ThreadHistoryMode` | `legacy` \| `paginated` |
| `ModeKind` | `plan` \| `default` |
| `MessagePhase` | `commentary` \| `partial_answer` \| `final_answer`（可缺省 = 未知，历史模型可能不报） |
| `CommandExecutionStatus` | `inProgress` \| `completed` \| `failed` \| `declined` |
| `PatchApplyStatus` | `inProgress` \| `completed` \| `failed` \| `declined` |
| `McpToolCallStatus` | `inProgress` \| `completed` \| `failed` |

注意 `sandbox`（`SandboxMode`，字符串）和 `sandboxPolicy`（`SandboxPolicy`，带 `type` 的对象）是**两个不同的类型**，用错方法会得到 `Invalid request: data did not match any variant`。TodeX 的 `apply_turn_start_overrides` 会往 `turn/start` 里塞 `sandboxPolicy`——如果前端塞的是字符串 `"read-only"`，服务端会拒。

### 8.5 `model/list` 返回项（实测）

```json
{"id":"gpt-6.1-sol","model":"gpt-6.1-sol","upgrade":null,"upgradeInfo":null,
 "availabilityNux":{"message":"…"},
 "displayName":"GPT-6.1-Sol","description":"Latest workhorse model for coding and everyday work.",
 "modelSpecialty":null,"hidden":false,
 "supportedReasoningEfforts":[
   {"reasoningEffort":"low","description":"Fast responses with lighter reasoning"},
   {"reasoningEffort":"medium","description":"Balances speed and reasoning depth for everyday tasks"},
   {"reasoningEffort":"high","description":"Greater reasoning depth for complex problems"},
   {"reasoningEffort":"xhigh","description":"Extra high reasoning depth for complex problems"},
   {"reasoningEffort":"max","description":"Maximum reasoning depth for the hardest problems"},
   {"reasoningEffort":"ultra","description":"…"}],
 …}
```

TodeX 的 `provider/codex.rs:372` 已经在读 `supportedReasoningEfforts` / `defaultReasoningEffort`，字段名对得上。

### 8.6 `config/read` 返回（实测，字段裁剪）

```json
{"config":{
  "model":"gpt-6.1-sol","review_model":null,"model_context_window":272000,
  "model_auto_compact_token_limit":null,"model_provider":"custom",
  "approval_policy":null,"approvals_reviewer":null,"sandbox_mode":null,
  "sandbox_workspace_write":null,"forced_chatgpt_workspace_id":null,
  "forced_login_method":null,"web_search":null,"client_search_provider":null,
  "tools":null,"instructions":null,"developer_instructions":null,"compact_prompt":null,
  "model_reasoning_effort":"low","model_reasoning_summary":null,"model_verbosity":null,
  "service_tier":null,"analytics":null,"apps":null,"browser_use":null,"computer_use":null,
  "desktop":{"conversationDetailMode":"STEPS_COMMANDS","followUpQueueMode":"steer"},
  "mcp_servers":{"context7":{"url":"https://mcp.context7.com/mcp","http_headers":{…}}}
}}
```

注意这里有**三套命名**：

1. `config/read` 的返回、`config.toml`、`-c key=value` 全是 **snake_case**（`model_reasoning_effort`、`sandbox_mode`、`mcp_servers.*`）。
2. 绝大多数请求参数是 **camelCase**（`approvalPolicy`、`sandboxPolicy`、`effort`、`threadId`）。
3. 只有 `CollaborationMode.settings` 里的字段是 **snake_case**（`reasoning_effort`、`developer_instructions`）——这是 0.169 里唯一一处例外。

TodeX 的对应处理目前是对的：`provider/codex.rs:658/687` 用 `{"config":{"model_reasoning_effort": effort}}` 走 snake_case 覆盖；`codex_gateway/mod.rs:2983` 在 `collaborationMode.settings` 里把 `reasoningEffort` 翻成 `reasoning_effort`；`provider/codex.rs:810` 的 `codex_configuration_event` 从响应里读 camelCase 再转成自己的 UI 事件。这三处别混。

---

## 9. 其他可调用的接口

除了 app-server，Codex 还暴露了 5 条独立通道。按对 TodeX 的实用度排序。

### 9.1 `codex exec --json`（非交互 JSONL，实测）

```
codex exec --json --skip-git-repo-check -s read-only -C /tmp "Reply with exactly: ok"
```

stdout 是 JSONL，**v1 风格的事件名**（点号分隔，和 app-server 的斜杠命名不是一套）：

```
{"type":"thread.started","thread_id":"01a1e7eb-61ba-7992-88ea-037977daa458"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Codex is ignoring 1 unrecognized configuration setting. …"}}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"ok"}}
{"type":"turn.completed","usage":{"input_tokens":20121,"cached_input_tokens":14336,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}
```

要点：

- item 类型是 **snake_case**（`agent_message`），app-server 是 camelCase（`agentMessage`）。
- `usage` 是**累计值**，不是增量，字段名 snake_case。
- 本次实测只看到 `thread.started` / `turn.started` / `item.completed` / `turn.completed` 四种；普通问答下**没有** `item.started`（app-server 那条链路才有）。
- 从 stdin 读补充输入（有管道时会打 `Reading additional input from stdin...` 到 stderr），TodeX 如果用管道喂 prompt，要显式处理这个交互。

### 9.2 `codex queue` / `archive` / `delete` / `fork` / `resume`（实测 help）

```
codex queue --thread <UUID|name> --message <TEXT> [--resume] [--remote <ADDR>]
```
走的是 `~/.codex/ipc/ipc.sock`（或 `--remote` 的 WebSocket），**不是** app-server 的 `thread/queue/add`。两者是不同实现：CLI 的 `queue` 只在「已有本地会话」时可用，app-server 的 `thread/queue/add` 是会话内的排队消息（见 §4.2）。

### 9.3 `codex exec-server`（WebSocket 远程执行面）

```
codex exec-server --listen ws://IP:PORT      # 默认 ws://
codex exec-server --listen stdio|stdio://
codex exec-server forward <existing-ws>      # 把已存在的 WS exec-server 注册成「远程环境」
```

认证 / 注册相关参数：

| 参数 | 说明 |
| :-- | :-- |
| `--ws-auth capability-token \| signed-bearer-token` | 入站 WS 鉴权模式 |
| `--ws-token-file` / `--ws-token-sha256` / `--ws-shared-secret-file` | token 来源 |
| `--ws-issuer` / `--ws-audience` / `--ws-max-clock-skew-seconds` | JWT 校验 |
| `--remote <URL>` + `--remote-transport noise\|direct` + `--environment-id` + `--name` | 注册成远程环境 |
| `--use-agent-identity-auth` / `--registration-bearer-stdin` / `--executor-credential-stdin` | 凭据注入（**从 stdin 读，不进命令行**） |
| `--chatgpt-token-stdin` / `--chatgpt-account-id` | ChatGPT 身份 |
| `--aws-sigv4` / `--aws-profile` / `--aws-region` / `--aws-service` | AWS 签名 |
| `--concurrent-requests <COUNT>` / `--exit-on-stdin-close` | 并发与会话生命周期 |

实测：`ws://127.0.0.1:8790` 上 `GET /readyz` → `200`，`GET /healthz` → `404`，`GET /` → `400`（要 upgrade）。二进制里能看到 `noise_relay::executor_stream`、`relay`、`remote::registration_retry`、`capability_discovery`、`shell_snapshot::credentials`、`fs_sandbox`、`process_sandbox`——**它是带 Noise 加密和注册协商的远程执行网格，不是简单的 shell RPC**。TodeX 现在没有对应能力，如果要做「远端机器当执行环境」可以对接，但要先把 Noise 握手和注册流程逆出来，成本不低。

### 9.4 `codex-code-mode-host`（gRPC，二进制）

`Contents/Resources/codex-cli/bin/codex-code-mode-host`，`app-server` 的 `--code-mode-host <URL>` 就是连它。

```
codex-code-mode-host --listen stdio|stdio://|grpc+stdio://|grpc://IP:PORT   # 默认 stdio
                     --otel-trace-listen <URL> --otel-trace-exporter <URL>
```

实测 `--listen grpc://127.0.0.1:8791` 起来后是一个 **HTTP/2 gRPC 服务**（`POST /x` 回 `HTTP/2 200`、`content-type: application/grpc`、`grpc-status: 12`）。

从二进制里能读出的协议骨架（**二进制**，未逐个调用验证）：

- gRPC service：`codex.code_mode.v1.CodeModeHost`；方法 `OpenSession`、`Execute`、`Wait`、`CloseSession`、`Terminate`。
- 请求体：`OpenSessionRequest{cell_execution_limits, output_truncation, max_pending_delegate_calls}`、`ExecuteRequest{source, tool_call_id, enabled_tools[], execution_id, max_output_tokens}`、`WaitRequest{cell_id, wait_id, yield_time_ms, max_output_tokens}`、`CloseSessionRequest`、`TerminateRequest`、`CancelWaitRequest`、`CompleteToolCallRequest{invocation_id, outcome, observation}`、`YieldObservationRequest`。
- 线级消息（internally tagged）：`HostRequest` = `session/open|session/execute|session/wait|session/terminate`；`ClientToHost` = `operation/request|operation/yield|delegate/response|tool/invoke|notification/send`；服务端事件 `session/ready`、`execution/started`、`wait/completed`、`execute/initialResponse`、`delegate/cancel`、`cell/closed`、`session/closed`、`tool/result`、`notification/delivered`、`connection/rejected{reason: noCompatibleVersion|missingRequiredCapability|invalidHello}`。
- 协商：首帧必须是 `connection/hello`（`ClientHelloWire{version, capabilities[], maxYieldTimeMs}`）；能力字符串有 `session-cell-execution-resource-limits`、`yield-observation`、`bounded-output-v1`、`delegate-capacity-4096`。
- stdio 模式用 **u32 长度前缀**（错误串 `code-mode IPC frame length exceeds u32`）。

### 9.5 深链 `codex://`（源码 + Info.plist 实测）

`ChatGPT.app/Contents/Info.plist` 注册了 `codex`、`http`、`https` 三个 scheme（`http`/`https` 是为了接 OAuth 回调）；开发版把协议名换成 `codex-dev:`。

路由表（源码 `early-bootstrap-631` 的 `F()` + `$()`）：

| URL | kind | 外部是否接受 |
| :-- | :-- | :-- |
| `codex://health` | `health` | 接受（额外参数只允许 `tab`） |
| `codex://launch` | `launch` | 接受（不能带 query） |
| `codex://dots` | `dotsHome` | 接受（不能带 query） |
| `codex://threads/new?prompt=<urlencoded>` 或 `codex://new?prompt=…` | `newThread` | 接受，**且只允许 `prompt` 一个 query 参数** |
| `codex://threads/<uuid>` | `localConversation` | 接受，**query 只允许 `hostId`、`view`、`diffFilter`、`path`、`threadAccess=shared`** |
| `codex://settings[/<path>]`，如 `codex://settings/connections` | `settings` | 接受（不能带 query；`personal-vault`、`computer-use/*` 白名单） |
| `codex://plugins/<plugin_id>?…` | `pluginDetail` | 接受（额外参数只允许 `hostId`） |
| `codex://review?pr=<PR_URL>&path=<FILE>&line=<N>&side=right` | `codeReview` | **拒绝**（只能应用内触发） |
| `codex://shared-thread?utm_source=…` | `sharedCodexSnapshot` | **拒绝** |
| `codex://space`、`codex://sites/edit`、`codex://automation(s)`… | 各自 kind | `space`/`team`/`automations` 接受，其余见下 |
| `codex://threads/<uuid>/wake`（唤醒排队会话） | `wakeQueuedThread` | **拒绝** |

「拒绝」的意思是：主进程的 `B()` 谓词返回 `false`，不会当成外部深链处理（只有应用内部导航能用）。

另有一条「把普通链接转成深链」的转换函数（`h(e)`）：外部 https 链接带 `source=`、`target=launch|dots`、`plugin_id=`、`codex_thread_id=`、`q=`、`mode=`、`fallback=work`、`hostId=`、`browserUrl=` 时会被规整成对应的 `codex://` 路由；`source=cli-login` 直接丢弃（避免 CLI 登录回调被当成导航）。

对 TodeX 的实际用法：

- 「在 Codex 桌面应用里把这个会话打开」→ `open "codex://threads/<native_session_id>"`。只带 `hostId`/`path`/`view` 这类定位参数，**不能带 prompt**。
- 「让桌面应用从某个 prompt 起一个新会话」→ `open "codex://threads/new?prompt=<urlencoded>"`。
- 深链只能**单向打开**，拿不到任何执行结果；要结果仍然得连 app-server。

### 9.6 已删除的 `codex mcp-server`（实测）

早期版本有 `codex mcp-server`（把 Codex 自己当成 MCP server 暴露给别的客户端）。实测 **0.167.0 和 0.169.0-alpha.11.1 都没有**这个子命令：`codex mcp-server --help` 会被当成「无子命令 + prompt」交给交互式 CLI，打印的是顶层 usage。二进制里也查不到 `mcp-server` 字符串（§11.6）。要「把 Codex 当工具给别的 agent 用」，现在的路径是：

- 别的客户端直接说 app-server JSON-RPC（本文档），或
- 用桌面应用里 `codex_app` 这个内置 MCP server（`mcpServerStatus/list` 里名字是 `codex_app`，`pluginId: codex-app-tools@openai-bundled`，`authStatus: unsupported`）——它是应用内的 MCP 端点，通过 `CODEX_APP_TOOLS_PIPE_PATH` 的命名管道通信，外部接不进去。

### 9.7 Electron IPC（源码，外部不可用）

`preload.js` 通过 `contextBridge.exposeInMainWorld("electronBridge", …)` 暴露的通道：

```
（invoke）codex_desktop:message-from-view      codex_desktop:connect-git-worker
          codex_desktop:worker:<name>:from-view  codex_desktop:show-context-menu
          codex_desktop:get-fast-mode-rollout-metrics
（send） codex_desktop:chunked-message-ack     codex_desktop:start-link-drag
          codex_desktop:network-online          codex_desktop:connect-app-host（带 MessagePort）
          codex-shared-texture-create
（sendSync）codex_desktop:get-sentry-init-options  codex_desktop:get-build-flavor
          codex_desktop:get-system-theme-variant codex_desktop:take-initial-switch-status
          codex_desktop:get-initial-sidebar-bootstrap codex_desktop:start-file-drag
（main→renderer）codex_desktop:message-for-view  codex_desktop:worker:<name>:for-view
          codex_desktop:system-theme-variant-updated
          codex_desktop:mcp-app-sandbox-host-message
          codex_desktop:remote-hosted-pip-video-frame
          codex_desktop:git-worker-port
```

只有同一进程里的 renderer 能用（`ipcRenderer` 不出沙箱），外部程序没有入口。**不要在 TodeX 里尝试驱动这些。**

### 9.8 `~/.codex/ipc/ipc.sock`（源码 + 二进制）

CLI 的 `queue`/`archive`/`delete`/`fork` 和桌面应用主进程共用的一个轻量 IPC：

- 帧格式：**4 字节小端 uint32 长度 + UTF-8 JSON**，单帧上限 `0x10000000`（256 MiB）。是**长度前缀，不是换行分隔**——写成 NDJSON 会立刻被断开。
- 路径：`$CODEX_HOME/ipc/ipc.sock`（`sun_path` 太长时切到 `/private/tmp/codex-ipc/ipc-<uid>.sock`，并在 `/private/tmp/codex-ipc-<uid>/<sha256>` 放符号链接指向原目录）。
- 权限：目录 `0700`、socket `0600`，且**强制校验属主**（`Codex IPC directory is not owned by the current user` / `Codex IPC socket is not owned by the current user`）。
- Windows：命名管道 `\\.\pipe\codex-ipc`。
- 已知方法（源码）：`thread-stream-state-changed`、`thread-stream-following-changed`、`thread-stream-following-status-requested`（广播类，载荷里有 `change.type` = `snapshot|patches`）。注意这三个字符串在 **CLI 二进制里查不到**（IDA `find` 命中 0），它们只存在于桌面应用的 JS 里——所以它们属于「桌面主进程 ↔ 渲染进程」的转发层，不是 app-server 的方法。其余方法名在 CLI 二进制里。
- 同一份代码里还有一条 **IDE 上下文 socket**（二进制确认，字符串 `ide-context`、`ipc-0.sock`、`sourceClientId`、`codex-tui`、`workspaceRoot`、`failed to fill whole IDE context frame`、`IDE context socket is not owned by the current user`）：这是 IDE 插件 ↔ `codex-tui` 之间传递工作区上下文的通道，同样是「4 字节长度 + JSON」帧。TodeX 不需要它，但排查「IDE 集成不工作」时会用到。

**实测**：本次机器上 `~/.codex/ipc/ipc.sock` 存在但是**陈旧 socket**（`ECONNREFUSED`），因为当时桌面应用没在跑。只有当桌面应用或某个 CLI 会话进程活着时才有监听者。

### 9.9 `~/.codex/config.toml` 与 `-c` 覆盖

- 所有 `codex` 子命令都接受 `-c key=value`（可重复），值按 TOML 解析，解析失败就当年字面量。
- `--strict-config` 让未识别字段直接报错（默认只打 `configWarning`）。
- 和协议相关的几个：

| 键 | 作用 |
| :-- | :-- |
| `features.code_mode_host = true` | 打开 code-mode，桌面应用起 app-server 时默认带上 |
| `features.<name>` | 实验开关，`codex features list` / `--enable` / `--disable` 同源；实测 `experimentalFeature/list` 返回 `daemon_auto_start`（默认 true）等 |
| `desktop.conversationDetailMode = "STEPS_COMMANDS"` | 会话详情粒度（桌面端） |
| `desktop.followUpQueueMode = "steer"` | 追问走 steer 还是排队 |
| `mcp_servers.<name>` | MCP 配置；**0.169 去掉了 `type` 字段**，写了会报 `` `mcp_servers.context7.type` is ignored `` |
| `analytics` | app-server 的 `--analytics-default-enabled` 只影响 daemon 场景 |

`config/read` 返回的键是 snake_case（`model_reasoning_effort`、`sandbox_mode`），而请求参数是 camelCase。这是 TodeX 需要长期注意的命名分裂。

---

## 10. TodeX 现状对照与改进建议

按「改动能带来多少收益」排序。每条都标了当前的代码位置和对应协议依据。

> **2026-11-17 复核**（对照 `TodeX_backend` 代码）：
>
> - **线上只有 `provider/codex.rs` 这一条链路**：桌面、Web、移动端的聊天都走 `/v2/conversations` + `/v2/ws` 的 `conversation.*`。`codex_gateway`（`codex.local.*`）没有任何客户端在发，后端自己称之为旧网关，只剩历史回放和真机 e2e 在用。下文 §10.3、§10.6、§10.11 中针对 gateway 的部分对用户没有实际影响。
> - 下文说 TodeX「没用」的几项，provider 链路其实已经在用：`turn/start` 顶层 `effort`、对象形式的 `sandboxPolicy`（§10.5、§10.6）、`turn/settings/update`（§10.10）、`thread/queue/*`（§10.9）、`thread/goal/*`、`approvalsReviewer: "auto_review"`、`capabilities.experimentalApi`。`provider/codex.rs` 的审批也早已支持 `acceptForSession` 与 `cancel`（选项 `allow_always`、`abort_turn`）。
> - 已落地：§10.2（`initialize` 的 `optOutNotificationMethods` 退订 TodeX 不用的通知，5 处握手共用一份请求）；§10.3 的 provider 部分（命令审批的选项按 `availableDecisions` 生成，只允许 `cancel` 时拒绝回 `cancel`；不提供会写入用户规则的 amendment 决策）；§10.4（`configWarning` / `deprecationNotice` / `warning` / `guardianWarning` 与自动审查结论显示为会话里的提示行，`providerMethod` 为 `provider_warning` / `auto_review`）；`currentTime/read` 由 daemon 直接回复；客户端对未知推理强度显示其原名，Codex 强度列表补上 `ultra`。契约见 `TodeX_backend/docs/API.md`。
> - 仍未做：§10.1 共享 daemon / `unix://` 传输、§10.7–10.9 的 `command/exec`、`fs/*`、分页历史，以及计划步骤条 UI（后端已发 `plan.updated`，客户端尚未渲染）。

### 10.1 一条常驻 app-server 代替「每会话一个进程」

**现状**：`provider/codex.rs:59` 把 Codex 声明成 `ProcessModel::Resident { idle: 300s, max_sessions: 64 }`，实际做法是**每个会话 spawn 一个 `app-server --listen stdio://`**（`provider/codex.rs:206`、`codex_gateway/mod.rs:1716`）。64 个并发会话就是 64 个 268 MB 的进程，每个进程各有一份模型清单缓存、MCP 客户端、技能索引。

**协议依据**：`app-server` 本身就是多线程的——`thread/start` 带 `cwd`，一个进程里可以并存任意多个 thread，每个 thread 有自己的沙箱策略、模型、MCP 开关；`thread/list`、`thread/loaded/list`、`thread/unsubscribe` 就是为多会话设计的管理面。`codex app-server daemon start` 官方就是这么用的：一个 daemon 服务整台机器。

**建议**：保留「每会话一个进程」作为兜底（用户配置敏感、需要完全隔离时），加一条「共享 daemon」路径：

1. 首次需要时 `app-server --listen unix://<CODEX_HOME>/app-server-control/app-server-control.sock`（或者干脆 `daemon start`），连 WebSocket。
2. 每个 TodeX 会话 `thread/start`（`cwd` 用自己的 workspace，`config` 覆盖自己的 MCP），拿到 `threadId`。
3. 会话结束 `thread/unsubscribe`（不是 `thread/delete`，保留历史）。
4. 空闲 TTL 到期再 `daemon stop`。

**收益**：进程数从 N 降到 1；MCP 连接、技能索引、模型清单只加载一次；切会话不用等 spawn。

**风险**：`CODEX_HOME`、`config.toml` 是 daemon 级的；daemon 崩了会影响所有会话；一个会话的 MCP server 崩溃可能影响同进程内其它 thread（`mcpServer/startupStatus/updated` 是 per-thread 的，说明这一层已经隔离）。

### 10.2 `optOutNotificationMethods` 静音 80% 的通知

**现状**：`codex_gateway/mod.rs:2466` 的 `codex_initialize_request` 已经带上了 `"optOutNotificationMethods": null`——字段占位有了，但值是 null，等于没开。

**协议依据**：`capabilities.optOutNotificationMethods` 是「精确方法名列表」，命中的通知服务端根本不发。

**建议**：按 TodeX 真正消费的事件集算一个白名单。以实测的 14 条一轮为例，至少可以砍掉：

```json
["mcpServer/startupStatus/updated",
 "account/rateLimits/updated",
 "turn/moderationMetadata",
 "remoteControl/status/changed",
 "model/safetyBuffering/updated"]
```

`item/agentMessage/delta` 这类**绝对不能**进列表（TodeX 靠它做流式）。

注意 `configWarning` 建议**不要**静音，而是真的渲染出来——本次取证的机器上它一直在报 `mcp_servers.context7.type` 被忽略，用户完全不知情。

### 10.3 审批：按 `availableDecisions` 渲染，补齐 `cancel` / `acceptForSession` / 对象决策

**现状**：

- `codex_gateway/mod.rs:4230 approval_outcome_from_response` 只认 `accept*` 和 `deny|decline`，其余报 `unknown CodeX approval decision`。
- `provider/codex.rs:1595` 单独把 `AllowAlways → acceptForSession` 映射了，但只在 `provider/codex.rs` 这条路径生效。
- `availableDecisions` 字段**完全没读**。

**协议依据**：见 §7.1。决策是 6 个值（其中 2 个是对象），而且 `params.availableDecisions` 明确告诉客户端这一次允许哪几个子集。

**建议**：

1. `CodexApprovalOutcome` 扩成 `Accepted | AcceptedForSession | AcceptedWithAmendment | Declined | Cancelled`。
2. 审批事件往上带 `availableDecisions`，前端按它渲染按钮（这次只有 `accept` / `acceptWithExecpolicyAmendment` / `cancel`，就别显示「拒绝」）。
3. `cancel` 走「中断本轮」的现有路径（`turn/interrupt` 不用手动发，服务端自己会中断）。
4. 对象型决策原样回传：`{"id":0,"result":{"decision":{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":[...]}}}}`。
5. `decline` 和 `cancel` 在 UI 上必须分开——一个是「这条命令不行，你换个办法」，一个是「整轮别干了」。

### 10.4 `auto_review` 已经接上了，缺的是配套的三条通知

**现状**：`provider/types.rs:817` 已经有

```rust
approvals_reviewer: Some(if mode == "auto" { "auto_review" } else { "user" }.to_owned()),
```

也就是说 TodeX 的 `permission_mode = auto` **已经**把 `approvalsReviewer: "auto_review"` 发给 app-server 了，这一点是对的（早期版本可能靠 `--approve-for-me` 之类模拟，现在不需要）。

**缺的是消费侧**：`auto_review` 生效时服务端会发 `item/autoApprovalReview/started` / `item/autoApprovalReview/completed`（带上子代理的判定过程）和 `autoApprovalReview/strictReviewRequired`（风险太高、必须人来看）。这三个方法名在 `provider/codex.rs` 和 `codex_gateway/mod.rs` 里**都查不到**（IDA 也确认字符串在二进制里，见 §11.6），所以：

- UI 上「自动审批中…」这个状态只能从 `thread/status/changed.activeFlags` 间接推，推不准；
- `strictReviewRequired` 这类「自动审查拒绝、需要人兜底」的请求现在会落到普通审批流程里，用户不知道为什么突然要自己点。

**建议**：

1. 把这三条通知映射成前端事件（`approvalReview.started` / `approvalReview.completed` / `approvalReview.strictReviewRequired`）。
2. `completed` 里带判定结果，可以显示「自动批准（风险：低）」这种标签，让用户知道刚才那条命令是被谁放行的。
3. 顺带把 `AskForApproval` 的 `granular{ rules, sandbox_approval, mcp_elicitations, request_permissions, skill_approval }` 暴露出来——现在的三值枚举（`untrusted|on-request|never`）表达不了「沙箱越界要问、MCP 表单不问」这种组合。

### 10.5 `turn/start` 的顶层 `effort` 字段

**现状**：`provider/codex.rs:657/686` 用 `{"config":{"model_reasoning_effort": effort}}`；`codex_gateway/mod.rs:2983` 走 `collaborationMode.settings.reasoning_effort`。

**协议依据**：`TurnStartParams` 有顶层 `effort: ReasoningEffort`，`ThreadSettingsUpdateParams` 也有 `effort`；`CollaborationMode` 的 `settings` 只在「用预设协作模式」时才需要（而且 `collaborationMode` 的注释写着 "Takes precedence over model, reasoning_effort, and developer instructions if set"）。`ReasoningEffort` 已经不是枚举而是**开放字符串**，合法值来自 `model/list` 的 `supportedReasoningEfforts[]`（实测有 `low/medium/high/xhigh/max/ultra`）。

**建议**：

- 单纯改推理强度用 `turn/start.effort`，不要绕 `config`，也不要绕 `collaborationMode`。
- 需要「预设模式」才带 `collaborationMode`，并且只带 `{mode, settings:{reasoning_effort, developer_instructions}}`。
- 前端强度下拉必须**按 `model/list` 动态渲染**，别硬编码枚举——`ultra` 这种值是新增的。

### 10.6 `sandbox` 与 `sandboxPolicy` 别混

**现状**：`codex_gateway/mod.rs` 的 `apply_turn_start_overrides` 往 `turn/start` 里塞 `sandboxPolicy`；如果上游给的是字符串 `"read-only"`（TodeX 的 `SandboxMode` 表示），服务端会以 `Invalid request: data did not match any variant of untagged enum …` 拒掉。

**协议依据**：`thread/start|resume|fork.sandbox` 是 `SandboxMode`（字符串），`turn/start.sandboxPolicy`、`thread/settings/update.sandboxPolicy`、`command/exec.sandboxPolicy` 是 `SandboxPolicy`（`{"type":"readOnly"|"workspaceWrite"|"dangerFullAccess"|"externalSandbox", …}`）。两套类型同时存在于这个协议里，是本版本最容易踩的坑之一。

**建议**：在 `codex_gateway` 里加一层归一化——字符串入参自动转成 `{"type": …}`，并给 `workspaceWrite` 补上 `writableRoots` / `networkAccess` / `excludeTmpdirEnvVar` / `excludeSlashTmp` 的默认值。

### 10.7 `command/exec`：不开会话的结构化 shell

**现状**：TodeX 需要「在项目的执行环境里跑一条命令」时，要么起一个 agent 轮次，要么在宿主上直接 exec 子进程（绕开了 Codex 的沙箱）。

**协议依据**：`command/exec` 是**稳定方法**，`{command: [argv…], cwd, timeoutMs}` → `{exitCode, stdout, stderr}`；`tty: true` + `processId` 走流式（`command/exec/outputDelta` + `command/exec/write|resize|terminate`）。它跑在 app-server 所在机器的**服务端沙箱**里，用的就是当前用户的 `sandboxPolicy` / `permissionProfile`。

**建议**：TodeX 里所有「执行一条不需要模型的命令」的场景（打开文件行数统计、跑 git status、执行 hook 脚本、给用户看「这条命令会怎么跑」）都改走 `command/exec`。这样：

- 输出是结构化的，不用自己拼 stderr；
- 沙箱策略和 agent 完全一致，不会出现「agent 跑不了但 TodeX 能跑」的错觉；
- 超时/输出上限由服务端兜底（`timeoutMs`、`outputBytesCap`）。

注意 `command` 是 **argv 数组**，不是 shell 字符串；需要 shell 语义就自己套 `["/bin/sh","-lc", script]`。

### 10.8 `fs/*`：文件的「服务端视图」

**现状**：TodeX 的本地文件 API 直接读宿主文件系统。

**协议依据**：`fs/readFile`、`fs/writeFile`、`fs/createDirectory`、`fs/getMetadata`、`fs/readDirectory`、`fs/remove`、`fs/copy`（都稳定），`fs/watch` / `fs/unwatch`（实验性，之后会发 `fs/changed`）。

**建议**：文件树、diff 预览这类「要和 agent 看到的一致」的读取走 `fs/*`；用户自己的仓库管理（提交、撤销）继续走宿主。`fs/watch` 可以替掉 TodeX 现在的轮询式文件监听。

### 10.9 历史与队列：`thread/items/list` / `thread/queue/*`

**现状**：TodeX 恢复会话靠 `thread/resume` 全量拿，接入多轮后内存压力大。

**协议依据**：

- `thread/turns/list`（`limit`、`cursor`、`sortDirection`、`itemsView`）和 `thread/items/list`（`turnId`、`cursor`、`limit`、`deferOutput`）是分页读取；`thread/read` 带 `includeTurns: false` 只读元数据。
- `thread/queue/add|list|update|delete|reorder|start`（实验性）是**服务端排队**：`{threadId, clientUserMessageId, input[]}`。桌面端的 `desktop.followUpQueueMode = "steer"` 就是决定「追问是直接 steer 还是进队列」。

**建议**：会话打开时 `thread/read{includeTurns:false}` + `thread/turns/list{limit:20}`，滚动再拉；「排队消息」用 `thread/queue/*` 而不是自己在 TodeX 里维护队列（否则 Codex 桌面端和 TodeX 会各排各的）。

### 10.10 `turn/settings/update`：运行中改强度/模型

**协议依据**：`TurnSettingsUpdateParams{threadId*, turnId*, effort?, model?, serviceTier?, summary?, approvalsReviewer?, environments?}`，注释写明「只影响这一个正在跑的 turn，未来 turn 不变；不支持的字段会被拒绝而不是静默忽略」。

**建议**：UI 上「这一轮太慢了，降一档」这种操作可以直接发它，不用中断重开。

### 10.11 `provider/codex.rs` 与 `codex_gateway` 两套实现应当合并

**现状**：两条链路各自 spawn app-server、各自维护方法映射、各自解析审批：

| 能力 | `provider/codex.rs` | `codex_gateway/mod.rs` |
| :-- | :-- | :-- |
| spawn | `app-server --listen stdio://` | 同 |
| 方法映射 | 直接写死调用 | `codex_method_to_request_type` 双向映射 |
| 审批决策 | `AllowAlways → acceptForSession` | 只认 accept/deny |
| `phase` 处理 | 有（`assistant_progress` / `assistant_final`） | 无 |
| 服务端请求 | 只处理命令/文件/权限 | 6 类全处理 + `serverRequest/resolved` |
| 方法名覆盖 | 26 个 | 23 个 |

同一个协议被实现两遍，行为已经开始分叉（例如同一份 `availableDecisions` 在两条路径上表现不同）。**建议把 protocol 层抽成一个 crate 内的共享模块**（方法名、封套、审批决策、item 类型各一份常量与类型），两条路径只保留各自的编排。

### 10.12 其他小项

| 项 | 依据 | 建议 |
| :-- | :-- | :-- |
| v1 老方法 | 实测 `getAuthStatus` / `getConversationSummary` / `gitDiffToRemote` 仍接受 | 检查是否有调用点，迁到 `account/read` / `thread/list` / `thread/read` |
| `codex mcp-server` | 0.169 已删除 | 检查打包脚本/文档里是否还提到 |
| `mcp_servers.<name>.type` | 实测被忽略并报 `configWarning` | TodeX 的 `mcp_injection::codex_config` 没写 `type`，安全；但用户 `config.toml` 里可能有，建议把 `configWarning` 显示给用户 |
| `item/reasoning/*` | 协议有 `textDelta` / `summaryTextDelta` / `summaryPartAdded` 三条流 | `provider/codex.rs` 已经消费前两条，`codex_gateway` 一条都没有——gateway 路径上思考过程没有增量渲染 |
| `plan` item + `turn/plan/updated` | 计划模式 | 用于计划模式的步骤条 |
| `contextCompaction` item | `compact_session` 靠它判完成（`provider/codex.rs:243`），并且已映射成 `compaction.started/completed`（`:1272`） | 保持；注意它同时也会发 `thread/compacted` 通知 |
| `thread/status/changed` 的 `activeFlags` | `waitingOnApproval` / `waitingOnUserInput` | 用它驱动「等待审批」状态，比推断审批事件更准 |
| `userAgent` / `codexHome` / `platformFamily` / `platformOs` | `initialize` 返回 | 用来在 UI 上显示「当前 Codex 版本/平台」，排查用户环境问题 |

---

## 11. 附录

### 11.1 如何自己复现本文的协议导出

```bash
CLI=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex
$CLI --version            # codex-cli 0.169.0-alpha.11.1

# 完整协议（含实验性）：1 个 ClientRequest + ServerNotification + ServerRequest
$CLI app-server generate-json-schema --experimental --out /tmp/codex-schema

# 稳定协议（109 个方法）
$CLI app-server generate-json-schema --out /tmp/codex-schema-stable

# TypeScript 绑定（给前端用）
$CLI app-server generate-ts --experimental --out /tmp/codex-ts
```

导出物里有用的文件：

| 文件 | 内容 |
| :-- | :-- |
| `ClientRequest.json` | 184 个方法的 `method` 常量 + `params` 的 `$ref` |
| `ServerNotification.json` | 86 个通知 |
| `ServerRequest.json` | 11 个服务端请求 |
| `ClientNotification.json` | 只有 `initialized` |
| `codex_app_server_protocol.v2.schemas.json` | 864 个类型定义（v2，绝大多数结构在这里） |
| `codex_app_server_protocol.schemas.json` | 混合版（v1 + v2） |
| `<Method>Params.json` / `<Method>Response.json` | 每个交互式请求/响应的独立 schema |

### 11.2 如何自己起一个可连的 app-server

```bash
# 1) 直接跑一个独立实例（不碰用户的 daemon）
codex app-server --listen unix:///tmp/codex-test.sock
#    这是个 WebSocket over UDS，用任意 WS 客户端连 socket 路径

# 2) 或者走守护进程
codex app-server daemon start
codex app-server daemon version   # {"status":"running", ...}
codex app-server daemon stop

# 3) 或者 WS + HTTP 探针（调试友好）
codex app-server --listen ws://127.0.0.1:8765
curl -i http://127.0.0.1:8765/readyz
curl -i http://127.0.0.1:8765/healthz
```

最小握手（WebSocket 文本帧）：

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"my-client","version":"1.0.0"},"capabilities":{"experimentalApi":true}}}
{"method":"initialized"}
```

### 11.3 用未知方法拿「官方方法表」

最快确认某个版本支持哪些方法：连上去发一个不存在的方法，`error.message` 会把**全部合法方法名**列出来。

```json
→ {"id":11,"method":"does/not/exist","params":{}}
← {"error":{"code":-32600,"message":"Invalid request: unknown variant `does/not/exist`, expected one of `initialize`, `server/diagnostics`, …"},"id":11}
```

本版实测 188 个（184 个在 schema 里 + 3 个 v1 遗留 + 探针那个）。

### 11.4 版本差异提示

本文只对 **`codex-cli 0.169.0-alpha.11.1`**（`ChatGPT.app` 26.1111.21308 里打包的那份）负责。用户机器上另外装的 `codex-cli 0.167.0`（Homebrew）实测对比（两边都跑 `generate-json-schema --experimental`）：

| 对比项 | 0.167.0 | 0.169.0-alpha.11.1 |
| :-- | :-- | :-- |
| `ClientRequest` 方法数 | 180 | 184 |
| 0.169 新增 | — | `thread/prepareApprovedPlan`、`modelProvider/list`、`modelProvider/config/write`、`account/securitySetup/read` |
| 0.169 移除 | 无 | 无（0.167 的方法 0.169 全有） |
| `AskForApproval` `granular` | 有 | 有 |
| `ApprovalsReviewer` `auto_review` | 有 | 有 |
| `TurnStartParams.effort` | 有 | 有 |
| `codex mcp-server` | 无 | 无 |
| `mcp_servers.<name>.type` | **接受**（`--print-startup-config` 无告警） | **忽略并告警** |
| `app-server daemon` / `proxy` | 有 | 有 |

结论：**两个版本的协议面几乎一致**（184 vs 180，只差 4 个新方法），真正会咬人的差异只有 `mcp_servers.<name>.type` 这一个配置字段的语义变化。TodeX 如果同时支持两个版本，探测方式用 `initialize` 响应里的 `userAgent`（带版本号）比猜配置行为更可靠。

### 11.5 本次取证的中间产物

| 产物 | 位置 | 说明 |
| :-- | :-- | :-- |
| 协议导出（实验） | `/tmp/codex-schema/` | 45 个 JSON，6.0 MB |
| 协议导出（稳定） | `/tmp/codex-schema-stable/` | 同上 |
| 解包后的 app.asar | `/tmp/codex-asar/app/` | 807 MB（`early-bootstrap*.js`、`.vite/build/preload.js`） |
| IDA 副本 + 头less 会话 | `/tmp/codex-ida/codex-bin`（session `codex169`） | `CodexCLI.app/Contents/MacOS/codex` 的副本，仅载入未做自动分析 |
| 0.167 对比导出 | `/tmp/schema167/` | 用于 §11.4 的版本差异 |

`/tmp` 里的东西是临时的，本文已经把结论全部落到 markdown，不依赖这些文件。

### 11.6 IDA Pro MCP 的二进制确认

工作方式：用 `ida-pro-mcp` 的 `idb_open` 把 `/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex` 复制到 `/tmp/codex-ida/codex-bin` 后以 `force_headless` 打开（session `codex169`）。

> **完整自动分析跑不完**：268 MB 的 Rust 二进制在 IDA 9.3 headless 下烧了 30 分钟 CPU 仍在分析（`.id0` 长到 1.6 GB），MCP 调用一直超时。最后改用 `run_auto_analysis: false` 直接打开数据库——IDA 载入文件时已经建好字符串表，`find(type='string')` 完全可用，足够做常量核对。要函数级分析（xref、调用图）才需要等完整体分析。

命中情况（地址是 IDA 里的虚拟地址）：

| 断言 | 字符串 | 地址 | 结果 |
| :-- | :-- | :-- | :-- |
| WebSocket transport 与单帧上限 | `x-codex-websocket-max-unfragmented-message-bytes` | `0x10cb5ffa0` | 命中 1 |
| WS transport 模块 | `app-server-transport/src/transport/websocket.rs` | `0x10cc7beaf` 附近的字符串块 | 命中 |
| daemon 控制 socket | `app-server-control.sock` | `0x10cc7beaf` | 命中 1 |
| 长度前缀 IPC | `ipc.sock` / `codex-ipc` / `ipc-0.sock` | `0x10cfba408` / `0x10cfa0cc0` | 命中 |
| IDE 上下文 socket | `ide-context`、`sourceClientId`、`codex-tui`、`workspaceRoot` | `0x10cfa0bfa` / `0x10cfa0ddf` | 命中 2 |
| daemon 托管进程 | `managed-daemon`、`process_identity`、`unmanaged server` | `0x10cb73ad2` | 命中 2 |
| 实验性网关 | `requires experimentalApi capability` | `0x10c9eed26` | 命中 1（前半句是运行时拼的，所以整句查不到） |
| 审批可选决策 | `availableDecisions` | `0x10cbfd87e` | 命中 3 |
| 审批的「改规则后放行」 | `acceptWithExecpolicyAmendment` | `0x10cb365e6` | 命中 3 |
| 通知时间戳 | `emittedAtMs` | `0x10cc770b0` | 命中 1 |
| 审批已解决通知 | `serverRequest/resolved` | `0x10cc0060d` | 命中 2 |
| 运行中改设置 | `turn/settings/update` | `0x10cbeb6dc` | 命中 3 |
| 分页读历史 | `thread/items/list` | `0x10c9de8d6` | 命中 3 |
| 通知静音 | `optOutNotificationMethods` | `0x10cb8b5d8` | 命中 3 |
| 自动审批子代理 | `auto_review` | `0x10ca075ab` | 命中 3 |
| 细粒度审批 | `granular` | `0x10ca4f53f` | 命中 3 |
| code-mode 开关 | `features.code_mode_host` | `0x10c9feb87` | 命中 1（同一块里还有 ``…` and install `codex-code-mode-host`.``） |
| v1 老方法 | `getConversationSummary`、`gitDiffToRemote` | `0x10cbebd59`、`0x10cbebd6f` | 命中各 3 |
| **`codex mcp-server` 已删除** | `mcp-server` / `codex mcp-server` | — | **命中 0** |
| **`codex.control.ready` 不是官方字段** | `codex.control.ready` | — | **命中 0**（只在 TodeX 自己的 fixture 脚本里存在） |
| **`thread-stream-*` 不是 app-server 方法** | `thread-stream-state-changed` | — | **命中 0**（只在桌面应用 JS 里） |

复核方法（不需要等自动分析）：

```
idb_open(input_path="/tmp/codex-ida/codex-bin", mode="force_headless",
         run_auto_analysis=False, build_caches=False, init_hexrays=False,
         preferred_session_id="codex169")

find(database="codex169", targets=["put-any-protocol-string"], type="string", limit=5)
get_string(database="codex169", addrs=["0x10cb5ffa0"])
```

字符串命中 0 就是「这个构建里根本没有这段文本」，比看 JS 或猜配置可靠。

两条「命中 0」是本次最有价值的否定结论：

1. TodeX 的 `structured_ready_event`（`codex_gateway/mod.rs:2449`）接受 `{"type":"codex.control.ready"}` 这种行，但它**只是 TodeX 自己写测试 fixture 用的假事件**，真实 app-server 永远不会发（字符串在二进制里根本不存在）。真实就绪判据是 `{"id":"initialize","result":{…}}`——这一分支已经在函数里，没问题，但别把 fixture 形态当成协议。
2. 桌面应用那三条 `thread-stream-*` 是 Electron 主进程 ↔ 渲染进程的消息名，不是 app-server 方法。想从外部拿「会话流状态」，得用 app-server 的 `thread/status/changed` + `thread/items/list`，或者走 `ipc.sock`（同一个 socket 上的广播）。
