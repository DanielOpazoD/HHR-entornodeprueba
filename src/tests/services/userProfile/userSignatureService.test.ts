import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createUserSignatureService,
  describeUserSignatureFileProblem,
  USER_SIGNATURE_MAX_BYTES,
} from '@/services/user-profile/userSignatureService';

const storageModule = {
  ref: vi.fn((_storage: unknown, path: string) => ({ fullPath: path })),
  uploadBytes: vi.fn(),
  getBlob: vi.fn(),
  deleteObject: vi.fn(),
};
const service = createUserSignatureService({
  getStorage: async () => ({}) as never,
  loadStorageModule: async () => storageModule as never,
});

const file = (type: string, size = 64) => new File([new Uint8Array(size)], 'firma', { type });

describe('userSignatureService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts PNG, JPG and WEBP up to 500 KB and explains anything else', () => {
    expect(describeUserSignatureFileProblem(file('image/png'))).toBeNull();
    expect(describeUserSignatureFileProblem(file('image/jpeg'))).toBeNull();
    expect(
      describeUserSignatureFileProblem(file('image/webp', USER_SIGNATURE_MAX_BYTES))
    ).toBeNull();
    expect(describeUserSignatureFileProblem(file('image/gif'))).toBe(
      'La firma debe ser una imagen PNG, JPG o WEBP.'
    );
    expect(describeUserSignatureFileProblem(file('image/svg+xml'))).toMatch(/PNG, JPG o WEBP/);
    expect(describeUserSignatureFileProblem(file('image/png', USER_SIGNATURE_MAX_BYTES + 1))).toBe(
      'La imagen de la firma supera el límite de 500 KB.'
    );
  });

  it('stores the signature under the owner uid, kept out of the browser cache', async () => {
    const image = file('image/png');
    await service.save('uid-1', image);

    expect(storageModule.uploadBytes).toHaveBeenCalledWith(
      { fullPath: 'user-signatures/uid-1/signature' },
      image,
      { contentType: 'image/png', cacheControl: 'private, no-store' }
    );
  });

  it('refuses an invalid file before anything is uploaded', async () => {
    await expect(service.save('uid-1', file('application/pdf'))).rejects.toThrow(/PNG, JPG/);
    await expect(service.save('uid-1', file('image/png', 600 * 1024))).rejects.toThrow(/500 KB/);
    expect(storageModule.uploadBytes).not.toHaveBeenCalled();
  });

  it('reads no signature as null but a failed read as an error', async () => {
    storageModule.getBlob.mockRejectedValueOnce({ code: 'storage/object-not-found' });
    await expect(service.load('uid-1')).resolves.toBeNull();

    storageModule.getBlob.mockRejectedValueOnce({ code: 'storage/unauthorized' });
    await expect(service.load('uid-1')).rejects.toEqual({ code: 'storage/unauthorized' });

    const blob = new Blob(['x'], { type: 'image/png' });
    storageModule.getBlob.mockResolvedValueOnce(blob);
    await expect(service.load('uid-1')).resolves.toBe(blob);
  });

  it('deletes the signature, and deleting a missing one is not an error', async () => {
    storageModule.deleteObject.mockRejectedValueOnce({ code: 'storage/object-not-found' });
    await expect(service.remove('uid-1')).resolves.toBeUndefined();
    storageModule.deleteObject.mockRejectedValueOnce({ code: 'storage/retry-limit-exceeded' });
    await expect(service.remove('uid-1')).rejects.toBeTruthy();
  });
});
