import { requestClient } from '#/api/request';

export interface AdminRole {
  id: number;
  name: string;
  permissionCodes: string[];
  revision: number;
  builtIn: boolean;
}

export interface PermissionDefinition {
  code: string;
  label: string;
  group: string;
  kind: 'action' | 'route';
  requires: string[];
}

export interface AdminAccess {
  permissions: string[];
  routeNames: string[];
  homePath: string;
}

export const getAdminAccessApi = () =>
  requestClient.get<AdminAccess>('/v1/admin/access');

export const getRolesApi = () =>
  requestClient.get<AdminRole[]>('/v1/admin/roles');

export const getRoleApi = (id: number) =>
  requestClient.get<AdminRole>(`/v1/admin/roles/${id}`);

export const getPermissionCatalogApi = () =>
  requestClient.get<PermissionDefinition[]>('/v1/admin/permissions');

export const updateRolePermissionsApi = (
  id: number,
  permissionCodes: string[],
  expectedRevision: number,
) =>
  requestClient.put<AdminRole>(`/v1/admin/roles/${id}/permissions`, {
    permissionCodes,
    expectedRevision,
  });
