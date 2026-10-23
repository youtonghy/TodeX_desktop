/** The backend's socket-only admin API (TodeX_backend docs/API.md); the renderer never reaches it directly. */
export const LOCAL_ADMIN_PREFIX = '/v2/local-admin';

/** Whether `pathname` reaches the local-admin API, however it is spelled
 * (percent-encoding, repeated slashes, case); undecodable paths count too. */
export function isLocalAdminPath(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  const normalized = decoded.replace(/[\\/]+/g, '/').toLowerCase();
  return normalized === LOCAL_ADMIN_PREFIX || normalized.startsWith(`${LOCAL_ADMIN_PREFIX}/`);
}
