import type { FastifyInstance } from 'fastify';
import { authenticationError } from '../../modules/identity/principal.js';
import { requirePrincipal } from '../authentication.js';
import { assetPermissionGroups, permissionCatalog } from '../../modules/identity/permissions.js';

export function requireAdminPermission(request: Parameters<typeof requirePrincipal>[0], code: string): void {
  const permissions = requirePrincipal(request, 'admin').permissions;
  const definition = permissionCatalog.find(item => item.code === code);
  if (!definition || ![code, ...definition.requires].every(required => permissions.includes(required))) {
    throw authenticationError(403, 'ACCESS_DENIED');
  }
}

export function adminRoutePermissions(method: string, url: string): string[] | null {
  const path = url.replace(/^\/api\/v1\/admin(?=\/)/, '');
  if (['/me', '/access'].includes(path)) return [];
  if (path === '/dashboard/workspace' && (method === 'GET' || method === 'HEAD')) return ['workspace.read'];
  if (path === '/dashboard/analytics' && (method === 'GET' || method === 'HEAD')) return ['dashboard.read'];
  const read = method === 'GET' || method === 'HEAD';
  if (/^\/schemes\/:code\/assets(?:\/|$)/.test(path) || path === '/assets') {
    // 共享资产接口在解析类型或读取目标资产后检查对应页面的权限。
    return Object.values(assetPermissionGroups).map(group => `${group}.read`);
  }
  if (path === '/bill-of-materials' || /^\/schemes\/:code\/bill-of-materials(?:\/|$)/.test(path)) {
    return [path.endsWith('/download') ? 'bom.download' : path.endsWith('/verifications') ? 'bom.verify' : /\/imports(?:\/|$)/.test(path) ? 'bom.import' : read ? 'bom.read' : method === 'DELETE' ? /\/items\//.test(path) ? 'bom.delete-item' : 'bom.delete' : 'bom.update'];
  }
  if (/^\/scheme-imports(?:\/|$)/.test(path)) return ['schemes.import'];
  if (/^\/schemes(?:\/|$)/.test(path)) {
    if (path.endsWith('/reviews')) return ['schemes.review'];
    if (path.endsWith('/readiness')) return ['schemes.readiness'];
    if (path.endsWith('/publish')) return ['schemes.publish'];
    if (path.endsWith('/unpublish')) return ['schemes.unpublish'];
    return [read ? 'schemes.read' : method === 'POST' ? 'schemes.create' : method === 'DELETE' ? 'schemes.delete' : 'schemes.update'];
  }
  if (path.startsWith('/projects/')) {
    if (path.endsWith('/quotation/download')) return ['projects.quotation-download'];
    if (path.endsWith('/download')) return ['projects.asset-download'];
    if (!read) {
      if (path.endsWith('/assignee')) return ['projects.assign'];
      if (path.endsWith('/follow-ups')) return ['projects.follow-up'];
      if (path.endsWith('/scheme')) return ['projects.link-scheme'];
      if (path.endsWith('/quotation')) return ['projects.quotation'];
      return null;
    }
    return ['projects.read'];
  }
  if (path === '/project-assignees') return ['projects.assign'];
  if (path === '/project-assignment-config') return [read ? 'projects.read' : 'projects.assign'];
  if (path === '/credits/recharge') return ['credits.recharge'];
  if (path === '/credits/sign-in-config' && method === 'PUT') return ['credits.sign_in_config'];
  if (path === '/scheme-searches/statistics') return ['search-analytics.read'];
  if (path === '/scheme-searches/:id') return ['searches.detail'];
  if (path === '/users/:id') return ['users.detail'];
  if (path === '/generation-jobs/:jobId') return ['generation.detail'];
  if (path === '/project-notifications/read-all') return ['notifications.mark-all-read'];
  if (path === '/project-notifications/:id/read') return ['notifications.mark-read'];
  if (path.startsWith('/dictionaries') && !read) {
    const item = path.includes('/items');
    return [`dictionaries.${item ? 'item-' : ''}${method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update'}`];
  }
  if (path === '/ai-providers/probe' || path.endsWith('/catalog/refresh')) return ['ai-models.discover'];
  if (!read && path.startsWith('/ai-')) {
    if (path.startsWith('/ai-model-assignments/')) return ['ai-models.assign'];
    const entity = path.startsWith('/ai-providers') ? 'provider' : path.startsWith('/ai-models') ? 'model' : null;
    return entity ? [`ai-models.${entity}-${method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'update'}`] : null;
  }
  if (path === '/prompt-templates/preview') return ['prompts.preview'];
  if (path === '/prompt-templates' && method === 'POST') return ['prompts.create'];
  if (path === '/prompt-templates/:id' && method === 'PATCH') return ['prompts.update', 'prompts.enable', 'prompts.disable'];
  if (path.startsWith('/customer-service/')) {
    if (path === '/customer-service/settings') return [read ? 'customer-service.read' : 'customer-service.settings'];
    if (path === '/customer-service/agents' || path.endsWith('/transfer')) return ['customer-service.supervise'];
    if (read || path === '/customer-service/events-ticket') return ['customer-service.read'];
    return ['customer-service.reply'];
  }
  const modules: Record<string, string> = {
    users: 'users', admins: 'admins', roles: 'roles', permissions: 'roles', credits: 'credits',
    'scheme-searches': 'searches', projects: 'projects', 'project-assignees': 'projects',
    'generation-jobs': 'generation', dictionaries: 'dictionaries',
    'ai-protocols': 'ai-models', 'ai-providers': 'ai-models', 'ai-models': 'ai-models', 'ai-model-assignments': 'ai-models',
    'prompt-templates': 'prompts', 'audit-logs': 'audit',
  };
  const root = path.split('/')[1] ?? '';
  if (root === 'project-notifications') return ['notifications.read'];
  const module = modules[root];
  return module && (read || module === 'roles') ? [`${module}.${read ? 'read' : 'write'}`] : null;
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
  app.addHook('preHandler', async request => {
    if (request.routeOptions.config.authentication === 'public') return;
    const path = request.routeOptions.url?.replace(/^\/api\/v1\/admin(?=\/)/, '');
    if (request.method !== 'PATCH' || path !== '/prompt-templates/:id') return;
    const body = request.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== 'object') return;
    if (Object.keys(body).some(key => key !== 'enabled' && key !== 'expectedRevision')) requireAdminPermission(request, 'prompts.update');
    if (body.enabled !== undefined) requireAdminPermission(request, `prompts.${body.enabled === true ? 'enable' : 'disable'}`);
  });
}
