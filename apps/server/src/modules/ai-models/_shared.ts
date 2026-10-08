import type { AiPurpose } from '../../infra/ai/types.js';

export const AI_PURPOSES: readonly AiPurpose[] = ['selection_parse', 'theme', 'artwork', 'cs_translation'];
export const MAX_ASSIGNMENTS = 10;

export function requestError(message: string, statusCode = 400, reason?: string) {
  return Object.assign(new Error(message), { statusCode, ...(reason ? { reason } : {}) });
}

export function cleanName(value: string) {
  const name = value.trim();
  if (!name || name.length > 60 || /[\u0000-\u001f\u007f]/u.test(name)) throw requestError('Invalid name');
  return name;
}

export function cleanApiKey(value: string) {
  if (!value.trim() || value !== value.trim() || value.length > 2048) throw requestError('Invalid API key');
  return value;
}

export function uniqueViolation(error: unknown, message: string, reason = 'NAME_TAKEN'): never {
  if ((error as { code?: string }).code === '23505') throw requestError(message, 409, reason);
  throw error;
}
