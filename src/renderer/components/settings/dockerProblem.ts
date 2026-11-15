import type { DockerProblem } from '../../../preload/containerTypes';
import type { useT } from '../../i18n';

type T = ReturnType<typeof useT>;

export function dockerProblemText(t: T, problem: DockerProblem): string {
  return t(problem === 'missing' ? 'container.env.missing' : problem === 'permission' ? 'container.env.permission' : 'container.env.daemonDown');
}
