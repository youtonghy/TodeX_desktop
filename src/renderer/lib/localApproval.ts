/**
 * Desktop: approves a pairing request on a TodeX container of this machine
 * that does not share its IPC socket (Docker Desktop) by running the same
 * `docker exec … pair approve <code>` the pairing panel shows. Resolves false
 * when no single running container publishes `serverUrl`'s port (nothing was
 * tried); rejects when the command failed.
 */
export async function approveContainerPairing(serverUrl: string, verificationCode: string): Promise<boolean> {
  const localBackend = window.todexDesktop.localBackend;
  if (!localBackend.available) return false;
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return false;
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return false;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  const published = new RegExp(`:${port}->7345/tcp$`);
  const containers = await localBackend.dockerContainers();
  const matches = containers.filter((item) => item.ports.split(',').some((entry) => published.test(entry.trim())));
  if (matches.length !== 1) return false;
  await localBackend.dockerApprove(matches[0].container, verificationCode);
  return true;
}
