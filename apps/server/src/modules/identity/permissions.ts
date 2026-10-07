export const assetPermissionGroups = {
  rendering: 'assets-renderings', mask: 'assets-masks', drawing: 'assets-drawings',
  artwork: 'assets-artworks', model: 'assets-models', checklist: 'assets-checklists',
} as const;

export const permissionGroups = [
  { key: 'dashboard', label: '分析页', routes: ['Analytics'], actions: [['read', '查看分析页']] },
  { key: 'workspace', label: '工作台', routes: ['Workspace'], actions: [['read', '查看工作台']] },
  { key: 'users', label: '用户列表', routes: ['UserList'], actions: [['read', '查看用户列表'], ['detail', '查看用户详情']] },
  { key: 'admins', label: '管理员列表', routes: ['AdminList'], actions: [['read', '查看管理员列表']] },
  { key: 'roles', label: '用户角色', routes: ['UserRoles'], actions: [['read', '查看角色与权限'], ['write', '配置权限']] },
  { key: 'credits', label: '积分流水', routes: ['CreditList'], actions: [['read', '查看流水与余额'], ['recharge', '充值积分']] },
  { key: 'searches', label: '检索记录', routes: ['AiSelectionSearches'], actions: [['read', '查看检索记录'], ['detail', '查看检索详情']] },
  { key: 'search-analytics', label: '趋势与统计', routes: ['AiSelectionAnalytics'], actions: [['read', '查看趋势与统计']] },
  { key: 'schemes', label: '方案管理', routes: ['SchemeList', 'SchemeDetail'], actions: [['read', '查看方案与详情'], ['readiness', '检查发布条件'], ['create', '新建方案'], ['update', '编辑方案'], ['delete', '删除方案'], ['import', '批量导入方案'], ['review', '提交审核'], ['publish', '发布方案'], ['unpublish', '下架方案']] },
  { key: 'assets-renderings', label: '效果图', routes: ['AssetsRenderings'], actions: [['read', '查看效果图'], ['upload', '上传效果图'], ['replace', '替换文件'], ['update', '修改排序'], ['preview', '预览效果图'], ['delete', '删除效果图']] },
  { key: 'assets-masks', label: '蒙版', routes: ['AssetsMasks'], actions: [['read', '查看蒙版'], ['upload', '上传蒙版'], ['replace', '替换文件'], ['update', '修改排序'], ['preview', '叠加预览'], ['download', '下载蒙版'], ['delete', '删除蒙版']] },
  { key: 'assets-drawings', label: '报馆图', routes: ['AssetsVenueMaterials'], actions: [['read', '查看报馆图'], ['upload', '上传报馆图'], ['replace', '替换文件'], ['download', '下载报馆图'], ['delete', '删除报馆图']] },
  { key: 'assets-artworks', label: '平面素材', routes: ['AssetsArtworks'], actions: [['read', '查看平面素材'], ['upload', '上传平面素材'], ['replace', '替换文件'], ['download', '下载平面素材'], ['delete', '删除平面素材']] },
  { key: 'assets-models', label: '方案模型', routes: ['SchemeList', 'SchemeDetail'], actions: [['read', '查看模型'], ['upload', '上传模型'], ['download', '下载模型']] },
  { key: 'assets-checklists', label: '历史清单文件', routes: [], actions: [['read', '查看历史清单文件'], ['upload', '上传文件'], ['replace', '替换文件'], ['update', '编辑文件信息'], ['download', '下载文件'], ['delete', '删除文件']] },
  { key: 'bom', label: '清单管理', routes: ['BillOfMaterialsManagement'], actions: [['read', '查看清单与详情'], ['import', '导入 / 替换 Excel'], ['update', '编辑清单条目'], ['delete-item', '删除清单条目'], ['delete', '删除整份清单'], ['verify', '提交核验'], ['download', '导出客户清单']] },
  { key: 'projects', label: '项目管理', routes: ['ProjectList', 'ProjectDetail'], actions: [['read', '查看项目与报价历史及接单状态'], ['assign', '改派承接人 / 配置默认接单人'], ['follow-up', '追加跟进与状态记录'], ['link-scheme', '确认关联方案'], ['quotation', '编辑并保存报价修订'], ['quotation-download', '导出报价修订'], ['asset-download', '下载固定资料']] },
  { key: 'generation', label: '生成任务', routes: ['GenerationJobs'], actions: [['read', '查看生成任务'], ['detail', '查看任务详情']] },
  { key: 'notifications', label: '消息通知', routes: ['ProjectNotifications'], actions: [['read', '查看消息与详情'], ['mark-read', '标记消息已读'], ['mark-all-read', '全部已读']] },
  { key: 'dictionaries', label: '字典管理', routes: ['DictionaryList'], actions: [['read', '查看字典与字典项'], ['create', '新建字典'], ['update', '编辑字典'], ['delete', '删除字典'], ['item-create', '新增字典项'], ['item-update', '编辑字典项'], ['item-delete', '删除字典项']] },
  { key: 'ai-models', label: 'AI 模型配置', routes: ['AiModels'], actions: [['read', '查看供应商、模型与用途'], ['provider-create', '新建供应商'], ['provider-update', '编辑供应商'], ['provider-delete', '删除供应商'], ['discover', '测试连接 / 刷新模型目录'], ['model-create', '添加模型'], ['model-update', '编辑模型'], ['model-delete', '删除模型'], ['assign', '配置用途、主备顺序与积分']] },
  { key: 'prompts', label: '提示词模板', routes: ['PromptTemplates'], actions: [['read', '查看模板'], ['create', '新建模板'], ['update', '编辑模板'], ['enable', '启用模板'], ['disable', '停用模板'], ['preview', '渲染预览']] },
  { key: 'audit', label: '审计日志', routes: [], actions: [['read', '查看审计日志']] },
] as const;

