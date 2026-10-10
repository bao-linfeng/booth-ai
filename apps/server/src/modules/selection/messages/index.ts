import { ar } from './ar.js';
import { de } from './de.js';
import { en } from './en.js';
import { es } from './es.js';
import { fr } from './fr.js';
import { hi } from './hi.js';
import { it } from './it.js';
import { ja } from './ja.js';
import { ms } from './ms.js';
import { pt } from './pt.js';
import { ru } from './ru.js';
import { zh, type MessageKey, type Messages } from './zh.js';

export type { MessageKey } from './zh.js';

const catalogs = { zh, en, fr, de, ja, ru, it, es, ar, hi, pt, ms } satisfies Record<string, Messages>;

export type MessageLocale = keyof typeof catalogs;
export const DEFAULT_MESSAGE_LOCALE: MessageLocale = 'zh';

/** 把 Accept-Language / locale 参数（如 en-US、zh-CN）归一为受支持的文案语言，未知或缺省回退中文。 */
export function resolveMessageLocale(tag?: string | null): MessageLocale {
  const base = tag?.trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return Object.hasOwn(catalogs, base) ? (base as MessageLocale) : DEFAULT_MESSAGE_LOCALE;
}

export function message(locale: MessageLocale, key: MessageKey, params: Record<string, string | number> = {}): string {
  return Object.entries(params).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), catalogs[locale][key]);
}
