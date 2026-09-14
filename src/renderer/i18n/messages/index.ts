import type { Locale } from '../locales';
import { zhCN } from './zh-CN';
import { en } from './en';
import { ja } from './ja';
import { ko } from './ko';

// zh-CN is the source text; the other dictionaries must define exactly the
// same keys, which `Messages` enforces at typecheck time.
export type MessageKey = keyof typeof zhCN;
export type Messages = Record<MessageKey, string>;

export const messages: Record<Locale, Messages> = { 'zh-CN': zhCN, en, ja, ko };
