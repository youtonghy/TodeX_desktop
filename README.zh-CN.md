# TodeX 桌面端 (`TodeX_desktop`)

<p align="center">
  <strong>基于 Electron、React 19 与 HeroUI Pro 构建的原生 macOS 桌面客户端，连接 <code>todex-agentd</code>。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

## 概述

**TodeX Desktop** 是连接 [`todex-agentd`](../TodeX_backend) 后端服务的桌面客户端，为 macOS 开发者提供沉浸式编程工作台。

桌面端采用 **Electron 44**、**React 19**、**Vite 7**、**Tailwind CSS v4** 和 **HeroUI Pro** 构建，设计了专为宽屏优化的经典三栏工作台布局。它与移动端客户端（[`TodeX_app`](../TodeX_app)）共享核心通信协议库（`@todex/protocol`），同时充分利用桌面端原生能力，如系统原生目录选择器、拖拽二维码图片解码以及多标签页开发者工作台。

---

## 核心特性

- **桌面三栏工作台界面**：
  - **左侧边栏（Sidebar）**：工作区目录管理、会话历史列表、Agent 标识徽章、会话生命周期操作（新建、重命名、Fork、删除）与快速设置。
  - **中央聊天面板（Chat Panel）**：完整会话时间线、流式 Markdown 实时渲染、Shiki 语法高亮、KaTeX 数学公式渲染、交互式审批卡片（命令执行、文件变更对比、工具调用），以及支持模型选择、可拖动思考强度、Codex Fast 模式、`@` 文件引用、`/` 斜杠命令与 `#` Skill/MCP 建议的输入框。推理与工具详情仅在用户展开后按需挂载，最终答复与上下文、执行事件保持独立。
  - **右侧工作台面板（Workbench Panel）**：
    - **斜杠命令（Slash Commands）**：快速查看与调用当前 Agent 的可用命令。
    - **Git Diff**：工作区实时代码改动差异检查。
    - **终端（Terminal）**：基于 xterm.js 的交互式 PTY 会话，支持原始键盘输入、ANSI 输出与行列尺寸自动同步。
    - **能力目录（Capabilities）**：实时查看当前生效的 Skills 与 MCP Servers。
    - **实验特性（Experiments）**：特性开关与开发者诊断面板。
- **配对与连接管理**：
  - 支持通过主机/端口与 Bearer Token 直接连接。
  - 支持粘贴配对 JSON 文本或多段分片二维码数据。
  - **拖拽二维码图片配对**：支持直接将二维码截图/图片拖入应用窗口（基于 `jsqr` 本地解码）。
  - 分类明确的连接诊断状态（清晰展示后端未启动、端口错误、Token 失效、已废弃的 `/v1` 协议或握手异常等原因）。
- **原生系统深度集成**：
  - 安全隔离的 Electron 架构：开启 Preload 上下文隔离（`contextIsolation: true`），禁用渲染进程 Node 集成（`nodeIntegration: false`）。
  - 本地工作区支持调用 macOS 原生系统文件夹选择对话框。
  - 数据安全保存在 Electron `userData` 目录中（`todex.desktop.*`）。
- **后量子传输加密**：
  - 集成 `@noble` 密码学套件，支持 **X25519** 与 **ML-KEM-768**（后量子密码学标准）端到端会话加密。

---

## 架构设计与移动端关系

```
+-----------------------------------------------------------------------------------+
|                                  TodeX Desktop                                    |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                            Electron 主进程与 Preload                         |  |
|  |       (IPC 通信, 系统对话框, 本地安全存储, 窗口生命周期管理)                |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                             React 19 渲染进程                               |  |
|  |  +-------------------+  +------------------------+  +--------------------+  |  |
|  |  |     左侧边栏      |  |      中央聊天面板      |  |     右侧工作台     |  |  |
|  |  | (工作区与会话列表)|  | (时间线, 流式渲染, 审批)|  | (Git Diff, PTY,    |  |  |
|  |  |                   |  |  输入框建议与附件)      |  |  Skills, MCPs)     |  |  |
|  |  +-------------------+  +------------------------+  +--------------------+  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  |                   HeroUI React & HeroUI Pro UI 组件库                 |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                  @todex/protocol (与 TodeX_app 共享协议层)                  |  |
|  |         (v2 客户端, 传输层, 心跳探测, 加密协商, 连接健康检测)               |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                          |
                               WebSocket / REST /v2
                                          v
+-----------------------------------------------------------------------------------+
|                             todex-agentd (后端服务)                              |
+-----------------------------------------------------------------------------------+
```

### 桌面端与移动端对照

| 维度 | 移动端 (`TodeX_app`) | 桌面端 (`TodeX_desktop`) |
| :--- | :--- | :--- |
| **基础框架** | React Native (Expo SDK 57) | Electron 44 + React 19 (Vite) |
| **UI 组件库** | `heroui-native` + Uniwind (Tailwind v4) | `@heroui/react` + `@heroui-pro/react` (Tailwind v4) |
| **界面布局** | 移动端堆叠导航（Stack Navigation） | 三栏可调节桌面工作台布局 |
| **协议层实现** | `src/lib` | `@todex/protocol` 路径别名映射至 `../TodeX_app/src/lib` |
| **本地持久化** | `AsyncStorage` / `expo-secure-store` | Electron `userData` JSON 文件（`todex.desktop.*`） |
| **配对输入** | 手机摄像头实时扫描二维码 | 文本粘贴 / 图片拖拽二维码本地解码 |

