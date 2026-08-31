# TodeX Desktop / TodeX 桌面端

TodeX Desktop 是连接 `todex-agentd` 的 macOS 桌面客户端（Electron + React）。它与移动端 [TodeX_app](../TodeX_app) 共用协议库，但使用 `@heroui/react` / `@heroui-pro/react` 重写了 DOM 界面。

TodeX Desktop is the macOS desktop client for `todex-agentd` (Electron + React). It reuses the protocol library from the mobile [TodeX_app](../TodeX_app), but the UI is a desktop three-pane layout built with HeroUI React / Pro.

移动端 Expo 工程保持独立，不要把 Electron 依赖加进 `TodeX_app`。

Do not mix Electron into the Expo app; keep `TodeX_app` unchanged.

## 功能 / Features

- 设置与配对：粘贴配对 JSON / 分片，或拖入二维码图片（无摄像头）
- 工作区与对话：侧栏创建、重命名、Fork、删除
- 聊天：时间线、发送、中断、审批、附件、`@` / `/` / `#` 建议
- 右侧面板：斜杠命令、Git Diff、终端、Skills/MCP、实验开关、TodeX 2.0
- 本机 loopback 时可额外用系统文件夹对话框选择工作区目录；远程 agentd 仍走后端目录 API

## 前置条件 / Prerequisites

- Node.js 22+（与仓库其他包一致即可）
- 本机已安装 `todex-agentd`（默认 `http://127.0.0.1:7345`）
- HeroUI Pro 安装需要环境变量 `HEROUI_KEY`。官方 CLI / postinstall 读取的是 `HEROUI_AUTH_TOKEN`，安装时把同一个值赋给两者即可。不要把 key 写入仓库。

```bash
export HEROUI_AUTH_TOKEN="$HEROUI_KEY"
```

## 快速开始 / Quick Start

```bash
cd TodeX_desktop
pnpm install
pnpm run dev
```

`npm install` 会触发 `@heroui-pro/react` 的 postinstall，从 HeroUI 拉取 Pro 组件产物。如果跳过了 `HEROUI_AUTH_TOKEN`，界面会缺 Pro 组件。首次安装还需要能访问网络以下载 Electron 二进制；若出现 `Electron uninstall`，通常是 Electron 下载中断导致 `dist` 目录残缺，先删除当前 artifact 再安装：

```bash
rm -rf node_modules/electron/dist
node node_modules/electron/install.js
```

如果 `install.js` 仍误判为已安装，可强制重新下载：

```bash
force_no_cache=true node node_modules/electron/install.js
```

`pnpm run dev` 会先跑 `check:electron`，确认本机 Electron 二进制可用后再启动。窗口默认 1280×800。先启动 `TodeX_backend` / `todex-agentd`，再在设置里连接或粘贴配对内容。HeroUI Pro 还需要 `motion`、`react-aria-components` 等 peer，已写在本包的 `package.json` 中。

主聊天新建对话走 Backend `POST /v2/conversations`，必须选择 Agent（Codex CLI / ACP / Pi / Claude Code）。创建后 Provider 锁定；切换 Agent 等于在同一工作区新建对话。旧的 Codex native thread 仍可从侧栏打开作为历史。

新建工作区时，Desktop 会先用 Backend 的目录接口校验路径；如果本地保存的默认目录不属于当前 Backend，会回退到 `/v2/version` 返回的 `workspace_root`。创建对话失败时会显示 Backend 返回的具体错误，而不是把目录或 Provider 错误归类成网络故障。

其它命令：

```bash
pnpm run typecheck
pnpm run build
pnpm run preview
pnpm run check:electron
```

本次范围以 macOS 开发运行为准，不包含 Windows / Linux 安装包或自动更新。

## 连接排障 / Connection troubleshooting

设置页会显示分类后的错误，而不是一直停在「连接中」：

| 现象 | 含义 | 处理 |
| --- | --- | --- |
| Backend 未启动或端口错误 | `/v2/version` 或 `/health` 连不上 | 先启动 `todex-agentd`，确认端口 |
| Backend 地址无效 | URL 无法解析 | 使用 `http://127.0.0.1:7345` 这种 origin |
| Token 缺失或无效 | 401/403 | 重新配对或填写正确 token；token 绑定到归一化后的 origin |
| 协议已废弃（/v1） | 地址里带了 `/v1` | 改用 `/v2`，不要使用旧协议 |
| WebSocket 握手失败 | HTTP 探测成功但 `/v2/ws` 失败 | 检查 token、加密协议和防火墙 |
| Agent 不可用 | `GET /v2/providers` 中该 provider `available=false` | 在运行 daemon 的机器上登录对应 CLI |

连接探测顺序：`/v2/version` → `/health` → `/v2/providers`。可重试错误会按 2s → 4s → … → 30s 退避；认证失败或协议错误不会自动重连。点击设置里的「重试」会立即再探测。

Desktop 与 App 共用协议库，但 UI 不同：Desktop 是三栏（侧栏 / 聊天 / 右侧能力与工作台），App 保持移动端堆叠导航。

## 与移动端的关系 / Relation to TodeX_app

| | 移动端 `TodeX_app` | 桌面端 `TodeX_desktop` |
| --- | --- | --- |
| UI | React Native + HeroUI Native | React DOM + HeroUI React/Pro |
| 协议 | `src/lib` | Vite alias `@todex/protocol` → 同一目录 |
| 存储 | AsyncStorage / SecureStore | Electron `userData` JSON（`todex.desktop.*`） |
| 配对 | 摄像头扫码 | 粘贴 + 图片解码 |

桌面端**不会**导入 `TodeX_app/src/lib/storage.ts`（它依赖 Expo）。

## 安全说明 / Security

- 渲染进程没有 `nodeIntegration`，文件对话框和附件读取走 preload IPC。
- 只连接用户填写的 agentd URL。
- 不要提交 `.env` 或 `HEROUI_KEY`。
