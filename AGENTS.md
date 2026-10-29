# Agent Instructions

## OpenAI Model & Agent Behavior

- For OpenAI API integrations, prefer the Responses API. Use `gpt-6-astra` for new work unless the task or compatibility requirements specify another supported model.
- When migrating an existing integration to `gpt-6-astra`, preserve the current effective reasoning effort; if it is `none` or `minimal`, start with `low` and compare results. Use `reasoning.effort` with Responses and `reasoning_effort` only with Chat Completions.
- GPT-6 Astra does not support `none` reasoning. Remove unsupported sampling and log-probability parameters (`temperature`, `top_p`, `top_logprobs`, and, for Chat Completions, `logprobs`). Do not include `message.output_text.logprobs` in Responses requests.
- Use Responses API tool calling for Astra integrations. If reasoning effort must change during a standard single-agent conversation, use a `configuration_update` input item so the request-level prompt prefix remains cacheable.
- When migrating prompt caching from GPT-5.5 or earlier, replace `prompt_cache_retention` with `prompt_cache_options.ttl: "30m"` and review cache boundaries and billing.
- Treat user requests that imply action as authorization to execute the work. Make reasonable assumptions, persist through the complete task, and ask focused questions only when the answer could materially change the outcome. Ask for approval only after the authorized work is concrete and reviewable. For gated tasks (next rule), the approved plan is that reviewable point: authorization covers investigating and planning, and implementation starts once the plan is approved.
- Before starting a task that spans modules or repositories, changes product behavior, public interfaces/APIs, or data schemas/migrations, touches security or permissions, or carries compatibility or deployment risk, invoke the `plan-gate` skill: investigate read-only, present its full plan, and wait for the user to approve or amend it before implementing. Simple, localized, low-risk changes proceed directly without the gate.
- The user's instructions take precedence over skill and repository guidance when they conflict. If a skill causes a pause or approval request, identify the exact `SKILL.md`, quote the relevant instruction, and explain how it applies.
- Keep final responses concise and human-readable: lead with the outcome, use plain language and active voice, and use lists only for genuinely parallel or sequential information.
- Delegate parallel work with collaboration tools when it can materially save time or improve quality. Keep messages to other agents and final responses legible, with normal spacing.
- Calibrate verification to risk. Do not add tests that only mirror a reversible, low-impact change; run the checks appropriate to the change and broaden them only after a failure, new change, or unresolved concern.

## Frontend UI

- All user-facing UI uses BoardUI (React + Tailwind CSS v4, source-owned components). Installed components live under `src/renderer/components/{base,application,foundations}`, with `utils/cx.ts` and `hooks/`; import them through the `@/` alias (it maps to `src/renderer/`). The always-on BoardUI design rules are in the `boardui:rules` section at the end of this file.
- Patterns BoardUI does not ship (modal and confirm dialog, action/context menus, toasts, cards, alerts, empty states, spinners, progress/meter bars, scroll areas, combobox, Markdown, code blocks, resizable panels, icon toolbar actions) live in `src/renderer/components/ui/`, built from BoardUI recipes. Extend those or the installed BoardUI components instead of writing one-off lookalikes. HeroUI is no longer used.
- Every time you build or change frontend UI, invoke the `boardui` skill and query the BoardUI MCP server (`get_component`, `get_usage_examples`, `get_theme`) before writing code. Do not rely on memory of the component APIs.
- Add components from this project's root with pnpm, writing into the renderer: `pnpm dlx @collectui/bdui add <name> -p src/renderer`. Pro components and templates need a license key, which must come from the `BOARDUI_KEY` system environment variable: pass `--key "$BOARDUI_KEY"`. Never commit, log, echo, or hard-code the key, and never paste its value into commands, files, MCP tool arguments, or messages. If `BOARDUI_KEY` is unavailable, stop before installing Pro items and report the missing variable.
- The BoardUI CLI targets Next.js: replace any `next/image` / `next/link` imports in added files with plain elements, and keep the global CSS entry at `src/renderer/styles/global.css` (it imports `styles/globals.css`, which brings Tailwind, the theme tokens and the type scale).
- If `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS`, run `pnpm approve-builds` and approve the build scripts, then continue.

## UI tests and visual regression CI

- Every UI change updates its tests in the same task. A new or changed screen, panel, dialog or visible state gets a screenshot in `tests/visual/screens.spec.ts`, plus `src/renderer/demo/` fixtures or mocks if the `?demo` preview needs data to show it. A change to desktop shell behavior (window, preload bridge, native dialogs, store) gets coverage in `tests/electron/`, and a new or renamed IPC channel must keep `scripts/ipc-contract.test.ts` passing. See README "Tests".
- Baselines under `tests/visual/__screenshots__` are rendered only in CI's Playwright image, never locally. After an intended visual change:
  1. Push.
  2. Run `gh workflow run checks.yml --ref <branch> -f update-screenshots=true`.
  3. Download that run's `visual-baselines` artifact into a fresh temp directory.
  4. Look at the images.
  5. Copy them into `tests/visual/__screenshots__/screens.spec.ts/`, commit and push.
