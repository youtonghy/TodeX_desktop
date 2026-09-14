import { Button, Card, Chip, toast } from '@heroui/react';
import { RiFileCopyLine, RiGithubLine, RiServerLine } from '@remixicon/react';
import { AppIcon } from '../components/AppIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel } from '../session/helpers';
import { useT } from '../i18n';

const PROJECT_URL = 'https://github.com/youtonghy/TodeX_desktop';

type Props = {
  session: TodeXSession;
};

function InfoRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 border-b border-separator py-3 last:border-b-0">
      <dt className="text-muted shrink-0 text-sm">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-2 text-right text-sm font-medium">
        <span className="truncate" title={value}>{value}</span>
        {copyable ? (
          <Button isIconOnly size="sm" variant="ghost" aria-label={t('about.copyAria', { label })} onPress={() => void navigator.clipboard.writeText(value).then(() => toast.success(t('about.copied')))}>
            <RiFileCopyLine className="size-4" />
          </Button>
        ) : null}
      </dd>
    </div>
  );
}

export function AboutPanel({ session }: Props) {
  const t = useT();
  const connected = session.connectionState === 'open';
  const backendVersion = session.serverVersion
    ? `${session.serverVersion.name} ${session.serverVersion.version}`
    : t('about.notLoaded');

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center gap-4">
        <AppIcon className="size-16" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">TodeX Desktop</h2>
            <Chip size="sm" variant="soft">v{__TODEX_BUILD_VERSION__}</Chip>
          </div>
          <p className="text-muted mt-1 text-sm">{t('about.tagline')}</p>
        </div>
      </div>

      <Card className="p-5">
        <div className="mb-2 flex items-center gap-2">
          <RiServerLine className="text-muted size-4" />
          <h3 className="font-semibold">{t('about.runtime')}</h3>
          <Chip className="ml-auto" size="sm" color={connected ? 'success' : 'danger'} variant="soft">
            {connectionStateLabel(session.connectionState)}
          </Chip>
        </div>
        <dl>
          <InfoRow label={t('about.appVersion')} value={__TODEX_BUILD_VERSION__} />
          <InfoRow label={t('about.backendVersion')} value={backendVersion} />
          <InfoRow label={t('about.backendUrl')} value={session.settings.serverUrl || t('about.notConfigured')} copyable={Boolean(session.settings.serverUrl)} />
          <InfoRow label={t('about.workspace')} value={session.activeWorkspace?.path || t('about.notSelected')} copyable={Boolean(session.activeWorkspace?.path)} />
          <InfoRow label={t('about.dataDir')} value={session.serverVersion?.data_dir || t('about.notLoaded')} copyable={Boolean(session.serverVersion?.data_dir)} />
        </dl>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <RiGithubLine className="text-muted mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold">{t('about.projectUrl')}</h3>
            <p className="text-muted mt-1 truncate text-sm" title={PROJECT_URL}>{PROJECT_URL}</p>
          </div>
          <Button size="sm" variant="secondary" onPress={() => void navigator.clipboard.writeText(PROJECT_URL).then(() => toast.success(t('about.projectUrlCopied')))}>
            <RiFileCopyLine className="size-4" />
            {t('common.copy')}
          </Button>
        </div>
      </Card>
    </div>
  );
}
