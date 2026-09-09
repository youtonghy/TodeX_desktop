# 自动更新

只有打包后的应用、严格稳定版本 `X.Y.Z`（不含 `0.0.0`），且编译注入版本与应用包版本一致时启用。开发运行、未注入版本的本地包、预发布版本均不会访问更新服务。Linux 必须直接运行 AppImage；解包目录不会启用更新。

应用启动 15 秒后，以及之后每 6 小时，检查 `youtonghy/TodeX_desktop` 的最新稳定 GitHub Release。发现更高版本后自动下载，由 electron-updater 校验 SHA-512 和平台签名。更新在正常退出应用时安装，不强制中断会话或重启。macOS 关闭窗口不等于退出，请使用应用的退出菜单。

原生菜单 **更新 → 检查更新…** 可立即检查并显示结果。检查或下载失败保留当前版本，下次检查重试；已成功下载的版本保留到退出，不重复下载或降级。这些逻辑仅存在于 Electron 主进程，无需修改 web 共用界面。

## 发布配置

发布流程生成并上传安装包、macOS ZIP、`latest*.yml` 更新元数据、blockmap 和 `SHA256SUMS`。上传前验证元数据版本、文件是否存在、大小和 SHA-512。不能仅上传安装包；应通过 Release desktop packages 工作流发布。新版本必须高于已发布版本，`0.0.0` 保留给开发占位。

macOS 自动更新要求 Developer ID Application 签名。仓库 Actions secrets 需要：

- `MAC_CSC_LINK`：导出的 P12 签名证书，以 base64 编码。
- `MAC_CSC_KEY_PASSWORD`：P12 密码。
- 公证配置：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。

macOS 发布流程在缺少签名证书时明确失败，不发布无法自动更新的包。本地开发打包仍可无证书构建。旧的无签名安装包需要手动安装一次新的签名版本，之后才能自动更新。Windows 当前仍可发布未签名 NSIS 包；Linux 使用 AppImage 更新。

运行 `pnpm run test:updates` 验证版本门禁、版本比较、并发检查、下载失败重试和已暂存更新。真实升级需要两个已发布版本及对应平台运行环境；本地单元测试和构建不代表已完成跨平台安装验证。

参考：[electron-builder 自动更新文档](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md)。
