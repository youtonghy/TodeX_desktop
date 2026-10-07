/**
 * Debug logs keep a URL's shape but not its query values: device-auth
 * signatures, nonces and transport handshake keys (`client_key`,
 * `ciphertext`) travel in the WebSocket query string.
 */
export function redactUrlQuery(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    const queryStart = raw.indexOf('?');
    return queryStart < 0 ? raw : `${raw.slice(0, queryStart)}?[redacted]`;
  }
  url.hash = '';
  if (!url.search) return url.href;
  const names = [...new Set(url.searchParams.keys())];
  url.search = '';
  return `${url.href}?${names.map((name) => `${encodeURIComponent(name)}=[redacted]`).join('&')}`;
}
