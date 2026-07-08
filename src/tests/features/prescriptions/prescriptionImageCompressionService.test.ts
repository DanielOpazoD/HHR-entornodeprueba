import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('heic2any', () => ({
  default: vi.fn(),
}));

import heic2any from 'heic2any';
import { compressPrescriptionImage } from '@/features/prescriptions/services/prescriptionImageCompressionService';

const heic2anyMock = vi.mocked(heic2any);

const installCanvasMocks = () => {
  const drawImage = vi.fn();
  const blobs = [
    new Blob([new Uint8Array(2048)], { type: 'image/jpeg' }),
    new Blob([new Uint8Array(512)], { type: 'image/jpeg' }),
  ];
  const toBlob = vi.fn((callback: BlobCallback) => {
    callback(blobs.shift() ?? new Blob([new Uint8Array(256)], { type: 'image/jpeg' }));
  });
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob,
  } as unknown as HTMLCanvasElement;
  vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    if (tagName === 'canvas') return canvas;
    return document.createElement(tagName);
  });
  return { canvas, drawImage, toBlob };
};

const installFileReaderMock = () => {
  class MockFileReader {
    result: string | ArrayBuffer | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    readAsDataURL() {
      this.result = 'data:image/jpeg;base64,ZmFrZQ==';
      this.onload?.();
    }
  }

  vi.stubGlobal('FileReader', MockFileReader);
};

describe('compressPrescriptionImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    heic2anyMock.mockReset();
  });

  it('falls back to createImageBitmap when an existing mobile photo cannot be decoded as an img element', async () => {
    const revokeObjectURL = vi.fn();
    const objectUrls = ['blob:original-upload', 'blob:prescription-preview'];
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => objectUrls.shift() ?? 'blob:fallback'),
      revokeObjectURL,
    });
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 0;
        naturalHeight = 0;

        set src(_value: string) {
          this.onerror?.();
        }
      }
    );
    const close = vi.fn();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 2400, height: 1200, close }) as unknown as ImageBitmap)
    );
    installCanvasMocks();
    installFileReaderMock();

    const result = await compressPrescriptionImage(
      new File([new Uint8Array(4096)], 'receta-samsung.jpg', { type: 'image/jpeg' })
    );

    expect(result.full).toMatchObject({ width: 1200, height: 600, byteSize: 2048 });
    expect(result.thumbnail).toMatchObject({ width: 360, height: 180, byteSize: 512 });
    expect(result.previewObjectUrl).toBe('blob:prescription-preview');
    expect(close).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:original-upload');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:prescription-preview');
  });

  it('converts HEIC gallery photos to JPEG before browser decoding and compression', async () => {
    const convertedJpeg = new Blob([new Uint8Array(3072)], { type: 'image/jpeg' });
    heic2anyMock.mockResolvedValueOnce(convertedJpeg);
    const revokeObjectURL = vi.fn();
    const objectUrls = ['blob:converted-upload', 'blob:prescription-preview'];
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => objectUrls.shift() ?? 'blob:fallback'),
      revokeObjectURL,
    });
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        naturalWidth = 2000;
        naturalHeight = 1000;

        set src(_value: string) {
          this.onload?.();
        }
      }
    );
    installCanvasMocks();
    installFileReaderMock();

    const original = new File([new Uint8Array(4096)], 'receta-flip7.heic', {
      type: 'image/heic',
    });
    const result = await compressPrescriptionImage(original);

    expect(heic2anyMock).toHaveBeenCalledWith({
      blob: original,
      toType: 'image/jpeg',
      quality: 0.92,
    });
    expect(result.full).toMatchObject({ width: 1200, height: 600, byteSize: 2048 });
    expect(result.previewObjectUrl).toBe('blob:prescription-preview');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:converted-upload');
  });
});
