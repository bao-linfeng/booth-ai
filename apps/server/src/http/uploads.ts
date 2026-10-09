import type { MultipartFile } from '@fastify/multipart';
import { domainError } from '../lib/errors.js';

const MiB = 1024 * 1024;

/** multipart 默认单文件上限，方案资源新增与替换使用该值，须与管理端的上传提示一致。 */
export const defaultUploadMaxBytes = 50 * MiB;

/** 方案导入、清单导入的 Excel 单文件上限，须与管理端导入弹窗的提示一致。 */
export const workbookUploadMaxBytes = 20 * MiB;

/**
 * 读完上传文件。超过 fileSize 时插件只截断流而不报错，
 * 必须在这里拒绝，不能把截断内容交给解析或存储。
 */
export async function readUploadedFile(part: MultipartFile): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) chunks.push(chunk);
  if (part.file.truncated) throw domainError('FILE_TOO_LARGE', 413);
  return Buffer.concat(chunks);
}
