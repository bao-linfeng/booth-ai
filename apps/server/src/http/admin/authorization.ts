import type { FastifyInstance } from 'fastify';
import { authenticationError } from '../../modules/identity/principal.js';
import { requirePrincipal } from '../authentication.js';
import { permissionCatalog, type PermissionCode } from '../../modules/identity/permissions.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * 管理端路由的基础权限，在路由配置里就近声明：任一权限码已授予即可进入，`[]` 表示任何已登录管理员可访问。
     * 未声明的非公开路由一律拒绝。涉及资产类型、对象归属或修改字段的细粒度判断在 handler / preHandler 中用 requireAdminPermission 完成。
     */
    permissions?: readonly PermissionCode[];
  }
}

/**
 * 权限码及其依赖（如 supervise 依赖 read + reply）是否全部授予。
 * 与路由声明的区别：路由 hook 只检查声明的权限码本身，不再校验依赖闭包。依赖闭包在写入时保证：
 * 管理端保存角色经 validatePermissionCodes 校验，迁移补授权限由 admin-role-permission-migration 测试断言内置角色满足闭包。
 */
export function hasAdminPermission(permissions: string[], code: PermissionCode): boolean {
  const definition = permissionCatalog.find(item => item.code === code);
  return !!definition && [code, ...definition.requires].every(required => permissions.includes(required));
}

export function requireAdminPermission(request: Parameters<typeof requirePrincipal>[0], code: PermissionCode): void {
  if (!hasAdminPermission(requirePrincipal(request, 'admin').permissions, code)) throw authenticationError(403, 'ACCESS_DENIED');
}

export function registerAdminAuthorization(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    const { authentication, permissions } = request.routeOptions.config;
    if (authentication === 'public') return;
    const principal = requirePrincipal(request, 'admin');
    if (!permissions || (permissions.length > 0 && !permissions.some(code => principal.permissions.includes(code)))) {
      throw authenticationError(403, 'ACCESS_DENIED');
    }
  });
}
