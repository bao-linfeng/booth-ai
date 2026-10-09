import { describe, expect, it } from 'vitest';

import { createUploadKey } from '../upload-key';

function file(name: string, content = 'x', lastModified = 1) {
  return new File([content], name, { lastModified });
}

describe('createUploadKey', () => {
  it('reuses the key when the same file is retried', () => {
    const uploadKey = createUploadKey();
    const first = uploadKey.forFile(file('a.png'));
    expect(uploadKey.forFile(file('a.png'))).toBe(first);
  });

  it('starts a new operation for a different file or after renew', () => {
    const uploadKey = createUploadKey();
    const first = uploadKey.forFile(file('a.png'));
    const changed = uploadKey.forFile(file('a.png', 'xy'));
    expect(changed).not.toBe(first);
    expect(uploadKey.forFile(file('b.png'))).not.toBe(changed);
    const beforeRenew = uploadKey.forFile(file('b.png'));
    uploadKey.renew();
    expect(uploadKey.forFile(file('b.png'))).not.toBe(beforeRenew);
  });
});
