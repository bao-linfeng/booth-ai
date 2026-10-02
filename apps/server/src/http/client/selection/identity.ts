import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

const visitorPattern = /^[a-zA-Z0-9_-]{16,128}$/;

export function getProvidedVisitorId(request: FastifyRequest): string | null {
  const header = request.headers['x-visitor-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value && visitorPattern.test(value) ? value : null;
}

export function getVisitorId(request: FastifyRequest): string {
  return getProvidedVisitorId(request) ?? `v_${randomUUID().replaceAll('-', '')}`;
}
