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
  'main.updateMenu': '更新',
  'main.checkUpdates': '检查更新…',
  'main.fileNotFound': '文件不存在',
  'main.pathNotAbsolute': '只能打开绝对路径',
  'main.openLaunchable': '为安全起见，不能直接打开可执行文件或应用；请使用“打开方式…”或在文件夹中显示',
  'main.chooseApplication': '选择用于打开的应用',
  'secureStore.unavailable': '系统钥匙串不可用，无法安全保存设备密钥与历史记录密钥。',
  'secureStore.basicText': '此 Linux 桌面没有可用的密钥服务（gnome-keyring / KWallet），无法安全保存设备密钥与历史记录密钥。',
  'main.unknown': '未知',
  'main.gitReadFailed': 'Git 读取失败',
  'main.notInitialized': '未初始化',
  'main.operationDone': '操作完成',
};

const messages: MainMessages = {
  'zh-CN': zhCN,
  en: {
    'main.updateMenu': 'Update',
    'main.checkUpdates': 'Check for Updates…',
    'main.fileNotFound': 'File does not exist',
    'main.pathNotAbsolute': 'Only absolute paths can be opened',
    'main.openLaunchable': 'Executables and apps are not opened directly for safety; use Open With… or Show in Folder',
    'main.chooseApplication': 'Choose an application to open with',
    'secureStore.unavailable': 'The system keychain is unavailable, so device and history keys cannot be stored securely.',
    'secureStore.basicText': 'No secret service (gnome-keyring / KWallet) is available on this Linux desktop, so device and history keys cannot be stored securely.',
    'main.unknown': 'Unknown',
    'main.gitReadFailed': 'Git read failed',
    'main.notInitialized': 'Not initialized',
    'main.operationDone': 'Done',
  },
  ja: {
    'main.updateMenu': 'アップデート',
    'main.checkUpdates': 'アップデートを確認…',
    'main.fileNotFound': 'ファイルが存在しません',
    'main.pathNotAbsolute': '絶対パスのみ開けます',
    'main.openLaunchable': '安全のため、実行ファイルやアプリは直接開けません。「このアプリケーションで開く…」またはフォルダに表示を使用してください',
    'main.chooseApplication': '開くアプリケーションを選択',
    'secureStore.unavailable': 'システムのキーチェーンを利用できないため、デバイスキーと履歴キーを安全に保存できません。',
    'secureStore.basicText': 'この Linux デスクトップでは利用可能なシークレットサービス（gnome-keyring / KWallet）がないため、デバイスキーと履歴キーを安全に保存できません。',
    'main.unknown': '不明',
    'main.gitReadFailed': 'Git の読み取りに失敗しました',
    'main.notInitialized': '未初期化',
    'main.operationDone': '完了しました',
  },
  ko: {
    'main.updateMenu': '업데이트',
    'main.checkUpdates': '업데이트 확인…',
    'main.fileNotFound': '파일이 존재하지 않습니다',
    'main.pathNotAbsolute': '절대 경로만 열 수 있습니다',
    'main.openLaunchable': '보안을 위해 실행 파일이나 앱은 바로 열 수 없습니다. "다음으로 열기…" 또는 폴더에서 보기를 사용하세요',
    'main.chooseApplication': '열 애플리케이션 선택',
    'secureStore.unavailable': '시스템 키체인을 사용할 수 없어 기기 키와 기록 키를 안전하게 저장할 수 없습니다.',
    'secureStore.basicText': '이 Linux 데스크톱에 사용 가능한 시크릿 서비스(gnome-keyring / KWallet)가 없어 기기 키와 기록 키를 안전하게 저장할 수 없습니다.',
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
