/**
 * Computer Use policy, applied by the desktop before the helper acts.
 * The daemon decides who may use the screen; this decides what may be
 * touched on it.
 */

/** Apps an agent may never control, whatever the user approved. */
export const BLOCKED_BUNDLE_IDS: ReadonlySet<string> = new Set([
  // TodeX itself: its permission cards must stay out of the agent's reach.
  'com.unbaked0692.todexdesktop',
  'com.github.Electron',
  // System authentication and credentials.
  'com.apple.SecurityAgent',
  'com.apple.LocalAuthentication.UIAgent',
  'com.apple.coreautha',
  'com.apple.keychainaccess',
  'com.apple.Passwords',
  'com.apple.systempreferences',
  'com.apple.Settings',
  'com.apple.loginwindow',
  // Password managers.
  'com.1password.1password',
  'com.agilebits.onepassword7',
  'com.bitwarden.desktop',
  'com.lastpass.LastPass',
  'com.dashlane.dashlanephonefinal',
  'in.sinew.Enpass-Desktop',
  'com.keepassxc.keepassxc',
]);

/** The user's own pointer/keyboard activity this recent pauses pointer actions. */
export const USER_ACTIVE_SECONDS = 2;

/** Actions that always move the user's pointer. */
const POINTER_ONLY = new Set(['double_click', 'hover', 'drag']);

export type Target = { bundleId: string; name: string; pid: number };

export type PolicyFailure = {
  code: 'TARGET_BLOCKED' | 'APP_CONFIRM' | 'USER_ACTIVE';
  message: string;
  detail?: Record<string, unknown>;
};

/** Whether an action will move the pointer (coordinates, or pointer-only actions). */
export function usesPointer(action: string, hasPoint: boolean): boolean {
  return hasPoint || POINTER_ONLY.has(action);
}

/**
 * The failure to report for acting on `target`, or null when allowed.
 * `ownPid` blocks TodeX itself even under an unexpected bundle id.
 */
export function checkTarget(
  target: Target,
  allowedApps: readonly string[],
  ownPid: number,
): PolicyFailure | null {
  if (target.pid === ownPid || BLOCKED_BUNDLE_IDS.has(target.bundleId)) {
    return { code: 'TARGET_BLOCKED', message: `${target.name || target.bundleId} can never be controlled by an agent.` };
  }
  if (!target.bundleId) {
    // Nothing identifiable under the point (desktop, menu bar extras).
    return null;
  }
  if (!allowedApps.includes(target.bundleId)) {
    return {
      code: 'APP_CONFIRM',
      message: `first action in ${target.name || target.bundleId} during this conversation`,
      detail: { bundleId: target.bundleId, name: target.name || target.bundleId },
    };
  }
  return null;
}

export function checkUserActive(action: string, hasPoint: boolean, idleSeconds: number): PolicyFailure | null {
  if (!usesPointer(action, hasPoint) || idleSeconds >= USER_ACTIVE_SECONDS) return null;
  return { code: 'USER_ACTIVE', message: 'The user is using the mouse or keyboard; retry in a few seconds.' };
}

/** Mapping from a screenshot's pixels to global screen points. */
export type ShotMapping = { originX: number; originY: number; pointsPerPixel: number; width: number; height: number };

/** Screenshot pixel → global point; null when outside the screenshot. */
export function toScreenPoint(mapping: ShotMapping, x: number, y: number): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > mapping.width || y > mapping.height) return null;
  return { x: mapping.originX + x * mapping.pointsPerPixel, y: mapping.originY + y * mapping.pointsPerPixel };
}

/** Darwin major version of macOS 14 Sonoma. */
const DARWIN_SONOMA = 23;

export function supportedOs(platform: string, release: string): boolean {
  return platform === 'darwin' && Number(release.split('.')[0]) >= DARWIN_SONOMA;
}
