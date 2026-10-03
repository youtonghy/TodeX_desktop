import { ExecutorLink, type ExecutorHandlers, type ExecutorLogger } from './executorLink';
import { readExecutorProfiles, sameProfile } from './profiles';

/**
 * Keeps one executor link per paired backend profile, following the store
 * the renderer writes. Links outlive renderer reloads and backend switches.
 */
export class ExecutorManager {
  private readonly links = new Map<string, ExecutorLink>();
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly readStore: () => Record<string, unknown>,
    private readonly defaultServerUrl: string,
    private readonly handlers: ExecutorHandlers,
    private readonly log: ExecutorLogger,
  ) {}

  start(): void {
    this.reconcile();
  }

  /** Store writes come in bursts; reconcile once they settle. */
  scheduleReconcile(): void {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      this.reconcile();
    }, 500);
    this.reconcileTimer.unref?.();
  }

  /** Re-check every backend now (desktop tools may have been switched on). */
  refresh(): void {
    for (const link of this.links.values()) link.refresh();
  }

  link(profileId: string): ExecutorLink | undefined {
    return this.links.get(profileId);
  }

  stop(): void {
    for (const link of this.links.values()) link.stop();
    this.links.clear();
  }

  private reconcile(): void {
    const profiles = readExecutorProfiles(this.readStore(), this.defaultServerUrl);
    const wanted = new Map(profiles.map(profile => [profile.id, profile]));
    for (const [id, link] of this.links) {
      const next = wanted.get(id);
      if (!next || !sameProfile(link.profile, next)) {
        link.stop();
        this.links.delete(id);
      }
    }
    for (const profile of profiles) {
      if (this.links.has(profile.id)) continue;
      const link = new ExecutorLink(profile, this.handlers, this.log);
      this.links.set(profile.id, link);
      link.start();
    }
  }
}
