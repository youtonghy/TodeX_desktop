import type { V2ApiClient } from '@todex/protocol/v2';
import {
  REMOTE_TRANSFER_MAX_BYTES,
  remoteBaseName,
  remoteJoinPath,
  remoteParentPath,
  type RemoteConnection,
  type RemoteConnectionKind,
} from '@todex/protocol/ssh';
import { base64FromDataUrl } from './helpers';
import { t } from '../i18n';

export type FileSourceEntry = { name: string; path: string; kind: 'directory' | 'file' | 'symlink' };

export type FileSourceFile = { name: string; path: string; mimeType: string; sizeBytes: number; text?: string; dataUrl?: string };

/**
 * A browsable file tree for the Files workbench pane. The workspace source
 * wraps the backend's workspace REST calls; the remote source wraps a
 * `/v2/remote/connections/{id}` SFTP/FTP session. Optional operations are
 * present only when the source supports them, and the pane shows the
 * matching toolbar actions only then.
 */
export type FileSource = {
  /** Stable identity; the pane resets its tree when it changes. */
  key: string;
  label: string;
  rootPath: string;
  /** "Add to chat" references only make sense for workspace files. */
  canAddReference: boolean;
  /** Open / Open With / Reveal act on this machine's filesystem. */
  canUseSystemShell: boolean;
  list: (directory: string) => Promise<FileSourceEntry[]>;
  read: (path: string) => Promise<FileSourceFile>;
  save: (path: string, text: string, expectedText: string) => Promise<{ saved: boolean }>;
  joinPath: (directory: string, name: string) => string;
  parentPath: (path: string) => string;
  upload?: (directory: string, file: File, overwrite: boolean) => Promise<string>;
  download?: (path: string) => Promise<void>;
  mkdir?: (path: string) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  remove?: (path: string) => Promise<void>;
};

function absoluteEntryPath(cwd: string, relativePath: string): string {
  return `${cwd.replace(/[\\/]$/, '')}/${relativePath.replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/')}`;
}

function sortEntries<T extends FileSourceEntry>(entries: T[]): T[] {
  return [...entries].sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name));
}

export function workspaceFileSource(api: () => V2ApiClient, rootPath: string, canUseSystemShell: boolean): FileSource {
  return {
    key: `workspace:${rootPath}`,
    label: rootPath.split(/[/\\]/).filter(Boolean).pop() || rootPath || 'workspace',
    rootPath,
    canAddReference: true,
    canUseSystemShell,
    list: async (directory) => {
      const snapshot = await api().listWorkspaceEntries(directory, '', 100);
      return sortEntries(snapshot.entries.map((entry) => ({ ...entry, path: absoluteEntryPath(directory, entry.path) })));
    },
    read: (path) => api().readWorkspaceFile(path),
    save: (path, text, expectedText) => api().saveWorkspaceFile(path, text, expectedText),
    joinPath: absoluteEntryPath,
    parentPath: (path) => path.replace(/[\\/][^\\/]*[\\/]?$/, '') || path,
  };
}

/** A remote file tab's binding; enough to reopen the connection after the
 * backend dropped it (5 min idle timeout or daemon restart). */
export type RemoteFilesBinding = {
  connectionId: string;
  kind: RemoteConnectionKind;
  label: string;
  homeDirectory: string;
  /** SFTP: the SSH host alias. */
  host?: string;
  /** FTP: the site id. */
  siteId?: string;
};

export function remoteFilesBinding(connection: RemoteConnection): RemoteFilesBinding {
  return {
    connectionId: connection.id,
    kind: connection.kind,
    label: connection.label,
    homeDirectory: connection.homeDirectory || '/',
    ...(connection.host ? { host: connection.host } : {}),
    ...(connection.siteId ? { siteId: connection.siteId } : {}),
  };
}

export function normalizeRemoteFilesBinding(value: unknown): RemoteFilesBinding | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  if (typeof source.connectionId !== 'string' || !source.connectionId) return undefined;
  if (source.kind !== 'sftp' && source.kind !== 'ftp') return undefined;
  return {
    connectionId: source.connectionId,
    kind: source.kind,
    label: typeof source.label === 'string' ? source.label : source.connectionId,
    homeDirectory: typeof source.homeDirectory === 'string' && source.homeDirectory ? source.homeDirectory : '/',
    ...(typeof source.host === 'string' && source.host ? { host: source.host } : {}),
    ...(typeof source.siteId === 'string' && source.siteId ? { siteId: source.siteId } : {}),
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(t('ssh.files.readLocalFailed')));
    reader.onload = () => resolve(typeof reader.result === 'string' ? base64FromDataUrl(reader.result) : '');
    reader.readAsDataURL(file);
  });
}

function bytesFromBase64(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function saveBlobAs(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoke after the click has handed the blob to the download manager.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Uploads one local file to `path` on the remote connection. The wire
 * format (JSON + base64) lives only here. */
export async function uploadRemoteFile(api: V2ApiClient, connectionId: string, path: string, file: File, overwrite = false): Promise<void> {
  if (file.size > REMOTE_TRANSFER_MAX_BYTES) throw new Error(t('ssh.files.tooLarge', { name: file.name }));
  const data = await readFileAsBase64(file);
  await api.uploadRemoteFile(connectionId, path, data, overwrite);
}

/** Downloads `path` from the remote connection and hands it to the
 * browser/Electron download manager. */
export async function downloadRemoteFile(api: V2ApiClient, connectionId: string, path: string): Promise<void> {
  const file = await api.downloadRemoteFile(connectionId, path);
  saveBlobAs(file.name || remoteBaseName(path), new Blob([bytesFromBase64(file.data)], { type: 'application/octet-stream' }));
}

export function remoteFileSource(api: () => V2ApiClient, binding: RemoteFilesBinding): FileSource {
  const id = binding.connectionId;
  return {
    key: `remote:${id}`,
    label: binding.label,
    rootPath: binding.homeDirectory || '/',
    canAddReference: false,
    canUseSystemShell: false,
    list: async (directory) => (await api().listRemoteEntries(id, directory)).entries,
    read: (path) => api().readRemoteFile(id, path),
    save: (path, text, expectedText) => api().saveRemoteFile(id, path, text, expectedText),
    joinPath: remoteJoinPath,
    parentPath: remoteParentPath,
    upload: async (directory, file, overwrite) => {
      const path = remoteJoinPath(directory, file.name);
      await uploadRemoteFile(api(), id, path, file, overwrite);
      return path;
    },
    download: (path) => downloadRemoteFile(api(), id, path),
    mkdir: async (path) => { await api().createRemoteDirectory(id, path); },
    rename: async (from, to) => { await api().renameRemoteEntry(id, from, to); },
    remove: async (path) => { await api().deleteRemoteEntry(id, path); },
  };
}
