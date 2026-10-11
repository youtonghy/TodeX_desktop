import { useEffect, useRef, useState, type ReactNode } from 'react';
import { codeToHtml } from 'shiki';
import { RiCheckLine, RiFileCopyLine } from '@remixicon/react';
import { Focusable } from 'react-aria-components';
import { Tooltip, TooltipTrigger } from '@/components/base/tooltip/tooltip';
import { useT } from '@/i18n';
import { cx } from '@/utils/cx';

/**
 * Highlighted code in the BoardUI docs code-block recipe: primary surface,
 * hairline border, radius/2xl, a caption row with the language and the
 * copy → check crossfade. Shiki renders both themes; CSS in global.css
 * picks the light or dark colors from the `.dark` class.
 */

export function CopyCodeButton({ code, label: labelProp, copiedLabel: copiedProp, className }: { code: string; label?: string; copiedLabel?: string; className?: string }) {
  const t = useT();
  const label = labelProp ?? t('common.copyCode');
  const copiedLabel = copiedProp ?? t('common.copied');
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { setCopied(false); timer.current = null; }, 2000);
    } catch {
      // Clipboard refused; nothing to confirm.
    }
  };
  const glyph = 'absolute size-4 text-foreground-icon-secondary transition-all duration-200 ease-out group-hover:text-foreground-icon-primary';
  return (
    <TooltipTrigger delay={200}>
      <Focusable>
        <button
          type="button"
          aria-label={label}
          onClick={() => void copy()}
          className={cx(
            'group flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg',
            'transition-colors duration-150 ease hover:bg-background-secondary-hover',
            'outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring',
            className,
          )}
        >
          <span className="relative inline-flex size-4 items-center justify-center">
            <RiFileCopyLine aria-hidden className={cx(glyph, copied ? 'scale-75 opacity-0 blur-[2px]' : 'scale-100 opacity-100 blur-0')} />
            <RiCheckLine aria-hidden className={cx(glyph, copied ? 'scale-100 opacity-100 blur-0' : 'scale-75 opacity-0 blur-[2px]')} />
          </span>
        </button>
      </Focusable>
      <Tooltip>{copied ? copiedLabel : label}</Tooltip>
    </TooltipTrigger>
  );
}

export function HighlightedCode({ code, language = 'plaintext', className }: { code: string; language?: string; className?: string }) {
  const key = `${language}:${code}`;
  const [html, setHtml] = useState<{ key: string; html: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!code) return;
    codeToHtml(code, { lang: language, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false })
      .then((result) => { if (!cancelled) setHtml({ key, html: result }); })
      .catch(() => { if (!cancelled) setHtml(null); });
    return () => { cancelled = true; };
  }, [code, language, key]);
  const base = cx('code-block-code w-full overflow-x-auto font-mono text-[13px] leading-[1.7]', className);
  if (html?.key === key) return <div className={base} dangerouslySetInnerHTML={{ __html: html.html }} />;
  return <div className={base}><pre><code>{code}</code></pre></div>;
}

export function CodeBlock({ code, language = 'plaintext', title, actions, showCopy = true, copyLabel, className, codeClassName }: {
  code: string;
  language?: string;
  /** Caption on the left of the header; defaults to the language. */
  title?: ReactNode;
  /** Extra header actions left of the copy button. */
  actions?: ReactNode;
  showCopy?: boolean;
  copyLabel?: string;
  className?: string;
  codeClassName?: string;
}) {
  return (
    <div className={cx('my-2 flex w-full min-w-0 flex-col overflow-clip rounded-2xl border border-border-button-default bg-docs-code-background', className)}>
      <div className="flex items-center justify-between gap-2 ps-3 pe-1.5 pt-1.5">
        <span className="min-w-0 truncate text-caption-1-medium text-text-tertiary uppercase">{title ?? language}</span>
        <div className="flex shrink-0 items-center gap-1">
          {actions}
          {showCopy ? <CopyCodeButton code={code} label={copyLabel} /> : null}
        </div>
      </div>
      <HighlightedCode code={code} language={language} className={codeClassName} />
    </div>
  );
}
