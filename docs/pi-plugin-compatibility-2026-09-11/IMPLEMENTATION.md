# Pi RPC 插件兼容层交付说明

本次在 Pi 原生 RPC 上补齐插件命令、标准表单、反馈展示与跨回合后台运行。Desktop 与 Web 使用相同的插件组件和路由规则，移动端更新共享协议与状态投影。

## 使用行为

- Pi 会话中的已发现命令优先交给 Pi，包含与 Todex 重名的 `/compact`、`/memory`、`/model`、`/mcp` 等。命令区分大小写，保留参数；选择建议只填写草稿，下一次发送才执行。
- Todex 自身操作使用 `/todex compact`、`/todex retry`、`/todex resume`、`/todex memory`。是否可执行仍由后端能力决定。`/todex commands` 或“刷新命令”重新查询目录。
- 目录绑定后端、工作区、provider、会话和运行实例；回合结束会失效，兼容插件动态注册命令或切换原生会话。加载失败、空目录与未知命令不会借用其他目录，也不会发送为普通模型消息；草稿保留。
- 插件区域展示标题、按 key 更新的状态、输入框上下的文本 widget，以及通知记录。标题只影响插件区域。终端转义字符仅在显示时移除，原始日志不改写。
- 明确标记为实时的新通知弹出一次，完整内容可回看。HTTP 和 WebSocket 回放仅恢复状态；序号缺口恢复仍保留真正实时事件的身份。
- 实时草稿请求只自动填入完全空白的输入框。已有文本时显示“替换草稿 / 取消”；历史回放不会自动写草稿，也不能重新激活过期建议。
- select、confirm、input、editor 使用已有 HeroUI 表单。会话级表单在输入区独立显示，模型回合结束不会清除它们，提交后不误报模型运行中。
- custom message 使用 Markdown/文本显示，并标出插件来源。`display=false` 不出现在聊天中；非文本内容提供 fallback。

## 后台运行与边界

Pi 进程在回合结束、切换聊天或客户端短暂断线后继续运行。已启动进程保留到明确停止、进程退出、撤销工作区访问或后端退出。最多同时保留 32 个进程，满额拒绝新进程，不淘汰旧会话。

“停止”通过原生 abort 取消当前回复；独立的“停止后台运行”结束 Pi 进程并结清挂起表单，聊天历史保留。正常取消需要确认 Pi 已空闲才能复用；失去协议同步时关闭进程，不自动重放插件命令。压缩、克隆等维护操作会重启插件，无法恢复的插件定时器或子任务不会被承诺保留。

