import type { FastifyInstance } from 'fastify';
import { authenticationError } from '../../modules/identity/principal.js';
import { requirePrincipal } from '../authentication.js';

export function adminRoutePermissions(method: string, url: string): string[] | null {
  const path = url.replace(/^\/api\/v1\/admin(?=\/)/, '');
  if (['/me', '/access'].includes(path)) return [];
  const read = method === 'GET' || method === 'HEAD';
  if (/^\/schemes\/:code\/assets(?:\/|$)/.test(path) || path === '/assets') {
    return [path.endsWith('/download') ? 'assets.download' : read ? 'assets.read' : 'assets.write'];
  }
  if (path === '/bill-of-materials' || /^\/schemes\/:code\/bill-of-materials(?:\/|$)/.test(path)) {
    return [path.endsWith('/download') ? 'bom.download' : path.endsWith('/verifications') ? 'bom.verify' : read ? 'bom.read' : 'bom.write'];
  }
  if (/^\/scheme-imports(?:\/|$)/.test(path)) return ['schemes.import'];
  if (/^\/schemes(?:\/|$)/.test(path)) {
    if (path.endsWith('/reviews')) return ['schemes.review'];
    if (/\/(?:publish|unpublish)$/.test(path)) return ['schemes.publish'];
    return [read ? 'schemes.read' : method === 'POST' ? 'schemes.create' : method === 'DELETE' ? 'schemes.delete' : 'schemes.update'];
  }
  const modules: Record<string, string> = {
    users: 'users', admins: 'admins', roles: 'roles', permissions: 'roles', credits: 'credits',
    'scheme-searches': 'searches', projects: 'projects', 'project-assignees': 'projects',
    'generation-jobs': 'generation', dictionaries: 'dictionaries',
    'ai-protocols': 'ai-models', 'ai-providers': 'ai-models', 'ai-models': 'ai-models', 'ai-model-assignments': 'ai-models',
    'prompt-templates': 'prompts', 'applicability-questions': 'questions', 'audit-logs': 'audit',
  };
  const root = path.split('/')[1] ?? '';
  if (root === 'project-notifications') return ['notifications.read'];
  const module = modules[root];
  return module ? [`${module}.${read ? 'read' : 'write'}`] : null;
}

export function registerAdminAuthorization(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (request.routeOptions.config.authentication === 'public') return;
    const principal = requirePrincipal(request, 'admin');
    const required = adminRoutePermissions(request.method, request.routeOptions.url ?? '');
    if (required === null || (required.length > 0 && !required.some(code => principal.permissions.includes(code)))) {
      throw authenticationError(403, 'ACCESS_DENIED');
    }
  });
}
