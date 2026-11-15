import { ContainerFreezer } from '../components/container/ContainerFreezer';
import { ContainerMountCleanup } from '../components/container/ContainerMountCleanup';
import { ContainerSetupNotices } from '../components/workspace/ContainerWorkspaceFlow';
import type { TodeXSession } from '../session/useTodeXSession';

/** Container housekeeping rendered beside the app, where Docker is available. */
export function AppOverlays({ session }: { session: TodeXSession }) {
  if (!window.todexDesktop.container.available) return null;
  return (
    <>
      {session.hydrated ? <ContainerMountCleanup session={session} /> : null}
      {session.hydrated ? <ContainerFreezer session={session} /> : null}
      <ContainerSetupNotices />
    </>
  );
}
