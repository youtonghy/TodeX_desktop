import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/base/buttons/button';
import { Textarea } from '@/components/base/textarea/textarea';
import { CodeBlock } from '@/components/ui/code-block';
import { Markdown } from '@/components/ui/markdown';
import { ConfirmDialog, Modal } from '@/components/ui/modal';
import { SpinnerIcon } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { baseMarkdownComponents } from './markdownComponents';
import { lineRangeForOffsets, selectionInside, selectionStartOffset, type TextLineRange } from '../lib/selection';
import { buildConflictMergeDocument, conflictMarkersRemain, WORKSPACE_FILE_MAX_TEXT_BYTES } from '../session/helpers';
import { utf8ByteLength } from '@todex/protocol/todex';
import { useT } from '../i18n';

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

/** Result of a compare-and-save attempt; 'conflict' means the backend answered
 * 409 because expectedText no longer matches the on-disk contents. */
export type WorkspaceFileSaveOutcome = 'saved' | 'conflict' | 'failed';

type QuoteTarget = { text: string; left: number; top: number; range?: TextLineRange };

export function WorkspaceFilePreview({ file, onAddReference, onSaveFile, onReloadFile, onDirtyChange }: {
  file: PreviewFile | null;
  onAddReference?: (selection: ReferenceSelection) => void;
  onSaveFile?: (path: string, text: string, expectedText: string) => Promise<WorkspaceFileSaveOutcome>;
  onReloadFile?: (path: string) => Promise<PreviewFile | null>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [quote, setQuote] = useState<QuoteTarget | null>(null);

  const editable = Boolean(onSaveFile && file && typeof file.text === 'string');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [mergePending, setMergePending] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeDraft, setMergeDraft] = useState('');
  const [mergeError, setMergeError] = useState('');
  const remoteTextRef = useRef('');
  const dirty = editing && draft !== baseline;

  const filePath = file?.path ?? '';
  useEffect(() => {
    setEditing(false);
    setSaving(false);
    setMergePending(false);
    setConflictOpen(false);
    setMergeOpen(false);
    setMergeError('');
    setDraft('');
    setBaseline('');
  }, [filePath]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const beginEdit = () => {
    if (!file || typeof file.text !== 'string') return;
    setDraft(file.text);
    setBaseline(file.text);
    setMergePending(false);
    setEditing(true);
  };

  const cancelEdit = () => {
    if (dirty && !window.confirm(t('filePreview.discardChanges'))) return;
    setEditing(false);
    setMergePending(false);
  };

  const save = async () => {
    if (!file || !onSaveFile || saving || !dirty) return;
    if (utf8ByteLength(draft) > WORKSPACE_FILE_MAX_TEXT_BYTES) {
      toast.danger(t('filePreview.tooLarge'));
      return;
    }
    setSaving(true);
    try {
      const outcome = await onSaveFile(file.path, draft, baseline);
      if (outcome === 'saved') {
        setBaseline(draft);
        setMergePending(false);
        setEditing(false);
        toast.success(t('filePreview.saved'));
      } else if (outcome === 'conflict') {
        setConflictOpen(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const mergeFromRemote = async () => {
    if (!file || !onReloadFile || conflictLoading) return;
    setConflictLoading(true);
    try {
      const latest = await onReloadFile(file.path);
      if (!latest || typeof latest.text !== 'string') {
        toast.danger(t('filePreview.mergeUnavailable'));
        return;
      }
      remoteTextRef.current = latest.text;
      setMergeDraft(buildConflictMergeDocument(draft, latest.text, t('filePreview.mergeMarkerLocal'), t('filePreview.mergeMarkerRemote')));
      setMergeError('');
      setConflictOpen(false);
      setMergeOpen(true);
    } finally {
      setConflictLoading(false);
    }
  };

  const adoptMerge = () => {
    if (conflictMarkersRemain(mergeDraft)) {
      setMergeError(t('filePreview.mergeMarkersLeft'));
      return;
    }
    setDraft(mergeDraft);
    setBaseline(remoteTextRef.current);
    setMergePending(true);
    setMergeOpen(false);
    setEditing(true);
  };

  const quotable = Boolean(!editing && onAddReference && file && typeof file.text === 'string' && file.text);

  useEffect(() => {
    if (!quotable) { setQuote(null); return; }
    const update = () => {
      const container = containerRef.current;
      if (!container) { setQuote(null); return; }
      const info = selectionInside(container);
      if (!info) { setQuote(null); return; }
      let range: TextLineRange | undefined;
      const codeElement = container.querySelector<HTMLElement>('.code-block-code');
      const source = file?.text;
      // Comparing textContent would rebuild the whole file's text on every
      // selection change; the code block marks when its text is the source.
      if (source && codeElement?.dataset.codeSynced === 'true') {
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
    content = <p className="text-caption-1-regular text-text-tertiary">{t('filePreview.hint')}</p>;
  } else if (editing) {
    content = (
      <Textarea
        aria-label={t('filePreview.editorLabel')}
        value={draft}
        onChange={setDraft}
        isDisabled={saving}
        rows={Math.min(40, Math.max(16, draft.split('\n').length + 2))}
        inputClassName="font-mono text-caption-1-regular"
      />
    );
  } else {
    // Older backends report images as application/octet-stream with text: null.
    const imageMime = file.mimeType.startsWith('image/') ? file.mimeType : imageTypes[fileExtension(file.path)];
    if (imageMime) {
      content = file.dataUrl?.startsWith(`data:${imageMime};base64,`)
        ? <img src={file.dataUrl} alt={file.name || file.path.split('/').pop() || t('filePreview.imageAlt')} className="block h-auto max-w-full rounded-lg object-contain" />
        : <p className="text-caption-1-regular text-text-tertiary">{t('filePreview.noImageData')}</p>;
    } else if (typeof file.text !== 'string') {
      content = <p className="text-caption-1-regular text-text-tertiary">{t('filePreview.unsupported')}</p>;
    } else if (!file.text) {
      content = <p className="text-caption-1-regular text-text-tertiary">{file.sizeBytes ? t('filePreview.noText') : t('filePreview.empty')}</p>;
    } else if (isMarkdownFile(file.path)) {
      content = <Markdown components={baseMarkdownComponents}>{file.text}</Markdown>;
    } else {
      content = <CodeBlock code={file.text} language={codeLanguage(file.path)} className="my-0 min-w-0" />;
    }
  }

  return (
    <div ref={containerRef} className="min-w-0">
      {editable ? (
        <div className="mb-2 flex items-center justify-end gap-2">
          {editing ? (
            <>
              {mergePending ? <span className="text-caption-1-regular text-status-yellow-text">{t('filePreview.mergePending')}</span> : null}
              {dirty ? <span className="text-caption-1-regular text-text-tertiary">{t('filePreview.unsaved')}</span> : null}
              <Button size="small" variant="secondary" disabled={saving} onClick={cancelEdit}>{t('filePreview.cancelEdit')}</Button>
              <Button
                size="small"
                disabled={!dirty || saving}
                aria-busy={saving || undefined}
                leadingIcon={saving ? SpinnerIcon : undefined}
                onClick={() => void save()}
              >
                {saving ? t('filePreview.saving') : t('filePreview.save')}
              </Button>
            </>
          ) : (
            <Button size="small" variant="secondary" onClick={beginEdit}>{t('filePreview.edit')}</Button>
          )}
        </div>
      ) : null}
      {content}
      {quote ? (
        <div className="fixed z-50 -translate-x-1/2" style={{ left: quote.left, top: quote.top }}>
          <Button size="small" variant="secondary" className="shadow-dropdown" onClick={addQuote}>{t('filePreview.addToChat')}</Button>
        </div>
      ) : null}
      <ConfirmDialog
        isOpen={conflictOpen}
        onOpenChange={setConflictOpen}
        title={t('filePreview.conflictTitle')}
        description={t('filePreview.conflictBody')}
        cancelLabel={t('filePreview.keepEditing')}
        confirmLabel={t('filePreview.compareMerge')}
        isConfirmDisabled={conflictLoading}
        onConfirm={() => void mergeFromRemote()}
      />
      <Modal
        isOpen={mergeOpen}
        onOpenChange={(open) => { setMergeOpen(open); if (!open) setMergeError(''); }}
        title={t('filePreview.mergeTitle')}
        description={t('filePreview.mergeHint')}
        size="3xl"
        bodyClassName="flex flex-col gap-2"
        footer={(
          <>
            <Button variant="secondary" onClick={() => setMergeOpen(false)}>{t('filePreview.mergeBack')}</Button>
            <Button onClick={adoptMerge}>{t('filePreview.mergeAdopt')}</Button>
          </>
        )}
      >
        <Textarea
          aria-label={t('filePreview.mergeEditorLabel')}
          value={mergeDraft}
          onChange={(value) => { setMergeDraft(value); setMergeError(''); }}
          rows={20}
          inputClassName="font-mono text-caption-1-regular"
        />
        {mergeError ? <p className="text-caption-1-regular text-text-error-primary">{mergeError}</p> : null}
      </Modal>
    </div>
  );
}
