import type { RouteRecordRaw } from 'vue-router';

import type { PermissionDefinition } from '#/api/core/roles';

export interface PermissionTreeNode {
  /** 树内唯一键；同一权限出现在多个页面下时各自独立 */
  id: string;
  title: string;
  icon?: string;
  type: 'action' | 'menu' | 'page';
  /** 操作节点对应的权限码 */
  code?: string;
  /** 页面节点：与其共用同一组权限的其他页面标题 */
  sharedWith: string[];
  /** 操作节点没有 children */
  children?: PermissionTreeNode[];
}

const UNLINKED_ID = 'menu:__unlinked__';

export type Translate = (key: string) => string;

/** meta.title 可能是未翻译的 i18n key（路由模块先于语言包加载），与菜单渲染一致需再翻译一次 */
function titleOf(route: RouteRecordRaw, translate: Translate) {
  return translate(String(route.meta?.title ?? route.name ?? route.path));
}

function iconOf(route: RouteRecordRaw) {
  const icon = route.meta?.icon;
  return typeof icon === 'string' ? icon : undefined;
}

function orderOf(route: RouteRecordRaw) {
  return route.meta?.order ?? 0;
}

/** 带 activePath 的路由是其他页面的从属页（详情、新建），权限由所属页面决定，不单列 */
function isSubPage(route: RouteRecordRaw) {
  return !!route.meta?.activePath;
}

function pageNode(
  id: string,
  title: string,
  icon: string | undefined,
  permissions: PermissionDefinition[],
): PermissionTreeNode {
  return {
    id: `page:${id}`,
    title,
    icon,
    type: 'page',
    sharedWith: [],
    children: permissions.map((item) => ({
      id: `action:${id}:${item.code}`,
      title: item.label,
      type: 'action' as const,
      code: item.code,
      sharedWith: [],
    })),
  };
}

/**
 * 按真实路由生成「一级菜单 → 二级页面 → 页面操作」的权限树。
 * 页面与权限的对应关系以服务端目录的 routes 为准；没有页面的权限模块归入「其他」。
 */
export function buildPermissionTree(
  routes: RouteRecordRaw[],
  catalog: PermissionDefinition[],
  translate: Translate = (key) => key,
): PermissionTreeNode[] {
  const groups = new Map<string, PermissionDefinition[]>();
  const permissionsByRoute = new Map<string, PermissionDefinition[]>();
  for (const item of catalog) {
    groups.set(item.groupKey, [...(groups.get(item.groupKey) ?? []), item]);
    for (const name of item.routes) {
      permissionsByRoute.set(name, [
        ...(permissionsByRoute.get(name) ?? []),
        item,
      ]);
    }
  }

  const pages: PermissionTreeNode[] = [];
  const toPage = (route: RouteRecordRaw): PermissionTreeNode | undefined => {
    const permissions =
      typeof route.name === 'string'
        ? permissionsByRoute.get(route.name)
        : undefined;
    if (!permissions || isSubPage(route)) return undefined;
    const node = pageNode(
      String(route.name),
      titleOf(route, translate),
      iconOf(route),
      permissions,
    );
    pages.push(node);
    return node;
  };

  const tree: PermissionTreeNode[] = [];
  for (const route of routes.toSorted((a, b) => orderOf(a) - orderOf(b))) {
    if (route.children?.length) {
      const children = route.children
        .map(toPage)
        .filter((node): node is PermissionTreeNode => !!node);
      if (children.length > 0) {
        tree.push({
          id: `menu:${String(route.name ?? route.path)}`,
          title: titleOf(route, translate),
          icon: iconOf(route),
          type: 'menu',
          sharedWith: [],
          children,
        });
      }
    } else {
      const page = toPage(route);
      if (page) tree.push(page);
    }
  }

  for (const node of pages) {
    const codes = node.children?.map((child) => child.code) ?? [];
    node.sharedWith = pages
      .filter(
        (page) =>
          page !== node &&
          page.children?.length === codes.length &&
          page.children.every((child) => codes.includes(child.code)),
      )
      .map((page) => page.title);
  }

  const shown = new Set(
    pages.flatMap((page) => page.children?.map((child) => child.code) ?? []),
  );
  const unlinked = [...groups.entries()]
    .map(
      ([key, permissions]) =>
        [key, permissions.filter((item) => !shown.has(item.code))] as const,
    )
    .filter(([, permissions]) => permissions.length > 0);
  if (unlinked.length > 0) {
    tree.push({
      id: UNLINKED_ID,
      title: '其他',
      type: 'menu',
      sharedWith: [],
      children: unlinked.map(([key, permissions]) =>
        pageNode(key, permissions[0]?.group ?? key, undefined, permissions),
      ),
    });
  }
  return tree;
}

/** 树内操作节点 id → 权限码 */
export function actionCodeMap(tree: PermissionTreeNode[]): Map<string, string> {
  const result = new Map<string, string>();
  const walk = (nodes: PermissionTreeNode[]) =>
    nodes.forEach((node) => {
      if (node.code) result.set(node.id, node.code);
      if (node.children) walk(node.children);
    });
  walk(tree);
  return result;
}

/**
 * 权限码 → Tree 组件的选中键：已授权码对应的所有操作节点（共用权限的页面同步选中），
 * 以及后代全部选中的页面/菜单节点（与组件自身的父子联动结果一致）。
 */
export function toTreeSelection(
  tree: PermissionTreeNode[],
  codes: string[],
): string[] {
  const granted = new Set(codes);
  const selected: string[] = [];
  const walk = (node: PermissionTreeNode): boolean => {
    const full = node.children?.length
      ? node.children.map((child) => walk(child)).every(Boolean)
      : !!node.code && granted.has(node.code);
    if (full) selected.push(node.id);
    return full;
  };
  tree.forEach((node) => walk(node));
  return selected;
}

/** 比较 Tree 组件前后两次选中键，得出新增与取消的权限码（忽略菜单/页面节点） */
export function diffTreeSelection(
  tree: PermissionTreeNode[],
  previous: string[],
  next: string[],
) {
  const codes = actionCodeMap(tree);
  const before = new Set(previous);
  const after = new Set(next);
  const pick = (from: Set<string>, without: Set<string>) => [
    ...new Set(
      [...from]
        .filter((id) => !without.has(id))
        .map((id) => codes.get(id))
        .filter((code): code is string => !!code),
    ),
  ];
  return { added: pick(after, before), removed: pick(before, after) };
}
