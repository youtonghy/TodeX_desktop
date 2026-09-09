import { CodeBlock } from '@heroui-pro/react/code-block';
import { Markdown } from '@heroui-pro/react/markdown';

function fileExtension(path: string): string {
  return path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() || '';
}

function codeLanguage(path: string): string {
  const extension = fileExtension(path);
  const languages: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    mdx: 'mdx',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    sh: 'shellscript',
    sql: 'sql',
    swift: 'swift',
    ts: 'typescript',
    tsx: 'tsx',
    vue: 'vue',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languages[extension] || 'plaintext';
}

function isMarkdownFile(path: string): boolean {
  return ['md', 'markdown', 'mdx'].includes(fileExtension(path));
}

export type PreviewFile = { name?: string; path: string; text?: string; mimeType: string; dataUrl?: string };

export function WorkspaceFilePreview({ file }: { file: PreviewFile | null }) {
  if (!file) return <p className="text-muted text-xs">选择文件预览。</p>;
  if (file.mimeType.startsWith('image/')) {
    if (!file.dataUrl?.startsWith(`data:${file.mimeType};base64,`)) {
      return <p className="text-muted text-xs">当前后端未返回图片预览，请更新后端后重试。</p>;
    }
    return <img src={file.dataUrl} alt={file.name || file.path.split('/').pop() || '图片预览'} className="block h-auto max-w-full rounded-lg object-contain" />;
  }
  if (file.text === undefined) return <p className="text-muted text-xs">暂不支持预览此文件格式。</p>;
  if (!file.text) return <p className="text-muted text-xs">此文件为空。</p>;
  if (isMarkdownFile(file.path)) return <Markdown>{file.text}</Markdown>;
  return (
    <CodeBlock className="min-w-0">
      <CodeBlock.Header>
        <span className="text-muted text-xs uppercase">{codeLanguage(file.path)}</span>
      </CodeBlock.Header>
      <CodeBlock.Code code={file.text} language={codeLanguage(file.path)} />
    </CodeBlock>
  );
}

