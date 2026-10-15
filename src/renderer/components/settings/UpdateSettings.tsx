import { useEffect, useState } from 'react';
import { RiDownload2Line, RiExternalLinkLine, RiRefreshLine, RiRestartLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { LinkButton } from '@/components/base/buttons/link-button';
import { Switch } from '@/components/base/switch/switch';
import type { UpdateState } from '../../../preload/index';
import { getLocale, useT } from '../../i18n';
import { ProgressBar } from '../ui/progress-bar';
import { SpinnerIcon } from '../ui/spinner';
import { SettingsCard, SettingsGroup, SettingsNote, SettingsRow } from './SettingsRows';

const RELEASES_URL = 'https://github.com/youtonghy/TodeX_desktop/releases';

/** The main process's update state, live; `null` until the first read. */
export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let live = true;
    const unsubscribe = window.todexDesktop.updates.onState(setState);
    void window.todexDesktop.updates.getState().then((initial) => {
      if (live) setState((current) => current ?? initial);
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return state;
}

/** Desktop-only "Software update" card on the About settings page. */
export function UpdateSettings() {
  const t = useT();
  const state = useUpdateState();
  if (!state) return null;
  const { updates } = window.todexDesktop;
  const { status, version } = state;
  const unsupported = status === 'unsupported';

  let title: string;
  let description: string;
  if (status === 'unsupported') {
    title = t('updates.unsupported');
    description = state.reason === 'appimage' ? t('updates.unsupportedAppImage') : t('updates.unsupportedDev');
  } else if (status === 'checking') {
    title = t('updates.checking');
    description = t('updates.current', { version: state.currentVersion });
  } else if (status === 'available') {
    title = t('updates.available', { version: version ?? '' });
    description = t('updates.current', { version: state.currentVersion });
  } else if (status === 'downloading') {
    title = t('updates.downloading', { version: version ?? '' });
    description = t('updates.current', { version: state.currentVersion });
  } else if (status === 'downloaded') {
    title = t('updates.downloaded', { version: version ?? '' });
    description = t('updates.downloadedHint');
  } else if (status === 'error') {
    title = t('updates.failed');
    description = t('updates.current', { version: state.currentVersion });
  } else {
    title = state.lastChecked ? t('updates.upToDate') : t('updates.current', { version: state.currentVersion });
    description = state.lastChecked
      ? t('updates.lastChecked', { time: new Date(state.lastChecked).toLocaleString(getLocale()) })
      : t('updates.notChecked');
  }

  // A failed download retries the download; anything else checks again.
  let action;
  if (status === 'available') {
    action = <Button size="small" leadingIcon={RiDownload2Line} onClick={() => void updates.download()}>{t('updates.download')}</Button>;
  } else if (status === 'downloaded') {
    action = <Button size="small" leadingIcon={RiRestartLine} onClick={() => updates.install()}>{t('updates.restart')}</Button>;
  } else if (status === 'checking' || status === 'downloading') {
    action = <Button size="small" variant="secondary" leadingIcon={SpinnerIcon} disabled>{status === 'checking' ? t('updates.check') : t('updates.download')}</Button>;
  } else if (status === 'error') {
    action = <Button size="small" variant="secondary" leadingIcon={RiRefreshLine} onClick={() => void (version ? updates.download() : updates.check())}>{t('updates.retry')}</Button>;
  } else {
    action = <Button size="small" variant="secondary" leadingIcon={RiRefreshLine} disabled={unsupported} onClick={() => void updates.check()}>{t('updates.check')}</Button>;
  }

  return (
    <SettingsGroup label={t('updates.title')}>
      <SettingsCard>
        <SettingsRow label={title} description={description}>
          {version && status !== 'error' ? (
            <LinkButton size="small" variant="secondary" href={`${RELEASES_URL}/tag/v${version}`} target="_blank" rel="noopener noreferrer" trailingIcon={RiExternalLinkLine}>
              {t('updates.releaseNotes')}
            </LinkButton>
          ) : null}
          {action}
        </SettingsRow>
        {status === 'downloading' ? (
          <SettingsNote>
            <ProgressBar value={state.progress ?? 0} aria-label={t('updates.downloading', { version: version ?? '' })} />
          </SettingsNote>
        ) : null}
        {status === 'error' && state.error ? (
          <SettingsNote tone="danger" role="alert"><span className="line-clamp-3 break-words">{state.error}</span></SettingsNote>
        ) : null}
        <SettingsRow label={t('updates.autoDownload')} description={t('updates.autoDownloadHint')}>
          <Switch
            size="sm"
            aria-label={t('updates.autoDownload')}
            isSelected={state.autoDownload}
            isDisabled={unsupported}
            onChange={(selected) => void updates.setAutoDownload(selected)}
          />
        </SettingsRow>
      </SettingsCard>
    </SettingsGroup>
  );
}