const moduleDependencies: Record<string, string[]> = {
  bom: ['schemes.read', 'dictionaries.read'], credits: ['users.read'],
  searches: ['users.read', 'schemes.read'], prompts: ['schemes.read'],
};
const actionDependencies: Record<string, string[]> = {
  'assets-masks.upload': ['assets-renderings.read'],
  'assets-masks.preview': ['assets-renderings.read', 'assets-renderings.preview'],
  'prompts.create': ['prompts.preview'], 'prompts.update': ['prompts.preview'],
  'schemes.review': ['schemes.readiness'], 'schemes.publish': ['schemes.readiness'],
};

export const permissionCatalog = permissionGroups.flatMap(group => group.actions.map(([action, label]) => ({
  code: `${group.key}.${action}`, label, group: group.label, groupKey: group.key, routes: [...group.routes],
  kind: action === 'read' ? 'route' as const : 'action' as const,
  requires: action === 'read'
    ? group.key.startsWith('assets-') ? ['schemes.read'] : moduleDependencies[group.key] ?? []
    : [`${group.key}.read`, ...(actionDependencies[`${group.key}.${action}`] ?? [])],
})));
export const allPermissionCodes = permissionCatalog.map(item => item.code);

export function assetPermissionCode(type: keyof typeof assetPermissionGroups, action: string): string {
  return `${assetPermissionGroups[type]}.${action}`;
}

export function accessSummary(permissions: string[]) {
  const granted = new Set(permissions);
  const routeNames = new Set(['Profile']);
  for (const item of permissionCatalog) {
    if (item.kind === 'route' && granted.has(item.code)) item.routes.forEach(route => routeNames.add(route));
  }
  if (granted.has('schemes.read') && granted.has('schemes.create')) routeNames.add('SchemeCreate');
  return { permissions, routeNames: [...routeNames], homePath: granted.has('dashboard.read') ? '/dashboard/analytics' : granted.has('workspace.read') ? '/dashboard/workspace' : '/profile' };
}

export function validatePermissionCodes(codes: string[]): string[] {
  if (codes.some(code => !allPermissionCodes.includes(code))) {
    throw Object.assign(new Error('包含未知权限'), { statusCode: 400 });
  }
  const result = [...new Set(codes)];
  for (const definition of permissionCatalog) {
    if (result.includes(definition.code) && definition.requires.some(code => !result.includes(code))) {
      throw Object.assign(new Error('请先授予对应页面及依赖操作的权限'), { statusCode: 400 });
    }
  }
  return result.sort();
}
