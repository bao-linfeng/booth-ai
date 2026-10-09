import type pg from 'pg';
import type { Config } from '../../config.js';
import { activeAiModels } from '../../infra/ai/config.js';
import type { createStorage } from '../../infra/storage.js';
import { deliverableAvailability } from '../assets/deliverables.js';
import { getActivePromptTemplate } from '../prompts/service.js';
import { PROMPT_DEFAULT_VERSION } from '../prompts/template.js';
import { ensureAttempt, recordParse, recordSearch } from '../selection-analytics/recording.js';
import type { SelectionIdentity } from '../selection-analytics/types.js';
import { validateRequirement, type Requirement } from './domain.js';
import { parseWithModels } from './llm.js';
import { matchSchemes } from './match.js';
import { DEFAULT_MESSAGE_LOCALE, type MessageLocale } from './messages/index.js';
import { parseRequirement } from './parse.js';
import { buildSelectionMessages } from './prompt.js';
import { loadCandidatePool, loadCatalog, signImages, signMatchItems } from './repository.js';

export interface ParseSelectionInput {
  attemptId?: string;
  text: string;
  form: Requirement;
}

export interface MatchSelectionInput {
  attemptId?: string;
  parseId?: string;
  mode: 'random' | 'filtered';
  inputContext: { textProvided: boolean; text?: string; degradedParse?: boolean };
  requirement: Requirement;
}

export async function selectionDependency<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    throw Object.assign(new Error('Selection dependency unavailable'), { statusCode: 503 });
  }
}

export function getSelectionCatalog(pool: pg.Pool, locale = 'zh-CN') {
  return selectionDependency(() => loadCatalog(pool, locale));
}

export async function parseSelection(pool: pg.Pool, config: Pick<Config, 'aiModelEncryptionKey'>,
  input: ParseSelectionInput, identity: SelectionIdentity, locale: MessageLocale = DEFAULT_MESSAGE_LOCALE) {
  const startedAt = performance.now();
  const attemptId = await ensureAttempt(pool, input.attemptId, identity);
  const catalog = await getSelectionCatalog(pool);
  const form = validateRequirement(input.form, catalog);
  const models = await selectionDependency(() => activeAiModels(pool, 'selection_parse', config.aiModelEncryptionKey));
  const template = models.length ? await selectionDependency(() => getActivePromptTemplate(pool, 'filter')) : null;
  const promptSnapshot = models.length ? {
    source: template ? 'template' : 'default', templateId: template?.id ?? null, revision: template?.revision ?? null,
    defaultVersion: PROMPT_DEFAULT_VERSION, messages: buildSelectionMessages(input.text, catalog, template?.body),
  } : null;
  const parsed = models.length ? await parseWithModels(input.text, form, catalog, models, undefined, template?.body, locale)
    : parseRequirement(input.text, form, catalog, [], locale);
  const data = { ...parsed, parser: parsed.parser as 'llm' | 'rules' | 'none', dictionaryVersion: catalog.dictionaryVersion };
  const parseId = await recordParse(pool, {
    attemptId, identity, inputText: input.text, formRequirement: form,
    result: data, promptSnapshot, durationMs: performance.now() - startedAt,
  });
  return { ...data, attemptId, parseId, visitorId: identity.visitorId };
}

export async function matchSelection(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>,
  input: MatchSelectionInput, identity: SelectionIdentity, locale: MessageLocale = DEFAULT_MESSAGE_LOCALE) {
  const startedAt = performance.now();
  const attemptId = await ensureAttempt(pool, input.attemptId, identity);
  const catalog = await getSelectionCatalog(pool);
  const requirement = validateRequirement(input.requirement, catalog);
  const { candidates, diagnostics } = await selectionDependency(() => loadCandidatePool(pool, catalog));
   const result = matchSchemes(candidates, requirement, input.mode, input.inputContext.textProvided, diagnostics, catalog.boothSpaces, locale);
  // Only the returned items (at most three) need presigned image URLs.
  const items = await selectionDependency(() => signMatchItems(storage, result.items));
  const data = {
    ...result, items, status: result.status as 'matched' | 'no_match' | 'needs_clarification',
    dictionaryVersion: catalog.dictionaryVersion, attemptId, visitorId: identity.visitorId,
  };
  // 尝试被重建时，传入的解析记录属于旧尝试，不能挂到新检索上
  const parseId = attemptId === input.attemptId ? input.parseId ?? null : null;
  const searchId = await recordSearch(pool, {
    attemptId, parseId, identity, mode: input.mode,
    inputText: input.inputContext.text ?? '', catalog, result: data, degradedParse: input.inputContext.degradedParse ?? false,
    durationMs: performance.now() - startedAt,
  });
  return { ...data, searchId };
}

export async function getSelectionScheme(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>, code: string) {
  const catalog = await getSelectionCatalog(pool);
  const { candidates: [candidate] } = await selectionDependency(() => loadCandidatePool(pool, catalog, code));
  if (!candidate) throw Object.assign(new Error('Scheme not visible'), { statusCode: 404 });
  const [images, availability] = await selectionDependency(() => Promise.all([
    signImages(storage, candidate.images), deliverableAvailability(pool, candidate.code),
  ]));
  return { candidate: { ...candidate, images }, availability };
}

/** 方案封面（第一张效果图）的短时下载地址；可见性与方案详情一致，供客服卡片等长期展示的位置按需换签 */
export async function getSchemeCoverUrl(pool: pg.Pool, storage: Pick<ReturnType<typeof createStorage>, 'signDownload'>, code: string, expiresIn: number) {
  const catalog = await getSelectionCatalog(pool);
  const { candidates: [candidate] } = await selectionDependency(() => loadCandidatePool(pool, catalog, code));
  const cover = candidate?.images.toSorted((left, right) => left.order - right.order)[0];
  if (!cover) throw Object.assign(new Error('Scheme not visible'), { statusCode: 404 });
  return selectionDependency(() => storage.signDownload(cover.objectKey, expiresIn));
}
