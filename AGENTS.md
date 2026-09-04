# Agent Instructions

## Frontend UI

- All user-facing UI must use the official HeroUI React components, and use HeroUI Pro components from `@heroui-pro/react` when the required pattern is provided there. Prefer the existing component APIs over raw HTML controls or ad-hoc replacements.
- Before adding or changing a component, query the current HeroUI and HeroUI Pro documentation through the Context7 MCP (`resolve-library-id` followed by `query-docs`). Use the documented API and verify the installed versions in `package.json`.
- Use HeroUI/Pro for controls such as buttons, inputs, dialogs, menus, tables, tabs, forms, and feedback states. Native HTML elements remain appropriate for semantic structure, layout, and cases where the libraries have no equivalent.
- Install or update HeroUI through `hpsetup` from this project. The command must read its credential from the `HEROUI_KEY` system environment variable; never commit, log, or hard-code that key.
- If `HEROUI_KEY` is unavailable, stop before running an authenticated `hpsetup` operation and report the missing environment variable. Do not substitute a value from source files, shell history, or local config.

## Dual-Client Synchronization (Desktop & Web 双端同步)

- `TodeX_desktop` and `TodeX_web` share a largely isomorphic frontend architecture, with corresponding components, screens, styles, and session logic under `src/renderer/components/`, `src/renderer/screens/`, `src/renderer/styles/`, and `src/renderer/session/`.
- Whenever modifying, optimizing, or refactoring UI components (e.g. `AppSidebar`, `ModelReasoningCard`), feature panels (e.g. `CapabilitiesPanel`, `SettingsPanel`, `ChatPanel`), theme tokens / styling rules (e.g. `global.css`), or shared frontend session/helper logic in `TodeX_desktop`, **always synchronize the corresponding changes to `TodeX_web`** (and vice versa) to keep visual design, interaction, and behavior consistent across both clients.
- Exceptions only apply to platform-specific code, such as desktop-only Electron IPC/preload/window lifecycle logic, or web-only HTTP server/SSR/static asset serving code.
- Always verify that changes made to both clients maintain code consistency and pass relevant builds or type checks.

## Git & Validation

- After completing each task, create one or more Git commits for the changes made in that task.
- Group commits by change category or repository responsibility when the task includes unrelated changes.
- Run the relevant validation commands before committing whenever practical, and mention any validation that could not be run.
- Push the created commits to the current branch's upstream remote after committing.
- If committing or pushing is blocked, report the blocker explicitly and leave the working tree status clear in the final response.
- Do not include unrelated local changes in a task commit. Preserve user changes unless the user explicitly asks to modify or discard them.

