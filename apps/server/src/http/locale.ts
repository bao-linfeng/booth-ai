import type { FastifyRequest } from 'fastify';
import { resolveMessageLocale, type MessageLocale } from '../modules/selection/messages/index.js';

export function requestMessageLocale(request: FastifyRequest): MessageLocale {
  return resolveMessageLocale(request.headers['accept-language']?.split(',')[0]?.split(';')[0]);
}