- Do not loosen the screenshot thresholds, add masks, or delete screenshots to make a diff pass. Mask only values that genuinely differ between runs.
- Before ending any task that changes UI, watch the *Desktop checks* run for the final pushed commit until it completes (`gh run watch <id> --exit-status`). A run cancelled by a later push does not count; watch the latest one.
  - If *Visual regression* or *Electron smoke* fails, inspect its `visual-report` or `electron-report` artifact. Fix the cause: a UI regression gets fixed, an intended change gets new baselines. Then push and watch again.
  - Do not finish while the run is still running or failing. Report the run and its result in the final response.

## Sibling repositories (cross-repo access)

TodeX lives in sibling checkouts under the same parent directory:

- `../TodeX_backend` — Rust backend/API server (`docs/API.md` holds the API contract)
- `../TodeX_web` — Web client; the Dual-Client Synchronization rules below apply in both directions
- `../TodeX_container` — Docker image (`todex-agentd` + agent CLIs) that the clients pair with; its pairing, config-sync and path-mapping flows are described in its `docs/PLAN.md`

When a task requires it — the Dual-Client Synchronization rules, aligning client calls with the backend API contract, or a change that explicitly spans repos — read and edit those sibling repositories directly at their paths, even though they sit outside this repository. Follow each repo's own `AGENTS.md` while working inside it. Commit and push in each repository separately per its Git delivery rules; never mix another repo's changes into this repository's commits.

## Dual-Client Synchronization (Desktop & Web 双端同步)

- `TodeX_desktop` and `TodeX_web` share a largely isomorphic frontend architecture, with corresponding components, screens, styles, and session logic under `src/renderer/components/`, `src/renderer/screens/`, `src/renderer/styles/`, and `src/renderer/session/`.
- Whenever modifying, optimizing, or refactoring UI components (e.g. `AppSidebar`, `ModelReasoningCard`), feature panels (e.g. `CapabilitiesPanel`, `SettingsPanel`, `ChatPanel`), theme tokens / styling rules (e.g. `global.css`), or shared frontend session/helper logic in `TodeX_desktop`, **always synchronize the corresponding changes to `TodeX_web`** (and vice versa) to keep visual design, interaction, and behavior consistent across both clients.
- Exceptions only apply to platform-specific code, such as desktop-only Electron IPC/preload/window lifecycle logic, or web-only HTTP server/SSR/static asset serving code.
- Always verify that changes made to both clients maintain code consistency and pass relevant builds or type checks.

## Git delivery

- Before starting each task, sync with the remote so the work is based on the latest code: `git fetch`, then fast-forward the current branch to its upstream (`git pull --ff-only`), and create any task worktree from the updated branch. If the fast-forward is blocked (diverged history, or uncommitted changes in the same files), do not stash, reset, or rebase the user's work; base the task on the fetched upstream instead (for example, a worktree from `origin/<branch>`) and mention it in the final response.
- Do every complex task — anything beyond a parameter change or a few localized lines — in a dedicated Git worktree on its own branch, not in the main checkout, which may hold the user's uncommitted work. Install dependencies inside the worktree (`pnpm install`) before running builds or checks.
- Hand the result back locally: bring the branch into the main checkout (fast-forward or cherry-pick) without modifying the user's uncommitted changes, rerun the relevant checks there, then remove the worktree and its branch.
- After completing each task, create one or more Git commits for the changes made in that task.
- Group commits by change category or repository responsibility when the task includes unrelated changes.
- Run the relevant validation commands before committing whenever practical, and mention any validation that could not be run.
- Push the created commits to the current branch's upstream remote after committing.
- If committing or pushing is blocked, report the blocker explicitly and leave the working tree status clear in the final response.
- Do not include unrelated local changes in a task commit. Preserve user changes unless the user explicitly asks to modify or discard them.

<!-- boardui:rules start -->
---
description: BoardUI design system rules. Always apply when writing or editing UI code in this project.
alwaysApply: true
---

# BoardUI design rules

This project uses BoardUI (React + Tailwind CSS v4, source-owned components under `components/`). These rules always apply when writing UI code. MCP tools are on demand; these rules are not optional context.

## Components first

