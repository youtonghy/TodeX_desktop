// Saved SSH host passwords, one per backend profile and host alias. The
// desktop seals them with the OS keychain through Electron safeStorage (main
// process `secureStore:*`); the backend never stores them and receives one
// only for the connection it opens.

const passwordKey = (backendId: string, alias: string) => `todex.desktop.sshPassword.v1.${backendId}.${alias}`;

/** Whether this client can remember passwords at all (false on the web). */
export const sshPasswordsRememberable = true;

/** Whether remembering works right now (an OS keychain is available). */
export async function canRememberSshPasswords(): Promise<boolean> {
  try {
    return await window.todexDesktop.secureStore.available();
  } catch {
    return false;
  }
}

/** The saved password, or `null` when none is saved or the keychain fails. */
export async function loadSshPassword(backendId: string, alias: string): Promise<string | null> {
  try {
    return await window.todexDesktop.secureStore.get(passwordKey(backendId, alias));
  } catch {
    return null;
  }
}

/** Saves `password`, or forgets the saved one when it is `null`. */
export async function saveSshPassword(backendId: string, alias: string, password: string | null): Promise<void> {
  await window.todexDesktop.secureStore.set(passwordKey(backendId, alias), password || null);
}
