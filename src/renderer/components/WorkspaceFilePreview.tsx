import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { CodeBlock } from '@heroui-pro/react/code-block';
import { Markdown } from '@heroui-pro/react/markdown';
import { lineRangeForOffsets, selectionInside, selectionStartOffset, type TextLineRange } from '../lib/selection';

function fileExtension(path: string): string {
  return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || '';
}

function codeLanguage(path: string): string {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() || '';
  const filenames: Record<string, string> = {
    'cmakelists.txt': 'cmake',
    'cargo.lock': 'toml',
    'podfile.lock': 'yaml',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'gemfile': 'ruby',
    'rakefile': 'ruby',
    'podfile': 'ruby',
    'brewfile': 'ruby',
    'vagrantfile': 'ruby',
    'jenkinsfile': 'groovy',
    '.editorconfig': 'ini',
    '.gitignore': 'gitignore',
    '.dockerignore': 'gitignore',
    '.npmignore': 'gitignore',
    '.env': 'dotenv',
  };
  const languages: Record<string, string> = {
    astro: 'astro',
    bash: 'shellscript',
    bat: 'bat',
    c: 'c',
    cc: 'cpp',
    cfg: 'ini',
    cjs: 'javascript',
    clj: 'clojure',
    cmake: 'cmake',
    cpp: 'cpp',
    cs: 'csharp',
    css: 'css',
    csv: 'csv',
    cts: 'typescript',
    cxx: 'cpp',
    dart: 'dart',
    diff: 'diff',
    dockerfile: 'dockerfile',
    editorconfig: 'ini',
    elm: 'elm',
    env: 'dotenv',
    erl: 'erlang',
    ex: 'elixir',
    exs: 'elixir',
    fs: 'fsharp',
    fsx: 'fsharp',
    go: 'go',
    gradle: 'groovy',
    graphql: 'graphql',
    gql: 'graphql',
    groovy: 'groovy',
    h: 'c',
    hcl: 'hcl',
    hpp: 'cpp',
    hs: 'haskell',
    htm: 'html',
    html: 'html',
    http: 'http',
    ini: 'ini',
    ipynb: 'json',
    java: 'java',
    jl: 'julia',
    js: 'javascript',
    json: 'json',
    json5: 'json5',
    jsonc: 'jsonc',
    jsx: 'jsx',
    kt: 'kotlin',
    kts: 'kotlin',
    less: 'less',
    lua: 'lua',
    m: 'objective-c',
    makefile: 'makefile',
    md: 'markdown',
    mdx: 'mdx',
    mjs: 'javascript',
    mm: 'objective-cpp',
    mts: 'typescript',
    nim: 'nim',
    patch: 'diff',
    php: 'php',
    pl: 'perl',
    plist: 'xml',
    pm: 'perl',
    prisma: 'prisma',
    proto: 'proto',
    ps1: 'powershell',
    py: 'python',
    r: 'r',
    rb: 'ruby',
    rs: 'rust',
    sass: 'sass',
    scala: 'scala',
    scss: 'scss',
    sh: 'shellscript',
    sol: 'solidity',
    sql: 'sql',
    svelte: 'svelte',
    swift: 'swift',
    tex: 'latex',
    tf: 'hcl',
    toml: 'toml',
    ts: 'typescript',
    tsv: 'csv',
    tsx: 'tsx',
    typ: 'typst',
    vb: 'vb',
    vue: 'vue',
    wat: 'wat',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
    zig: 'zig',
    zsh: 'shellscript',
  };
  if (filenames[name]) return filenames[name];
  if (name.startsWith('dockerfile')) return 'dockerfile';
  if (name.startsWith('.env.')) return 'dotenv';
  return languages[fileExtension(path)] || 'plaintext';
}

function isMarkdownFile(path: string): boolean {
  return ['md', 'markdown', 'mdx', 'mdown', 'mkd'].includes(fileExtension(path));
}

export type PreviewFile = { name?: string; path: string; text?: string | null; mimeType: string; dataUrl?: string; sizeBytes?: number };

export type ReferenceSelection = { text: string; lineStart?: number; lineEnd?: number };

type QuoteTarget = { text: string; left: number; top: number; range?: TextLineRange };

export function WorkspaceFilePreview({ file, onAddReference }: {
  file: PreviewFile | null;
  onAddReference?: (selection: ReferenceSelection) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<QuoteTarget | null>(null);
  const quotable = Boolean(onAddReference && file && typeof file.text === 'string' && file.text);

  useEffect(() => {
    if (!quotable) { setQuote(null); return; }
    const update = () => {
      const container = containerRef.current;
      if (!container) { setQuote(null); return; }
      const info = selectionInside(container);
      if (!info) { setQuote(null); return; }
      let range: TextLineRange | undefined;
      const codeElement = container.querySelector<HTMLElement>('[data-slot="code-block-code"]');
      const source = file?.text;
      if (source && codeElement && codeElement.textContent === source) {
        const start = selectionStartOffset(codeElement);
        if (start !== null) range = lineRangeForOffsets(source, start, start + info.text.length);
      }
      setQuote({ ...info, range });
    };
    const hide = () => setQuote(null);
    document.addEventListener('selectionchange', update);
    document.addEventListener('scroll', hide, true);
    return () => {
      document.removeEventListener('selectionchange', update);
      document.removeEventListener('scroll', hide, true);
    };
  }, [quotable, file]);

  const addQuote = () => {
    if (!quote || !onAddReference) return;
    onAddReference({ text: quote.text, ...quote.range });
    window.getSelection()?.removeAllRanges();
    setQuote(null);
  };

  const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };

  let content: React.ReactNode;
  if (!file) {
    content = <p className="text-muted text-xs">选择文件预览。</p>;
  } else {
    // Older backends report images as application/octet-stream with text: null.
    const imageMime = file.mimeType.startsWith('image/') ? file.mimeType : imageTypes[fileExtension(file.path)];
    if (imageMime) {
      content = file.dataUrl?.startsWith(`data:${imageMime};base64,`)
        ? <img src={file.dataUrl} alt={file.name || file.path.split('/').pop() || '图片预览'} className="block h-auto max-w-full rounded-lg object-contain" />
        : <p className="text-muted text-xs">当前后端未返回图片预览，请更新后端后重试。</p>;
    } else if (typeof file.text !== 'string') {
      content = <p className="text-muted text-xs">暂不支持预览此文件格式。</p>;
    } else if (!file.text) {
      content = <p className="text-muted text-xs">{file.sizeBytes ? '该文件没有可供预览的文本内容。' : '此文件为空。'}</p>;
    } else if (isMarkdownFile(file.path)) {
      content = <Markdown>{file.text}</Markdown>;
    } else {
      content = (
        <CodeBlock className="min-w-0">
          <CodeBlock.Header>
            <span className="text-muted text-xs uppercase">{codeLanguage(file.path)}</span>
          </CodeBlock.Header>
          <CodeBlock.Code code={file.text} language={codeLanguage(file.path)} />
        </CodeBlock>
      );
    }
  }

  return (
    <div ref={containerRef} className="min-w-0">
      {content}
      {quote ? (
        <div className="fixed z-50 -translate-x-1/2" style={{ left: quote.left, top: quote.top }}>
          <Button size="sm" variant="secondary" onPress={addQuote}>添加到对话</Button>
        </div>
      ) : null}
    </div>
  );
}
