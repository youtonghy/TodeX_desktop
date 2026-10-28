// Desktop pieces of the shared screens (see ./types.ts PlatformSlots):
// local backend and containers, updates and the Workbench browser tab.
import { useEffect, useRef } from 'react';
import { RiBox3Line, RiHardDrive3Line } from '@remixicon/react';
import { toast } from '@/components/ui/toast';
import { BrowserPane } from '../components/BrowserPane';
import { ContainerFreezer } from '../components/container/ContainerFreezer';
import { ContainerMountCleanup } from '../components/container/ContainerMountCleanup';
import { ContainerSettings } from '../components/settings/ContainerSettings';
import { LocalBackendSettings } from '../components/settings/LocalBackendSettings';
import { UpdateSettings } from '../components/settings/UpdateSettings';
import { ContainerSetupNotices, useContainerWorkspaceFlow } from '../components/workspace/ContainerWorkspaceFlow';
import { useIpcDaemonConflicts } from '../session/useIpcDaemonConflicts';
import { useNativeIpcReminder } from '../session/useNativeIpcReminder';
import type { TodeXSession } from '../session/useTodeXSession';
import { useT } from '../i18n';
import { platform } from './index';
import type { PlatformSettingsSection, PlatformSlots } from './types';

const containersAvailable = () => window.todexDesktop.container.available;

function AppOverlays({ session }: { session: TodeXSession }) {
  if (!containersAvailable()) return null;
  return (
    <>
      {session.hydrated ? <ContainerMountCleanup session={session} /> : null}
      {session.hydrated ? <ContainerFreezer session={session} /> : null}
      <ContainerSetupNotices />
    </>
  );
}

/** The native "Check for Updates…" item shows the About settings page; a
 * release downloaded in the background offers a restart once per version. */
function useAppEffects(showSettings: (section: 'about') => void): void {
  const t = useT();
  const showRef = useRef(showSettings);
  showRef.current = showSettings;
  const tRef = useRef(t);
  tRef.current = t;
  const toastVersionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const { updates } = window.todexDesktop;
    const offShow = updates.onShow(() => showRef.current('about'));
    const offState = updates.onState((state) => {
      if (state.status !== 'downloaded' || !state.version || toastVersionRef.current === state.version) return;
      toastVersionRef.current = state.version;
      const tr = tRef.current;
      toast.success(tr('updates.readyToast', { version: state.version }), {
        description: tr('updates.downloadedHint'),
        timeout: 0,
        actionProps: { children: tr('updates.restart'), onPress: () => updates.install() },
      });
    });
    return () => {
      offShow();
      offState();
    };
  }, []);
}

function useSessionEffects(session: TodeXSession): void {
  useNativeIpcReminder(session, platform.productName);
  useIpcDaemonConflicts(session);
}

const LOCAL_BACKEND_SECTION: PlatformSettingsSection = { id: 'local-backend', labelKey: 'localBackend.title', icon: RiHardDrive3Line, Component: LocalBackendSettings };
const CONTAINER_SECTION: PlatformSettingsSection = { id: 'container', labelKey: 'container.title', icon: RiBox3Line, Component: ContainerSettings };

export const slots: PlatformSlots = {
  useSessionEffects,
  useAppEffects,
  AppOverlays,
  // Running a backend or containers on this machine needs the main process.
  get settingsSections() {
    return [
      ...(window.todexDesktop.localBackend?.available ? [LOCAL_BACKEND_SECTION] : []),
      ...(window.todexDesktop.container?.available ? [CONTAINER_SECTION] : []),
    ];
  },
  AboutExtras: UpdateSettings,
  BrowserPane,
  get containerWorkspaces() { return containersAvailable(); },
  useContainerWorkspaceFlow,
};
