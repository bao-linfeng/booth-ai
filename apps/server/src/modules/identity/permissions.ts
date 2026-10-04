export const permissionGroups = [
  { key: 'dashboard', label: '工作台', routes: ['Analytics', 'Workspace'], actions: [['read', '查看工作台']] },
  { key: 'users', label: '用户列表', routes: ['UserList'], actions: [['read', '查看用户']] },
  { key: 'admins', label: '管理员列表', routes: ['AdminList'], actions: [['read', '查看管理员']] },
  { key: 'roles', label: '用户角色', routes: ['UserRoles'], actions: [['read', '查看角色'], ['write', '配置权限']] },
  { key: 'credits', label: '积分流水', routes: ['CreditList'], actions: [['read', '查看流水'], ['write', '充值与对账']] },
  { key: 'searches', label: 'AI 智选', routes: ['AiSelectionSearches', 'AiSelectionAnalytics'], actions: [['read', '查看检索与统计']] },
  { key: 'schemes', label: '方案管理', routes: ['SchemeList', 'SchemeDetail'], actions: [['read', '查看方案'], ['create', '新建方案'], ['update', '编辑方案'], ['delete', '删除方案'], ['import', '导入方案'], ['review', '审核方案'], ['publish', '发布与下架']] },
  { key: 'assets', label: '资源管理', routes: ['AssetsRenderings', 'AssetsMasks', 'AssetsVenueMaterials', 'AssetsArtworks'], actions: [['read', '查看资源'], ['write', '上传、编辑与删除'], ['download', '下载资源']] },
  { key: 'bom', label: '清单管理', routes: ['BillOfMaterialsManagement'], actions: [['read', '查看清单'], ['write', '导入、编辑与删除'], ['verify', '核验清单'], ['download', '下载清单']] },
  { key: 'projects', label: '项目管理', routes: ['ProjectList', 'ProjectDetail'], actions: [['read', '查看项目'], ['write', '承接、报价与交付']] },
  { key: 'generation', label: '生成任务', routes: ['GenerationJobs'], actions: [['read', '查看生成任务']] },
  { key: 'notifications', label: '消息通知', routes: ['ProjectNotifications'], actions: [['read', '查看与标记消息']] },
  { key: 'dictionaries', label: '字典管理', routes: ['DictionaryList'], actions: [['read', '查看字典'], ['write', '维护字典']] },
  { key: 'ai-models', label: 'AI 模型配置', routes: ['AiModels'], actions: [['read', '查看模型配置'], ['write', '维护供应商与模型']] },
  { key: 'prompts', label: '提示词模板', routes: ['PromptTemplates'], actions: [['read', '查看模板'], ['write', '编辑与预览模板']] },
  { key: 'questions', label: '适用条件问题', routes: ['ApplicabilityQuestions'], actions: [['read', '查看问题'], ['write', '维护问题']] },
  { key: 'audit', label: '审计日志', routes: [], actions: [['read', '查看审计日志']] },
] as const;

const moduleDependencies: Record<string, string[]> = {
  assets: ['schemes.read'], bom: ['schemes.read', 'dictionaries.read'], credits: ['users.read'],
};

export const permissionCatalog = permissionGroups.flatMap(group => group.actions.map(([action, label]) => ({
  code: `${group.key}.${action}`, label, group: group.label,
  kind: action === 'read' ? 'route' as const : 'action' as const,
  requires: action === 'read' ? moduleDependencies[group.key] ?? [] : [`${group.key}.read`],
})));
export const allPermissionCodes = permissionCatalog.map(item => item.code);

export function accessSummary(permissions: string[]) {
  const granted = new Set(permissions);
  const routeNames: string[] = ['Profile'];
  for (const group of permissionGroups) {
    if (granted.has(`${group.key}.read`)) routeNames.push(...group.routes);
  }
  if (granted.has('schemes.read') && granted.has('schemes.create')) routeNames.push('SchemeCreate');
  return { permissions, routeNames, homePath: granted.has('dashboard.read') ? '/dashboard/analytics' : '/profile' };
}

export function validatePermissionCodes(codes: string[]): string[] {
  if (codes.some(code => !allPermissionCodes.includes(code))) {
    throw Object.assign(new Error('包含未知权限'), { statusCode: 400 });
  }
  const result = [...new Set(codes)];
  for (const definition of permissionCatalog) {
    if (result.includes(definition.code) && definition.requires.some(code => !result.includes(code))) {
      throw Object.assign(new Error('请先授予对应模块及依赖模块的查看权限'), { statusCode: 400 });
    }
  }
  return result.sort();
}
