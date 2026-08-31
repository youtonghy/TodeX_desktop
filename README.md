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
npm install
npm run dev
```

`npm install` 会触发 `@heroui-pro/react` 的 postinstall，从 HeroUI 拉取 Pro 组件产物。如果跳过了 `HEROUI_AUTH_TOKEN`，界面会缺 Pro 组件。首次安装还需要能访问网络以下载 Electron 二进制；若出现 `Electron uninstall`，在本目录执行：

```bash
node node_modules/electron/install.js
```

`npm run dev` 会打开 1280×800 的桌面窗口。先启动 `TodeX_backend` / `todex-agentd`，再在设置里连接或粘贴配对内容。 HeroUI Pro 还需要 `motion`、`react-aria-components` 等 peer，已写在本包的 `package.json` 中。

其它命令：

```bash
npm run typecheck
npm run build
npm run preview
```

本次范围以 macOS 开发运行为准，不包含 Windows / Linux 安装包或自动更新。

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
