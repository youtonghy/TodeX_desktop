import { memo, useId, useMemo, useState } from 'react';
import { marked } from 'marked';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { RiImageLine } from '@remixicon/react';
import { Button } from '@/components/base/buttons/button';
import { CodeBlock } from './code-block';
import { useT } from '@/i18n';
import { cx } from '@/utils/cx';

/**
 * Markdown for chat replies and file previews. The text is split into
 * top-level blocks (marked's lexer) and each block renders through its own
 * memoized react-markdown, so a streaming reply only re-parses its last
 * block. Fenced code renders as a BoardUI CodeBlock; typography for the
 * prose lives under `.markdown` in global.css.
 *
 * The text comes from agents and workspace files, so it is untrusted: raw
 * HTML stays text, links leave the app only for http(s)/mailto, and remote
 * images load on request (an image URL can carry data out without a click).
 */

export type MarkdownComponents = Partial<Components>;

export interface MarkdownProps {
  children: string;
  components?: MarkdownComponents;
  /** Stable id so block keys survive re-renders of the same message. */
  id?: string;
  className?: string;
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

function languageOf(className?: string): string {
  return className?.match(/language-([\w+-]+)/)?.[1] ?? 'plaintext';
}

function externalHref(href: string | undefined): boolean {
  try {
    const { protocol } = new URL(href?.trim() ?? '');
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:';
  } catch {
    return false;
  }
}

function remoteImageHost(src: string): string {
  try {
    const url = new URL(src);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : '';
  } catch {
    return '';
  }
}

/** Inline `blob:` images render; remote ones wait for a click that names
 * their host; anything else (relative paths) shows its alt text. */
function MarkdownImage({ src, alt, title }: { src?: unknown; alt?: string; title?: string }) {
  const t = useT();
  const [load, setLoad] = useState(false);
  const url = typeof src === 'string' ? src.trim() : '';
  const host = remoteImageHost(url);
  if (url.startsWith('blob:') || (host && load)) {
    return <img src={url} alt={alt ?? ''} title={title} loading="lazy" referrerPolicy="no-referrer" className="max-w-full" />;
  }
  if (!host) return alt ? <span>{alt}</span> : null;
  return (
    <Button size="xs" variant="secondary" leadingIcon={RiImageLine} title={url} onClick={() => setLoad(true)}>
      {alt ? t('markdown.loadImageAlt', { host, alt }) : t('markdown.loadImage', { host })}
    </Button>
  );
}

const DEFAULT_COMPONENTS: MarkdownComponents = {
  a({ href, children, node: _node, ref: _ref, ...props }) {
    const external = externalHref(href);
    return (
      <a
        {...props}
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        // Relative and fragment links would navigate the app itself.
        onClick={(event) => { if (!external) event.preventDefault(); }}
      >
        {children}
      </a>
    );
  },
  img({ src, alt, title }) {
    return <MarkdownImage src={src} alt={alt} title={title} />;
  },
  code({ children, className, node, ...props }) {
    const start = node?.position?.start.line;
    if (!start || start === node?.position?.end.line) {
      return <code {...props} className={cx('markdown-inline-code', className)}>{children}</code>;
    }
    return <CodeBlock code={String(children ?? '').replace(/\n$/, '')} language={languageOf(className)} />;
  },
  pre({ children }) {
    return <>{children}</>;
  },
};

/** Reference-style link definitions and footnotes resolve across the whole
 * document, so such text is not split into blocks. */
const CROSS_BLOCK_REFERENCES = /^ {0,3}\[[^\]\n]+\]:\s|\[\^[^\]\n]+\]/m;

const Block = memo(function Block({ content, components }: { content: string; components: MarkdownComponents }) {
  return (
    <div className="markdown-block">
      <ReactMarkdown components={components} remarkPlugins={REMARK_PLUGINS}>{content}</ReactMarkdown>
    </div>
  );
});

export const Markdown = memo(function Markdown({ children, components, id, className }: MarkdownProps) {
  const fallbackId = useId();
  const scope = id ?? fallbackId;
  // Position keys: a streamed reply only grows its last block, which then
  // re-renders in place instead of remounting (and re-highlighting) anew.
  const blocks = useMemo(() => {
    if (CROSS_BLOCK_REFERENCES.test(children)) return [{ content: children, key: `${scope}-all` }];
    return marked.lexer(children).map((token, index) => ({ content: token.raw, key: `${scope}-${index}` }));
  }, [children, scope]);
  const merged = useMemo(() => ({ ...DEFAULT_COMPONENTS, ...components }), [components]);
  return (
    <div className={cx('markdown', className)}>
      {blocks.map((block) => <Block key={block.key} content={block.content} components={merged} />)}
    </div>
  );
});
