function fileSignature(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

/**
 * 一次上传操作的幂等键：同一文件失败后重试沿用同一个键，服务端据此重放已成功的结果而不重复新建；
 * 换了文件或调用 `renew`（打开弹窗、上传成功）即视为新操作。
 */
export function createUploadKey() {
  let key = crypto.randomUUID();
  let signature: string | undefined;
  return {
    forFile(file: File): string {
      const next = fileSignature(file);
      if (signature !== undefined && signature !== next)
        key = crypto.randomUUID();
      signature = next;
      return key;
    },
    renew() {
      key = crypto.randomUUID();
      signature = undefined;
    },
  };
}