- Before hand-building any UI element, check for an installed BoardUI component under `components/base/` and `components/application/`, and prefer it.
- Missing a component? Install it (BoardUI MCP `install_components`, or `npx -y @collectui/bdui add <name>`) instead of writing a lookalike.
- Import through the `@/` alias, e.g. `import { Button } from "@/components/base/buttons/button"`.

## Color: semantic tokens only

- Never use raw palette classes (`text-gray-500`, `bg-white`, `border-neutral-200`) or hex/oklch literals. Every color rides a BoardUI semantic token, which also makes dark mode automatic.
- Text: `text-text-primary`, `text-text-secondary`, `text-text-tertiary`, `text-text-placeholder`, errors `text-text-error-primary`.
- Surfaces: `bg-background-primary-default`, `bg-background-secondary-default` / `-hover`, `bg-background-tertiary-default`, page ground `bg-background-full`.
- Borders: `border-border-button-default` / `-hover`, hairlines `border-separator-border`, tables `border-border-table`, errors `border-border-error-default`.
- Icons: `text-foreground-icon-primary` through `text-foreground-icon-quaternary`.
- Charts: the `chart-1` … `chart-5` tokens (plus `-active` variants). CTAs and selection states: the `accent-50` … `accent-950` ramp.
- Dark mode flips tokens via the `.dark` class on `<html>`. Do not write `dark:` overrides with raw colors; if a token pair looks wrong in dark mode, pick a different token, not a literal.

## Typography: composite utilities only

- Use BoardUI's composite type utilities: `text-title-1-medium`, `text-title-2-medium`, `text-title-3-semibold`, `text-headline-medium`, `text-body-medium`, `text-body-regular`, `text-body-2-*`, `text-caption-1-semibold`, and friends. Each sets size, weight, line-height, and letter-spacing together.
- Never rebuild type by stacking `text-sm font-medium leading-5`; if a style seems missing, look in `styles/typography.css` before inventing one.

## Spacing and shape

- Stay on Tailwind's spacing scale (`gap-2`, `p-4`, `mt-6`); prefer flex/grid `gap` over per-child margins. Arbitrary values (`p-[13px]`) only when matching an existing BoardUI component exactly.
- Cards and panels: `rounded-3xl` with `border-border-button-default`. Inputs and menu rows: `rounded-md` to `rounded-xl`. Pills: `rounded-full`.

## Mechanics

- Direction: wrap the app (or a mixed-language region) in `DirectionProvider` from `@/components/foundations/direction/direction`, with an explicit BCP 47 `locale` (`ar`, `he`, `en-US`, `zh-CN`). Set matching `lang` and `dir` on `<html>` for full-app RTL. CSS `dir` alone does not configure React Aria keyboard navigation or portal placement. Use `useDirection()` for custom interactions and put its value on custom portal roots.
- Use logical styles: `ms`/`me`, `ps`/`pe`, `start`/`end`, `text-start`/`text-end`, `border-s`/`border-e`, `rounded-s`/`rounded-e`, and inline logical CSS properties. Mirror navigation/disclosure glyphs and horizontal drawer motion in RTL. Preserve physical coordinates for measured geometry, charts, canvas, and decorative art. Keep code, OTP digits, email addresses and URLs in explicit LTR regions; isolate mixed text with `<bdi>` or `dir="auto"`. Translating labels and formatting application data is separate from layout direction. See https://www.boardui.com/rtl.

- Internal vertical scroll regions must soften the top edge with a progressive blur and surface fade once scrolled, rather than sharply clipping content. Keep headers outside the scroll region. Use a stationary, `pointer-events-none`, `aria-hidden` overlay in a relative wrapper: a 24px masked 1px backdrop blur, a 16px masked 4px backdrop blur, and a gradient from the enclosing semantic surface token to transparent. Ramp each layer's opacity from 0 to 1 over the first 24px of scrolling; keep it invisible at scrollTop 0. Apply opacity to the individual layers, never the overlay parent (a translucent parent creates a backdrop root and can break blur at normal browser zoom). Verify top/reset, overflow, light/dark mode, and 100% zoom; preserve keyboard scrolling and do not blur the whole content area.

- Merge classes with `cx()` from `@/utils/cx` (tailwind-merge aware of BoardUI's composite text styles). No string concatenation, no plain `clsx`.
- Icons come from `@remixicon/react`, passed as component references (`leadingIcon={RiAddLine}`), not rendered elements.
- Form components build on `react-aria-components`; extend the installed BoardUI form components rather than raw `<input>`/`<select>`.
- Focus states: `outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring`.

When unsure about a token, a component's API, or working example code, ask the BoardUI MCP server: `get_theme`, `get_component`, `get_usage_examples`.

<!-- boardui:rules end -->
