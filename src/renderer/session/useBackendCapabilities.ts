import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ProviderKind } from '@todex/protocol/v2';
import { useT } from '../i18n';
import type { CapabilityManager, CatalogState } from '../screens/CapabilitiesPanel';
import { backendApi } from './helpers';
import type { PanelBackend } from './panelBackend';
import type { TodeXSession } from './useTodeXSession';

type Catalogs = Partial<Record<ProviderKind, CatalogState>>;

/** Skills and MCPs of a backend that is not the focused one, read in its
 * scratch root (its user-level catalog, without any project's). The focused
 * backend's catalog lives in the session instead, next to the conversation
 * its skills attach to. */
export function useBackendCapabilities(session: TodeXSession, backend: PanelBackend, enabled: boolean) {
  const t = useT();
  const { settings } = backend;
  const workspacePath = session.backendLinkStatus[backend.backendId]?.serverVersion?.scratch_workspace_root || settings.defaultWorkspacePath;
  const [catalogs, setCatalogs] = useState<Catalogs>({});
  const catalogsRef = useRef(catalogs);
  catalogsRef.current = catalogs;
  const api = useCallback(() => backendApi(settings), [settings]);
  // A read that lands after the backend or path changed is dropped.
  const scope = `${backend.backendId}\n${workspacePath}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const refresh = useCallback(async (provider: ProviderKind) => {
    if (!workspacePath) return;
    setCatalogs((current) => ({ ...current, [provider]: { ...(current[provider] ?? {}), status: 'loading', error: undefined } }));
    try {
      const client = api();
      const [skills, mcp] = await Promise.all([
        client.listSkillCatalog(provider, workspacePath),
        client.listMcpCatalog(provider, workspacePath),
      ]);
      if (scopeRef.current !== scope) return;
      setCatalogs((current) => ({ ...current, [provider]: { status: 'ready', skills, mcp } }));
    } catch (error) {
      if (scopeRef.current !== scope) return;
      setCatalogs((current) => ({
        ...current,
        [provider]: { ...(current[provider] ?? {}), status: 'error', error: error instanceof Error ? error.message : t('sess.catalogReadFailed') },
      }));
    }
  }, [api, scope, t, workspacePath]);

  // Loads each available agent's catalog once; a new workspace path or
  // backend starts over.
  useEffect(() => {
    setCatalogs({});
  }, [scope]);
  useEffect(() => {
    if (!enabled) return;
    for (const provider of backend.providers) {
      if (provider.available && !catalogsRef.current[provider.id]) void refresh(provider.id);
    }
  }, [backend.providers, catalogs, enabled, refresh]);

  const requirePath = useCallback(() => {
    if (!workspacePath) throw new Error(t('sess.pickWorkspaceFirst'));
    return workspacePath;
  }, [t, workspacePath]);

  // Shared skill folders and files such as `.mcp.json` are read by several
  // providers, so a write reloads every catalog already on screen.
  const mutate = useCallback(async <T,>(provider: ProviderKind, write: (client: ReturnType<typeof backendApi>, path: string) => Promise<T>) => {
    const result = await write(api(), requirePath());
    const loaded = (Object.keys(catalogsRef.current) as ProviderKind[]).filter((kind) => catalogsRef.current[kind]);
    await Promise.all([...new Set([provider, ...loaded])].map((kind) => refresh(kind)));
    return result;
  }, [api, refresh, requirePath]);

  const manager = useMemo<CapabilityManager>(() => ({
    createSkill: (provider, input) => mutate(provider, (client, path) => client.createSkill(provider, path, input)),
    updateSkill: (provider, resourceId, content) => mutate(provider, (client, path) => client.updateSkill(provider, path, resourceId, content)),
    deleteSkill: (provider, resourceId) => mutate(provider, (client, path) => client.deleteSkill(provider, path, resourceId)).then(() => undefined),
    createMcpServer: (provider, input) => mutate(provider, (client, path) => client.createMcpServer(provider, path, input)),
    updateMcpServer: (provider, resourceId, input) => mutate(provider, (client, path) => client.updateMcpServer(provider, path, resourceId, input)),
    deleteMcpServer: (provider, resourceId) => mutate(provider, (client, path) => client.deleteMcpServer(provider, path, resourceId)).then(() => undefined),
  }), [mutate]);

  const previewSkill = useCallback(async (provider: ProviderKind, resourceId: string) => (
    (await api().getSkillResource(provider, requirePath(), resourceId)).content
  ), [api, requirePath]);
  const loadMcpConfig = useCallback((provider: ProviderKind, resourceId: string) => (
    api().getMcpServerConfig(provider, requirePath(), resourceId)
  ), [api, requirePath]);

  return { workspacePath, catalogs, refresh, manager, previewSkill, loadMcpConfig };
}
