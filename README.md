# TodeX Desktop

<p align="center">
  <strong>Native macOS desktop client for <code>todex-agentd</code> built with Electron, React 19, and HeroUI Pro.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="README.zh-CN.md">简体中文</a>
</p>

---

## Overview

**TodeX Desktop** is a desktop client for [`todex-agentd`](../TodeX_backend), delivering a coding workspace environment on macOS.

Built with **Electron 44**, **React 19**, **Vite 7**, **Tailwind CSS v4**, and **HeroUI Pro**, TodeX Desktop features a 3-pane layout optimized for wide screens. It shares the transport and protocol library (`@todex/protocol`) with the mobile app ([`TodeX_app`](../TodeX_app)), while leveraging native desktop capabilities like local file pickers, Drag & Drop QR decoding, and multi-tab developer workbenches.

---

## Key Features

- **Desktop 3-Pane Interface**:
  - **Left Sidebar**: Workspace directory explorer, active conversation history, agent switcher badges, thread lifecycle actions (New, Rename, Fork, Delete), and quick settings.
  - **Center Chat Panel**: Full conversation timeline with streaming Markdown rendering, Shiki syntax highlighting, KaTeX math formulas, interactive approval cards (commands, file diffs, tool calls), and prompt input with model selection, draggable reasoning effort, Codex Fast mode, `@` file mention, `/` slash commands, and `#` skill/MCP suggestions. Reasoning and tool details are lazily mounted only after expansion, while final answers remain isolated from context and execution events.
  - **Right Workbench Panel**: Multi-tab workspace drawer offering:
    - **Slash Commands**: Reference of provider commands.
    - **Git Diff**: Live inspection of working directory changes.
    - **Terminal**: Embedded xterm.js PTY session with direct keyboard input, ANSI output, and automatic row/column synchronization.
    - **Capabilities**: Real-time read-only catalog of active Skills and MCP servers.
    - **Experiments**: Feature toggles and developer diagnostics.
- **Pairing & Connection Management**:
  - Inspect the active Backend's Codex, Pi, Claude Code, Grok Build, and ACP CLI inventory, compare installed and latest versions, and start managed CLI upgrades.
  - Connect via direct host/port URL with Bearer token authentication.
  - Paste pairing JSON or multi-frame segmented QR payloads.
  - **Drag & Drop QR pairing**: Drop QR screenshot/image files directly into the window (parsed locally via `jsqr`).
  - Clear connection diagnostic states (categorizes connection errors such as unstarted backend, port mismatch, token error, deprecated `/v1` endpoints, or handshake issues).
- **Native OS Integration**:
  - Secure Electron architecture: Preload bridge with isolated context (`contextBridge`) and `nodeIntegration: false`.
  - Native file and directory chooser dialogs for loopback local workspaces.
  - Electron `userData` file persistence (`todex.desktop.*`).
- **Transport Encryption**:
  - Cryptographic session negotiation supporting **X25519** and **ML-KEM-768** (Post-Quantum) via the `@noble` cryptography suite.

---

## Architecture & Relation to Mobile App

```
+-----------------------------------------------------------------------------------+
|                                  TodeX Desktop                                    |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                            Electron Main & Preload                          |  |
|  |       (IPC Handlers, Native Dialogs, Safe Storage, Window Management)       |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                             React 19 Renderer                               |  |
|  |  +-------------------+  +------------------------+  +--------------------+  |  |
|  |  |    Left Sidebar   |  |    Center Chat Panel   |  |   Right Workbench  |  |  |
|  |  |  (Workspaces &    |  |  (Timeline, Streaming, |  |  (Git Diff, PTY,   |  |  |
|  |  |   Conversations)  |  |   Approvals, Inputs)   |  |   Skills, MCPs)    |  |  |
|  |  +-------------------+  +------------------------+  +--------------------+  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  |                   HeroUI React & HeroUI Pro Components                |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  +-----------------------------------------------------------------------------+  |
|                                         |                                         |
|  +-----------------------------------------------------------------------------+  |
|  |                  @todex/protocol (Shared with TodeX_app)                    |  |
|  |         (v2 Client, Transport, Heartbeat, Crypto Sessions, Probes)          |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
                                          |
                               WebSocket / REST /v2
                                          v
+-----------------------------------------------------------------------------------+
|                             todex-agentd (Backend)                                |
+-----------------------------------------------------------------------------------+
```

### Desktop vs Mobile Comparison

| Dimension | Mobile Client (`TodeX_app`) | Desktop Client (`TodeX_desktop`) |
| :--- | :--- | :--- |
| **Framework** | React Native (Expo SDK 57) | Electron 44 + React 19 (Vite) |
| **UI Components** | `heroui-native` + Uniwind (Tailwind v4) | `@heroui/react` + `@heroui-pro/react` (Tailwind v4) |
| **Layout** | Mobile Stack Navigation | 3-Pane Resizable Desktop Layout |
| **Protocol Layer** | `src/lib` | `@todex/protocol` alias mapped to `../TodeX_app/src/lib` |
| **Local Storage** | `AsyncStorage` / `expo-secure-store` | Electron `userData` JSON (`todex.desktop.*`) |
| **Pairing Input** | Live Device Camera Scanner | Text Paste / Image File Drag & Drop QR Decoding |