该版本仍不转换任意 `ui.custom()`，不内嵌 Pi TUI，也不代理插件的浏览器端口。兼容提示依据实际包名、版本和命令入口；未知版本显示“未验证”。已知的 `/usage`、`/better-custom`、`/cache graph` 等终端入口会给出限制提示并保留草稿。任务创建/查看、pruner stats、cache export 的“已验证”只指 [实测矩阵](README.md#实现后的真实-pi-联调2026-09-11) 中的功能分支。

## 协议与部署

新增事件 `extension.ui`、`extension.message`、`provider.runtime`，携带 `runtimeId` 与 `scope=session|turn`。标准表单继续使用既有 permission 事件。WebSocket 的 `conversation.event` 外层增加 `delivery=live|replay`；未提供该标记的旧后端只能恢复状态，不触发插件通知或自动写草稿。

命令查询兼容原有 provider/workspace 参数，并接受可选 conversationId。会话查询以经过 owner 校验的 manifest 为准。新增 `conversation.runtime.stop` 和对应 HTTP 停止接口。能力声明增加可选 `runtimeStop`、`sessionCommands`、`extensionUi`、`extensionMessages`；旧后端未声明停止能力时，客户端不会启用停止按钮。

先部署共享协议与后端，再部署客户端。无需迁移或重写历史日志。回滚前先停止已启动的 Pi 后台运行，避免丢失尚未回答的交互；已保存聊天记录仍可使用原事件恢复机制读取。

## 验证证据

| 层级 | 结果 |
|---|---|
| 真实 Pi 0.84.4 与 Todex 后端 | 11 个命令回合、17 个交互请求结清；tasks 创建/查看、pruner stats、cache CSV、空配置 MCP、idle 消息和停止均通过。参见 [live-evidence.json](live-evidence.json) |
| 后端 | 319 项单元测试和 1 项离线集成测试通过，包含 14 项 Pi RPC 回归；1 项性能和 5 项真实模型测试按设计跳过。严格类型检查、格式检查、构建通过；Clippy 仅有 48 条既有警告，Pi 新代码无警告 |
| 共享 App 协议 | 174 项单测、类型检查与协议检查通过 |
| Desktop | renderer/node 类型检查、Electron 主进程/preload/renderer 构建通过 |
| Web | renderer/server 类型检查、客户端和服务端构建通过；新增文件定向 ESLint 通过 |
| Web 定向回归 | 9 个文件，65 项通过，覆盖命令路由、真实 Session Hook、live/replay 副作用、表单组件、时间线和恢复 |
| 浏览器 | Chromium 桌面 1440×900、平板 1024×768、手机 390×844 全部通过；实际 HeroUI 组件完成四类 session 表单、草稿保护、命令选择/发送、停止与历史保留 |
| Web 全套回归 | 288/294 通过；6 项既有工作台标签断言失败，在改动前源码副本复现相同失败。本任务未修改这些工作台文件 |

界面截图：[桌面](ui-desktop.png)、[平板](ui-tablet.png)、[手机](ui-mobile.png)。

浏览器测试使用确定性 HTTP/WebSocket 后端替身；真实插件测试使用隔离配置的本机 Pi 与真实 Todex 后端。两组证据分别验证界面和实际插件往返，不混称为真实插件的完整 GUI 测试。没有调用付费模型、真实搜索/MCP 服务或子 agent。

Web 的既有失败位于 `workspaceFilePreview.test.ts`（2 项）与 `workbenchScope.test.ts`（4 项），均期待旧标签文字，如“文件 1”“终端 1”。后端最终完整检查结果和提交记录见本说明的交付记录。

## Web 源码与补丁

Web 目录没有 Git 元数据，也无法确认 upstream。本次已完成该目录的源码同步、构建和测试，没有初始化新仓库或猜测远端。

[web-changes.patch](web-changes.patch) 保存本任务的 Web 源码及测试改动；[web-changes.json](web-changes.json) 记录各文件改动前后的 SHA-256。补丁以实施前的 Web 源码副本为基准，在独立副本中实际应用并逐文件核对。当前 Web 工作目录已包含这些改动，不要重复应用；它用于日后转入正确的 Web 仓库。

复验命令（各仓库既有依赖可用时）：

```sh
# Desktop
npm run typecheck
npm run build

# Backend
cargo fmt --check
RUSTFLAGS="-D warnings" cargo check --locked --all-targets --all-features
cargo test --locked --all-targets --all-features
cargo clippy --locked --all-targets --all-features
cargo build --locked

# App
npm run test:unit
npm run typecheck
npm run check:protocol

# Web
npm run typecheck
npm run test
npx playwright test tests/e2e/pi-extensions.spec.ts
```

本次没有升级依赖；Desktop worktree 使用既有安装的依赖和共享源码进行检查。标准构建产物未加入提交。

## 交付记录

- 共享 App：`86fad6b`，分支 `codex/pi-rpc-plugins`，已推送 `origin`；保留原有未跟踪 `.idea/` 与 `pnpm-lock.yaml`。
- Desktop 产品代码：`9d13185`，分支 `codex/pi-plugin-compatibility-research-20260911`。
- 后端：`9261e0f`，分支 `codex/pi-rpc-plugins`，已推送 `origin`。
- Web：源代码已更新且完成验证；缺少 Git 元数据和 upstream，无法在原目录提交、推送，补丁随 Desktop 文档交付。
