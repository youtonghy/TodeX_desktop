import type { V2ApiClient } from '@todex/protocol/v2';
import {
  TERMINAL_IMAGE_MAX_BYTES,
  TERMINAL_REMOTE_IMAGE_DIR,
  isStaleTerminalImage,
  terminalImageName,
  terminalImageNeedsPng,
} from '@todex/protocol/terminalText';
import { t } from '../i18n';
import { loadSshPassword } from '../lib/sshPasswordStore';
import { uploadPromptFile } from './promptUploads';
import { uploadRemoteFile } from './fileSources';

/** Where a terminal's pasted images go: the backend machine (local shells)
 * or the SSH host the terminal is logged into. */
export type TerminalImageTarget =
  | { kind: 'backend'; api: V2ApiClient }
  | { kind: 'ssh'; api: V2ApiClient; backendId: string; host: string };

/** SFTP connections reused for pastes, per backend and host. */
const remoteConnections = new Map<string, Promise<{ id: string; home: string }>>();

/** A PNG copy of an image the agents may not read (BMP, TIFF, …). */
async function toPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error(t('xterm.imageConvertFailed')))), 'image/png');
  });
}

async function remoteConnection(target: Extract<TerminalImageTarget, { kind: 'ssh' }>, fresh: boolean) {
  const key = `${target.backendId}\n${target.host}`;
  if (fresh) remoteConnections.delete(key);
  let connection = remoteConnections.get(key);
  if (!connection) {
    connection = (async () => {
      const password = (await loadSshPassword(target.backendId, target.host)) ?? undefined;
      const { connection: opened } = await target.api.openRemoteConnection({ kind: 'sftp', host: target.host, ...(password ? { password } : {}) });
      return { id: opened.id, home: opened.homeDirectory.replace(/\/+$/, '') };
    })();
    remoteConnections.set(key, connection);
    connection.catch(() => remoteConnections.delete(key));
  }
  return connection;
}

/** Creates `~/.cache/todex/paste` level by level and drops week-old pastes. */
async function prepareRemoteDirectory(api: V2ApiClient, id: string, home: string): Promise<string> {
  let path = home;
  for (const part of TERMINAL_REMOTE_IMAGE_DIR.split('/')) {
    path = `${path}/${part}`;
    // An existing directory answers 409; anything worse shows on upload.
    await api.createRemoteDirectory(id, path).catch(() => undefined);
  }
  const now = Date.now();
  const listing = await api.listRemoteEntries(id, path).catch(() => null);
  for (const entry of listing?.entries ?? []) {
    if (entry.kind === 'file' && isStaleTerminalImage(entry.name, entry.modifiedAt, now)) {
      await api.deleteRemoteEntry(id, entry.path).catch(() => undefined);
    }
  }
  return path;
}

async function uploadToHost(target: Extract<TerminalImageTarget, { kind: 'ssh' }>, name: string, file: File): Promise<string> {
  for (const fresh of [false, true]) {
    const connection = await remoteConnection(target, fresh);
    try {
      const directory = await prepareRemoteDirectory(target.api, connection.id, connection.home);
      const path = `${directory}/${name}`;
      await uploadRemoteFile(target.api, connection.id, path, file, true);
      return path;
    } catch (error) {
      // The connection may have closed after its idle timeout: reopen once.
      if (fresh) throw error;
    }
  }
  throw new Error(t('xterm.imageUploadFailed'));
}

/**
 * Stores pasted or dropped images where the terminal's programs can read
 * them and returns their absolute paths, in order. Each image is checked
 * and, when the agents cannot read its format, converted to PNG first.
 */
export async function uploadTerminalImages(files: File[], target: TerminalImageTarget): Promise<string[]> {
  const when = new Date();
  const paths: string[] = [];
  for (const [index, file] of files.entries()) {
    if (file.size > TERMINAL_IMAGE_MAX_BYTES) {
      throw new Error(t('xterm.imageTooLarge', { name: file.name || t('xterm.image') }));
    }
    const blob = terminalImageNeedsPng(file.type) ? await toPng(file) : file;
    const type = blob === file ? file.type : 'image/png';
    const name = terminalImageName(type, when, index);
    if (target.kind === 'backend') {
      const stored = await uploadPromptFile(target.api, name, blob);
      paths.push(stored.path);
    } else {
      paths.push(await uploadToHost(target, name, new File([blob], name, { type })));
    }
  }
  return paths;
}
