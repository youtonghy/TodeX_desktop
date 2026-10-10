import { useEffect, useRef, useState } from 'react';
import { AlertDialog, Button, Modal, TextArea, TextField, toast } from '@heroui/react';
import { CodeBlock } from '@heroui-pro/react/code-block';
import { Markdown } from '@heroui-pro/react/markdown';
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
    content = <p className="text-muted text-xs">{t('filePreview.hint')}</p>;
  } else if (editing) {
    content = (
      <TextField value={draft} onChange={setDraft} className="w-full" isDisabled={saving}>
        <TextArea aria-label={t('filePreview.editorLabel')} rows={Math.min(40, Math.max(16, draft.split('\n').length + 2))} className="w-full font-mono text-xs" />
      </TextField>
    );
  } else {
    // Older backends report images as application/octet-stream with text: null.
    const imageMime = file.mimeType.startsWith('image/') ? file.mimeType : imageTypes[fileExtension(file.path)];
    if (imageMime) {
      content = file.dataUrl?.startsWith(`data:${imageMime};base64,`)
        ? <img src={file.dataUrl} alt={file.name || file.path.split('/').pop() || t('filePreview.imageAlt')} className="block h-auto max-w-full rounded-lg object-contain" />
        : <p className="text-muted text-xs">{t('filePreview.noImageData')}</p>;
    } else if (typeof file.text !== 'string') {
      content = <p className="text-muted text-xs">{t('filePreview.unsupported')}</p>;
    } else if (!file.text) {
      content = <p className="text-muted text-xs">{file.sizeBytes ? t('filePreview.noText') : t('filePreview.empty')}</p>;
    } else if (isMarkdownFile(file.path)) {
      content = <Markdown components={baseMarkdownComponents}>{file.text}</Markdown>;
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
      {editable ? (
        <div className="mb-2 flex items-center justify-end gap-2">
          {editing ? (
            <>
              {mergePending ? <span className="text-warning text-xs">{t('filePreview.mergePending')}</span> : null}
              {dirty ? <span className="text-muted text-xs">{t('filePreview.unsaved')}</span> : null}
              <Button size="sm" variant="tertiary" isDisabled={saving} onPress={cancelEdit}>{t('filePreview.cancelEdit')}</Button>
              <Button size="sm" variant="secondary" isDisabled={!dirty || saving} onPress={() => void save()}>{saving ? t('filePreview.saving') : t('filePreview.save')}</Button>
            </>
          ) : (
            <Button size="sm" variant="tertiary" onPress={beginEdit}>{t('filePreview.edit')}</Button>
          )}
        </div>
      ) : null}
      {content}
      {quote ? (
        <div className="fixed z-50 -translate-x-1/2" style={{ left: quote.left, top: quote.top }}>
          <Button size="sm" variant="secondary" onPress={addQuote}>{t('filePreview.addToChat')}</Button>
        </div>
      ) : null}
      <AlertDialog isOpen={conflictOpen} onOpenChange={setConflictOpen}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-md">
              <AlertDialog.Header>
                <AlertDialog.Heading>{t('filePreview.conflictTitle')}</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className="text-muted text-sm">{t('filePreview.conflictBody')}</p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">{t('filePreview.keepEditing')}</Button>
                <Button variant="secondary" isDisabled={conflictLoading} onPress={() => void mergeFromRemote()}>{t('filePreview.compareMerge')}</Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
      <Modal.Backdrop isOpen={mergeOpen} onOpenChange={(open) => { setMergeOpen(open); if (!open) setMergeError(''); }}>
        <Modal.Container>
          <Modal.Dialog className="w-[calc(100vw-2rem)] max-w-3xl">
            <Modal.Header>
              <Modal.Heading>{t('filePreview.mergeTitle')}</Modal.Heading>
              <p className="text-muted text-xs">{t('filePreview.mergeHint')}</p>
            </Modal.Header>
            <Modal.Body className="overflow-y-auto">
              <TextField value={mergeDraft} onChange={(value) => { setMergeDraft(value); setMergeError(''); }} className="w-full">
                <TextArea aria-label={t('filePreview.mergeEditorLabel')} rows={20} className="w-full font-mono text-xs" />
              </TextField>
              {mergeError ? <p className="text-danger text-xs">{mergeError}</p> : null}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={() => setMergeOpen(false)}>{t('filePreview.mergeBack')}</Button>
              <Button variant="secondary" onPress={adoptMerge}>{t('filePreview.mergeAdopt')}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
