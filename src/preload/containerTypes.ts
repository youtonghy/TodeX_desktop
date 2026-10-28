/** Shapes of the `container` bridge (main: src/main/container). */

export type DockerProblem = 'missing' | 'permission' | 'daemonDown';

/** Mirror of the main process's DockerEnvironment (src/main/container/docker.ts). */
export type DockerEnvironment = {
  clientVersion: string | null;
  serverVersion: string | null;
  /** Why the Docker daemon cannot be used, null when it can. */
  problem: DockerProblem | null;
  problemDetail: string | null;
  composeVersion: string | null;
  operatingSystem: string | null;
  rootless: boolean;
  userns: boolean;
  podman: boolean;
  /** Tags of the TodeX container image present locally. */
  imageTags: string[];
};

export type ContainerMount = { host: string; target: string };

/** Mirror of the main process's ContainerInfo (src/main/container/index.ts). */
export type ContainerInfo = {
  name: string;
  /** Has a todexc instance directory: can be recreated, remounted, upgraded and removed. */
  managed: boolean;
  /** Created by Desktop. */
  desktop: boolean;
  container: string | null;
  /** Docker's state (`running`, `exited`, …), or `removed` when only the instance settings are left. */
  state: string;
  health: 'healthy' | 'unhealthy' | 'starting' | null;
  image: string | null;
  listen: string | null;
  /** The published host port; null when the container is reached over its shared socket only. */
  port: number | null;
  /** Host ports Desktop moved the container off (newest last); profiles still pointing there are re-pointed. */
  formerPorts: number[];
  mounts: ContainerMount[];
  sshAgent: boolean;
  socketPath: string | null;
  /** The local-backend IPC instance (`todex-ipc://<id>`) serving the shared socket. */
  ipcInstance: string | null;
  /** The IPC instance id the container's socket has whenever it is shared. */
  ipcId: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ContainerProgress = { name: string; phase: 'pull' | 'start' | 'wait' | 'stop' | 'remove'; line?: string };

export type ContainerMountResult = { target: string; backendPath: string; recreated: boolean };

/** One batch of setup output: `lines` in order; `line` is the batch joined with newlines (older listeners). */
export type ContainerSetupOutput = { jobId: string; line: string; lines: string[] };
export type ContainerSetupDone = { jobId: string; ok: boolean; exitCode: number | null; error: string | null; cancelled: boolean };

/** Settings → TodeX Container → Automatic cleanup (store key `todex.desktop.container.v1`). */
export type ContainerPrefs = {
  /** Default on: delete TodeX image versions no container uses after upgrades and on schedule. */
  cleanupImages?: boolean;
  /** Remove containers stopped for this many days (0/absent: never). Home volumes stay. */
  removeStoppedDays?: number;
  /** Unmount folders no workspace uses any more, once the container is idle. */
  pruneMounts?: boolean;
  /** Stop the containers Desktop created when TodeX quits. */
  stopOnQuit?: boolean;
  /** Freeze (`docker pause`) a container after this many idle minutes; 0/absent: never. */
  freezeIdleMinutes?: number;
  /** First host port containers are published on, where they need one (default 17345). */
  portStart?: number;
  /** How many ports from `portStart` to choose from (default 100). */
  portCount?: number;
};
