import { Spinner } from '@/components/ui/spinner';
import { cx } from '@/utils/cx';
import type { GitDiffState } from '../session/helpers';
import { useT } from '../i18n';

/** The diff text of a Git Diff view: a loading row while a read runs with
 * nothing to show yet, the base it compares against, then the diff, the
 * error or the empty note. */
export function GitDiffText({ state }: { state: GitDiffState | undefined }) {
  const t = useT();
  if (!state) return <p className="text-caption-1-regular text-text-secondary">{t('aside.noDiff')}</p>;
  if (state.status === 'loading' && !state.diff) {
    return (
      <div className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
        <Spinner size="xs" />
        {t('aside.diffLoading')}
      </div>
    );
  }
  const sha = state.sha.slice(0, 12);
  const base = state.status !== 'ready' ? ''
    : state.baseRef === 'empty' ? t('aside.diffBaseEmpty')
      : state.baseRef === 'upstream' && sha ? t('aside.diffBaseUpstream', { sha })
        : state.baseRef === 'head' && sha ? t('aside.diffBaseHead', { sha })
          : '';
  const showError = Boolean(state.error) && !state.diff;
  return (
    <div className="flex flex-col gap-2">
      {base || state.truncated ? (
        <p className="text-caption-1-regular text-text-tertiary">
          {[base, state.truncated ? t('aside.diffTruncated') : ''].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <pre className={cx('whitespace-pre-wrap font-mono text-caption-1-regular', showError ? 'text-text-error-primary' : 'text-text-primary')}>
        {state.diff || state.error || t('aside.noDiff')}
      </pre>
    </div>
  );
}
