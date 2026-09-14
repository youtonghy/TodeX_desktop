// Main-process dictionary for user-facing strings (dialogs, menu, IPC errors).
// Kept electron-free so updatePolicy.ts stays importable from plain node tests;
// index.ts calls setMainLocale(app.getLocale()) at startup and the renderer
// pushes changes over the 'locale:set' IPC channel.

export type MainLocale = 'zh-CN' | 'en' | 'ja' | 'ko';

const MAIN_LOCALES: readonly MainLocale[] = ['zh-CN', 'en', 'ja', 'ko'];

// Local copy of the renderer's matchLocale (src/renderer/i18n/locales.ts).
function matchLocale(tag: string | null | undefined): MainLocale | null {
  const language = tag?.trim().toLowerCase().split(/[-_]/)[0];
  switch (language) {
    case 'zh': return 'zh-CN';
    case 'en': return 'en';
    case 'ja': return 'ja';
    case 'ko': return 'ko';
    default: return null;
  }
}

export function isMainLocale(value: unknown): value is MainLocale {
  return typeof value === 'string' && (MAIN_LOCALES as readonly string[]).includes(value);
}

let currentLocale: MainLocale = 'en';

export function setMainLocale(value: string): void {
  const locale = isMainLocale(value) ? value : matchLocale(value);
  if (locale) currentLocale = locale;
}

export function getMainLocale(): MainLocale {
  return currentLocale;
}

export type MainKey = keyof typeof zhCN;
type MainMessages = Record<MainLocale, Record<MainKey, string>>;

const zhCN = {
  'main.updateDownloaded': '版本 {version} 已下载，将在退出应用后安装。',
  'main.latestStable': '当前已是最新稳定版本。',
  'main.updateMenu': '更新',
  'main.checkUpdates': '检查更新…',
  'main.updateTitle': 'TodeX 更新',
  'main.updateFailed': '更新失败',
  'main.updateFailedDetail': '无法检查或下载更新，请稍后重试。',
  'main.fileNotFound': '文件不存在',
  'main.fileTooLarge': '文件过大（最大 {kb} KB）',
  'main.unknown': '未知',
  'main.gitReadFailed': 'Git 读取失败',
  'main.notInitialized': '未初始化',
  'main.operationDone': '操作完成',
};

const messages: MainMessages = {
  'zh-CN': zhCN,
  en: {
    'main.updateDownloaded': 'Version {version} has been downloaded and will be installed when the app quits.',
    'main.latestStable': 'You are on the latest stable version.',
    'main.updateMenu': 'Update',
    'main.checkUpdates': 'Check for Updates…',
    'main.updateTitle': 'TodeX Update',
    'main.updateFailed': 'Update Failed',
    'main.updateFailedDetail': 'Could not check for or download updates. Please try again later.',
    'main.fileNotFound': 'File does not exist',
    'main.fileTooLarge': 'File too large (max {kb} KB)',
    'main.unknown': 'Unknown',
    'main.gitReadFailed': 'Git read failed',
    'main.notInitialized': 'Not initialized',
    'main.operationDone': 'Done',
  },
  ja: {
    'main.updateDownloaded': 'バージョン {version} をダウンロードしました。アプリ終了後にインストールされます。',
    'main.latestStable': '現在最新の安定版です。',
    'main.updateMenu': 'アップデート',
    'main.checkUpdates': 'アップデートを確認…',
    'main.updateTitle': 'TodeX アップデート',
    'main.updateFailed': 'アップデート失敗',
    'main.updateFailedDetail': 'アップデートを確認またはダウンロードできません。後で再試行してください。',
    'main.fileNotFound': 'ファイルが存在しません',
    'main.fileTooLarge': 'ファイルが大きすぎます（最大 {kb} KB）',
    'main.unknown': '不明',
    'main.gitReadFailed': 'Git の読み取りに失敗しました',
    'main.notInitialized': '未初期化',
    'main.operationDone': '完了しました',
  },
  ko: {
    'main.updateDownloaded': '버전 {version}이(가) 다운로드되었습니다. 앱 종료 후 설치됩니다.',
    'main.latestStable': '현재 최신 안정 버전입니다.',
    'main.updateMenu': '업데이트',
    'main.checkUpdates': '업데이트 확인…',
    'main.updateTitle': 'TodeX 업데이트',
    'main.updateFailed': '업데이트 실패',
    'main.updateFailedDetail': '업데이트를 확인하거나 다운로드할 수 없습니다. 잠시 후 다시 시도하세요.',
    'main.fileNotFound': '파일이 존재하지 않습니다',
    'main.fileTooLarge': '파일이 너무 큽니다(최대 {kb} KB)',
    'main.unknown': '알 수 없음',
    'main.gitReadFailed': 'Git 읽기 실패',
    'main.notInitialized': '초기화되지 않음',
    'main.operationDone': '작업 완료',
  },
};

export function mainT(key: MainKey, params?: Record<string, string | number>): string {
  const template = messages[currentLocale][key] ?? messages.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
