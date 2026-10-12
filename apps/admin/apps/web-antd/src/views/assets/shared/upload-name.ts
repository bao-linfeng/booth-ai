/** 资源名称默认值：文件原始名称去掉扩展名 */
export function defaultAssetName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || filename;
}