---

## 前置条件与环境配置

### 环境要求

- **Node.js**：22.0.0 或更高版本
- **pnpm**：11.0.0 或更高版本
- **TodeX 后端**：正在运行的 `todex-agentd` 实例（默认 `http://127.0.0.1:7345`）
- **HeroUI Pro 凭据**：安装 `@heroui-pro/react` 时需要配置授权 Token。

### 1. 配置 HeroUI Pro Token

在运行 `pnpm install` 前，确保在当前 Shell 环境中设置了 Token 变量：

```bash
export HEROUI_AUTH_TOKEN="你的_heroui_key"
# 或者使用已有的 HEROUI_KEY 变量：
export HEROUI_AUTH_TOKEN="$HEROUI_KEY"
```

> [!WARNING]
> 请勿将敏感密钥或 Token 提交至 Git 仓库。

### 2. 安装依赖

```bash
pnpm install
```

*说明：如果 Electron 预编译二进制下载意外中断，可执行以下命令重新下载：*

```bash
rm -rf node_modules/electron/dist
node node_modules/electron/install.js
```

### 3. 启动本地开发

```bash
pnpm run dev
```

启动后会弹出 1280×800 尺寸的桌面客户端窗口。

---

## 常用脚本命令

| 脚本命令 | 说明 |
| :--- | :--- |
| `pnpm run dev` | 执行前置检查并在 Vite 开发模式下启动 Electron 应用。 |
| `pnpm run build` | 编译构建主进程、Preload 脚本及渲染进程生产资源。 |
| `pnpm run package` | 使用 electron-builder 编译并打包 Electron 应用。 |
| `pnpm run preview` | 本地预览生产构建产物。 |
| `pnpm run typecheck` | 执行全工程 TypeScript 类型静态检查。 |
| `pnpm run check:electron` | 校验本地 Electron 二进制文件完整性。 |

## 桌面端发布

桌面安装包通过 **Actions > Release desktop packages** 手动发布。输入 `1.2.3`
这样的稳定语义版本后，工作流会验证应用并发布 Windows x64、Windows ARM64
NSIS 安装程序、macOS Apple Silicon DMG、Linux x64 AppImage 和 SHA-256 校验文件。

Windows 与 macOS 安装包目前没有代码签名，首次运行时可能需要用户手动通过
SmartScreen 或 Gatekeeper。由于桌面端直接共享移动端协议源码，构建时会把移动端
仓库的 `main` 分支检出到相邻目录，并将验证时解析出的提交固定用于全部平台。如果
该仓库是私有仓库，需要配置具有只读权限的 `PROTOCOL_REPO_TOKEN` Actions Secret。
此外，发布工作流需要配置 `HEROUI_AUTH_TOKEN` Actions Secret，才能在全新的 Runner
上安装 HeroUI Pro 依赖。

---

## 连接与故障排查

桌面端设置面板会根据探测结果提供明确的诊断信息：

| 诊断状态 | 可能原因 | 排查与解决建议 |
| :--- | :--- | :--- |
| **后端未启动 / 无法连接** | `/v2/version` 或 `/health` 请求失败。 | 确认 `todex-agentd` 服务已启动，且端口配置正确。 |
| **后端地址无效** | 输入的 URL 无法解析为有效 Origin。 | 请使用标准格式，如 `http://127.0.0.1:7345`。 |
| **认证失败 (401/403)** | Token 缺失或与后端不匹配。 | 在设置页输入与后端配置一致的 `Auth Token`。 |
| **协议版本已废弃** | 连接地址中包含了旧版 `/v1` 路径。 | 将地址更新为 `/v2`，旧版接口已移除。 |
| **WebSocket 握手失败** | HTTP 探测正常但 `/v2/ws` 连接中断。 | 检查本地防火墙规则、Token 鉴权头或传输加密算法匹配情况。 |
| **Agent 不可用** | Provider 状态返回 `available = false`。 | 确认运行后端的机器上已安装并登录对应 CLI（`codex`、`pi`、`claude` 等）。 |

---

## 安全设计

- **进程隔离**：渲染进程始终运行于 `nodeIntegration: false` 与 `contextIsolation: true` 模式。
- **IPC 白名单**：本地文件操作、原生对话框弹出与安全存储均通过 Preload 安全白名单通道进行。
- **作用域约束**：仅与用户明确指定的后端 daemon 实例进行通信。

---

## 相关仓库

- **[TodeX 后端服务](../TodeX_backend)**：基于 Rust 构建的后端守护进程 (`todex-agentd`)。
- **[TodeX 移动端应用](../TodeX_app)**：基于 React Native 与 Expo 构建的移动客户端。

---

## 开源协议

本项目采用 MIT 许可证 - 详情参见 [LICENSE](LICENSE) 文件。
