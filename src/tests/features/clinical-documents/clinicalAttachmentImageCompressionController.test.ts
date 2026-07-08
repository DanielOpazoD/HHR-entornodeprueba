import { describe, expect, it, vi } from 'vitest';

import { compressClinicalAttachmentImage } from '@/features/clinical-documents/controllers/clinicalAttachmentImageCompressionController';

describe('compressClinicalAttachmentImage', () => {
  it('returns not_needed when the image is already below target size', async () => {
    const file = new File([new Uint8Array(1024)], 'small.jpg', { type: 'image/jpeg' });

    await expect(compressClinicalAttachmentImage(file, { targetBytes: 2048 })).resolves.toEqual({
      status: 'not_needed',
      file,
    });
  });

  it('compresses using injected browser primitives', async () => {
    const original = new File([new Uint8Array(4096)], 'large.jpg', { type: 'image/jpeg' });
    const compressedBlob = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob: vi.fn((callback: BlobCallback) => callback(compressedBlob)),
    } as unknown as HTMLCanvasElement;

    const result = await compressClinicalAttachmentImage(original, {
      targetBytes: 2048,
      createImageBitmap: vi.fn(async () => ({ width: 3000, height: 1500 }) as ImageBitmap),
      createCanvas: () => canvas,
    });

    expect(result).toMatchObject({
      status: 'compressed',
      originalSizeBytes: 4096,
      compressedSizeBytes: 1024,
    });
    if (result.status === 'compressed') {
      expect(result.file.name).toBe('large.jpg');
      expect(result.file.type).toBe('image/jpeg');
    }
  });

  it('retries with lower quality when the first compressed image is still too large', async () => {
    const original = new File([new Uint8Array(4096)], 'large.jpg', { type: 'image/jpeg' });
    const blobs = [
      new Blob([new Uint8Array(3072)], { type: 'image/jpeg' }),
      new Blob([new Uint8Array(1536)], { type: 'image/jpeg' }),
    ];
    const toBlob = vi.fn((callback: BlobCallback) => callback(blobs.shift() ?? null));
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob,
    } as unknown as HTMLCanvasElement;

    const result = await compressClinicalAttachmentImage(original, {
      targetBytes: 2048,
      quality: 0.86,
      createImageBitmap: vi.fn(async () => ({ width: 3000, height: 1500 }) as ImageBitmap),
      createCanvas: () => canvas,
    });

    expect(toBlob).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'compressed',
      compressedSizeBytes: 1536,
      quality: 0.74,
    });
  });

  it('falls back to jpeg output when a large png does not compress enough', async () => {
    const original = new File([new Uint8Array(4096)], 'large.png', { type: 'image/png' });
    const oversizedPng = new Blob([new Uint8Array(3072)], { type: 'image/png' });
    const compressedJpeg = new Blob([new Uint8Array(1536)], { type: 'image/jpeg' });
    const toBlob = vi.fn((callback: BlobCallback, contentType?: string) => {
      callback(contentType === 'image/jpeg' ? compressedJpeg : oversizedPng);
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage: vi.fn() })),
      toBlob,
    } as unknown as HTMLCanvasElement;

    const result = await compressClinicalAttachmentImage(original, {
      targetBytes: 2048,
      quality: 0.82,
      createImageBitmap: vi.fn(async () => ({ width: 3000, height: 1500 }) as ImageBitmap),
      createCanvas: () => canvas,
    });

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', 0.82);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/jpeg', 0.82);
    expect(result).toMatchObject({
      status: 'compressed',
      compressedSizeBytes: 1536,
    });
    if (result.status === 'compressed') {
      expect(result.file.name).toBe('large.jpg');
      expect(result.file.type).toBe('image/jpeg');
    }
  });

  it('returns a failed result when the browser cannot decode the image', async () => {
    const original = new File([new Uint8Array(4096)], 'large.jpg', { type: 'image/jpeg' });

    await expect(
      compressClinicalAttachmentImage(original, {
        targetBytes: 2048,
        createImageBitmap: vi.fn(async () => {
          throw new Error('decode failed');
        }),
      })
    ).resolves.toMatchObject({
      status: 'failed',
      reason: 'No se pudo leer la imagen para comprimirla.',
    });
  });
});
