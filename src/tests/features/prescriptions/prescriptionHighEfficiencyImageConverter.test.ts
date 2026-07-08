import { beforeEach, describe, expect, it, vi } from 'vitest';

const createHeicFile = () => new File(['heic-data'], 'prescription.heic', { type: 'image/heic' });

describe('prescriptionHighEfficiencyImageConverter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('surfaces HEIC converter chunk load failures with a distinct message and original cause', async () => {
    const chunkLoadError = new TypeError('Failed to fetch dynamically imported module');
    vi.doMock('heic2any', () => {
      throw chunkLoadError;
    });

    const { convertHighEfficiencyImageToJpeg } =
      await import('@/features/prescriptions/services/prescriptionHighEfficiencyImageConverter');

    await expect(convertHighEfficiencyImageToJpeg(createHeicFile())).rejects.toMatchObject({
      message: expect.stringContaining('No se pudo cargar el conversor HEIC/HEIF'),
      cause: chunkLoadError,
    });
    await expect(convertHighEfficiencyImageToJpeg(createHeicFile())).rejects.not.toThrow(
      'este navegador no pudo convertirla'
    );
  });

  it('keeps HEIC decode failures translated while preserving the original cause', async () => {
    const decodeError = new Error('heic decode failed');
    vi.doMock('heic2any', () => ({
      default: vi.fn(async () => {
        throw decodeError;
      }),
    }));

    const { convertHighEfficiencyImageToJpeg } =
      await import('@/features/prescriptions/services/prescriptionHighEfficiencyImageConverter');

    await expect(convertHighEfficiencyImageToJpeg(createHeicFile())).rejects.toMatchObject({
      message: expect.stringContaining('este navegador no pudo convertirla'),
      cause: decodeError,
    });
  });
});
