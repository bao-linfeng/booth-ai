export const scopeOptions = [
  { code: 'materials', label: '材料采购' },
  { code: 'graphics', label: '品牌画面' },
  { code: 'transport', label: '运输' },
  { code: 'installation', label: '搭建' },
  { code: 'other', label: '其他' },
]

export function scopeLabel(code: string) {
  return scopeOptions.find(scope => scope.code === code)?.label ?? '其他'
}