---

## Prerequisites & Setup

### Requirements

- **Node.js**: 22.0.0 or higher
- **pnpm**: 11.0.0 or higher
- **TodeX Backend**: Running instance of `todex-agentd` (default `http://127.0.0.1:7345`)
- **HeroUI Pro Auth**: `@heroui-pro/react` requires a license token during package installation.

### 1. Configure HeroUI Pro Token

Before running `pnpm install`, ensure the HeroUI token is available in your shell environment:

```bash
export HEROUI_AUTH_TOKEN="your_heroui_key"
# Alternatively if using HEROUI_KEY:
export HEROUI_AUTH_TOKEN="$HEROUI_KEY"
```

> [!WARNING]
> Do not commit API keys or auth tokens to the repository.

### 2. Install Dependencies

```bash
pnpm install
```

*Note: If the Electron binary download is interrupted, run:*

```bash
rm -rf node_modules/electron/dist
node node_modules/electron/install.js
```

### 3. Launch Development Mode

```bash
pnpm run dev
```

The desktop window will launch at 1280×800.

---

## Available Scripts

| Command | Description |
| :--- | :--- |
| `pnpm run dev` | Runs `predev` checks and starts the Electron app in Vite dev mode. |
| `pnpm run build` | Builds the main process, preload script, and renderer assets. |
| `pnpm run package` | Builds and packages the Electron application with electron-builder. |
| `pnpm run preview` | Previews the production build locally. |
| `pnpm run typecheck` | Validates TypeScript types across main and renderer targets. |
| `pnpm run check:electron` | Verifies that the native Electron binary is intact. |

## Desktop Releases

Desktop packages are created manually from **Actions > Release desktop packages**.
Enter a stable semantic version such as `1.2.3`; after validation, the workflow
injects it into the application metadata and About screen, then publishes Windows
x64 and ARM64 NSIS installers, a macOS Apple Silicon DMG, a Linux x64 AppImage,
and SHA-256 checksums to the `v1.2.3` GitHub Release.

Development builds display `DEV0.0.0`; `package.json` keeps the valid placeholder
version `0.0.0` until packaging receives a release version from CI.

### Development logs

Detailed desktop diagnostics are enabled only for builds whose version is exactly
`DEV0.0.0`. By default they are written to
`Electron userData/logs/todex-desktop-debug.log`; the resolved path is persisted in
`todex-desktop-store.json` under `todex.desktop.debug.logPath`. Set
`TODEX_DESKTOP_LOG_PATH` to override it for a local run. Logs include window, IPC,
HTTP, WebSocket, and uncaught-error events, while redacting or truncating tokens,
cookies, keys, and attachment contents.

The Windows and macOS packages are currently unsigned, so SmartScreen or Gatekeeper
may require the user to approve the first launch. The build checks out the mobile
repository's `main` branch beside this repository because the desktop client shares
its protocol source, then pins the resolved commit across every platform. If that
repository is private, configure a `PROTOCOL_REPO_TOKEN` Actions secret with read
access. The workflow also requires a `HEROUI_AUTH_TOKEN` Actions secret so a fresh
runner can install the HeroUI Pro dependency.

---

## Connection & Troubleshooting

The Settings screen in TodeX Desktop provides clear diagnostic feedback:

| Diagnostic State | Cause | Resolution |
| :--- | :--- | :--- |
| **Backend Unreachable** | Cannot reach `/v2/version` or `/health`. | Ensure `todex-agentd` is running and the port is correct. |
| **Invalid Backend URL** | The provided URL cannot be parsed. | Use a standard origin format such as `http://127.0.0.1:7345`. |
| **Authentication Failed** | HTTP 401/403 returned by backend. | Enter the correct `Auth Token` matching the backend configuration. |
| **Deprecated Protocol** | The URL path contains `/v1`. | Update the connection URL to use `/v2`. |
| **WebSocket Failure** | HTTP probes succeed but `/v2/ws` fails. | Check network firewall rules, token headers, or crypto mismatches. |
| **Agent Unavailable** | Provider shows `available = false`. | Verify that the underlying agent CLI (`codex`, `pi`, `claude`) is installed and authenticated. |

---

## Security

- **Process Isolation**: The renderer process runs with `nodeIntegration: false` and `contextIsolation: true`.
- **Preload IPC**: Filesystem access, dialog popups, and secure storage operations are routed through guarded IPC channels.
- **Strict Scope**: Only connects to explicitly configured agent daemon endpoints.

---

## Related Repositories

- **[TodeX Backend](../TodeX_backend)**: Rust backend daemon (`todex-agentd`).
- **[TodeX App](../TodeX_app)**: React Native / Expo mobile app.

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
