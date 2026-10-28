import { RiFileCopyLine, RiGithubLine, RiServerLine } from '@remixicon/react';
import { Chip } from '@/components/base/badges/chip';
import { Button } from '@/components/base/buttons/button';
import { IconAction } from '@/components/ui/icon-action';
import { toast } from '@/components/ui/toast';
import { AppIcon } from '../components/AppIcon';
import type { TodeXSession } from '../session/useTodeXSession';
import { connectionStateLabel } from '../session/helpers';
import { useT } from '../i18n';
import { platform } from '../platform';
import { slots } from '../platform/slots';

const PROJECT_URL = 'https://github.com/youtonghy/TodeX_desktop';

type Props = {
  session: TodeXSession;
};

/** Settings-row recipe: label left, value (and copy action) right. */
function InfoRow({ label, value, copyable = false }: { label: string; value: string; copyable?: boolean }) {
  const t = useT();
  return (
    <div className="flex min-h-[52px] min-w-0 items-center justify-between gap-4 border-b border-separator-border py-2.5 pe-2.5 last:border-b-0">
      <dt className="shrink-0 text-body-regular text-text-primary">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1 text-right text-body-regular text-text-secondary">
        <span className="truncate" title={value}>{value}</span>
        {copyable ? (
          <IconAction
            icon={RiFileCopyLine}
            size="sm"
            className="-my-1.5"
            aria-label={t('about.copyAria', { label })}
            onClick={() => void navigator.clipboard.writeText(value).then(() => toast.success(t('about.copied')))}
          />
        ) : null}
      </dd>
    </div>
  );
}

/** The About page of settings: build, runtime, host extras (desktop updates) and project link. */
export function AboutPanel({ session }: Props) {
  const t = useT();
  const { AboutExtras } = slots;
  const connected = session.connectionState === 'open';
  const backendVersion = session.serverVersion
    ? `${session.serverVersion.name} ${session.serverVersion.version}`
    : t('about.notLoaded');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <AppIcon className="size-16" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title-2-semibold text-text-primary">{platform.productName}</h2>
            <Chip variant="caption" color="neutral">v{__TODEX_BUILD_VERSION__}</Chip>
          </div>
          <p className="mt-1 text-body-regular text-text-secondary">{t('about.tagline')}</p>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5 px-3">
          <RiServerLine aria-hidden className="size-4 text-foreground-icon-secondary" />
          <h3 className="text-body-2-medium text-text-secondary">{t('about.runtime')}</h3>
          <Chip className="ms-auto" variant="caption" color={connected ? 'lime' : 'rose'}>
            {connectionStateLabel(session.connectionState)}
          </Chip>
        </div>
        <dl className="flex w-full flex-col rounded-2xl bg-background-secondary-default ps-3">
          <InfoRow label={t('about.appVersion')} value={__TODEX_BUILD_VERSION__} />
          <InfoRow label={t('about.backendVersion')} value={backendVersion} />
          <InfoRow label={t('about.backendUrl')} value={session.settings.serverUrl || t('about.notConfigured')} copyable={Boolean(session.settings.serverUrl)} />
          <InfoRow label={t('about.workspace')} value={session.activeWorkspace?.path || t('about.notSelected')} copyable={Boolean(session.activeWorkspace?.path)} />
          <InfoRow label={t('about.dataDir')} value={session.serverVersion?.data_dir || t('about.notLoaded')} copyable={Boolean(session.serverVersion?.data_dir)} />
        </dl>
      </section>

      {AboutExtras ? <AboutExtras /> : null}

      <div className="flex min-h-[52px] items-center gap-2.5 rounded-2xl bg-background-secondary-default py-2.5 ps-3 pe-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-stat-card-icon-background">
          <RiGithubLine aria-hidden className="size-5 text-foreground-icon-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body-regular text-text-primary">{t('about.projectUrl')}</h3>
          <p className="truncate text-body-2-regular text-text-secondary" title={PROJECT_URL}>{PROJECT_URL}</p>
        </div>
        <Button
          size="small"
          variant="secondary"
          leadingIcon={RiFileCopyLine}
          onClick={() => void navigator.clipboard.writeText(PROJECT_URL).then(() => toast.success(t('about.projectUrlCopied')))}
        >
          {t('common.copy')}
        </Button>
      </div>
    </div>
  );
}
