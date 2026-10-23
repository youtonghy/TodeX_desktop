import { Alert } from '@/components/ui/alert';
import { CodeBlock } from '@/components/ui/code-block';
import { useT } from '../i18n';
import { containerMountCommand } from '../session/helpers';

/** A container backend cannot see `path`: how to mount it from the host. */
export function WorkspaceMountHint({ path }: { path: string }) {
  const t = useT();
  return (
    <Alert status="warning" title={t('app.workspaceNotMountedTitle')} description={t('app.workspaceNotMountedHint')}>
      <CodeBlock className="mt-2" code={containerMountCommand(path)} language="bash" title="shell" copyLabel={t('pair.copyCommand')} />
    </Alert>
  );
}
