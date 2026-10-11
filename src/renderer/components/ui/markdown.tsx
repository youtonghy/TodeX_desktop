import { memo, useId, useMemo } from 'react';
import { marked } from 'marked';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './code-block';
import { cx } from '@/utils/cx';

/**
 * Markdown for chat replies and file previews. The text is split into
 * top-level blocks (marked's lexer) and each block renders through its own
 * memoized react-markdown, so a streaming reply only re-parses its last
 * block. Fenced code renders as a BoardUI CodeBlock; typography for the
 * prose lives under `.markdown` in global.css.
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

const DEFAULT_COMPONENTS: MarkdownComponents = {
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

function hash(text: string): string {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(31, value) + text.charCodeAt(index);
  return (value >>> 0).toString(36);
}

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
  const blocks = useMemo(() => {
    const seen = new Map<string, number>();
    return marked.lexer(children).map((token) => {
      const digest = hash(token.raw);
      const count = seen.get(digest) ?? 0;
      seen.set(digest, count + 1);
      return { content: token.raw, key: `${scope}-${digest}-${count}` };
    });
  }, [children, scope]);
  const merged = useMemo(() => ({ ...DEFAULT_COMPONENTS, ...components }), [components]);
  return (
    <div className={cx('markdown', className)}>
      {blocks.map((block) => <Block key={block.key} content={block.content} components={merged} />)}
    </div>
  );
});
