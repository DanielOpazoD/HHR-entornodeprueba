import { beforeEach, describe, expect, it, vi } from 'vitest';
const core = vi.hoisted(() => ({
  images: new Map(),
  volumes: new Map(),
  metadata: new Map(),
  available: 1e8,
  failCreate: false,
  add: vi.fn(),
  removeImage: vi.fn(),
  removeVolume: vi.fn(),
}));
vi.mock('@cornerstonejs/core', () => ({
  cache: {
    getImage: (id: string) => core.images.get(id),
    getImageLoadObject: (id: string) => core.images.get(id),
    getVolumeLoadObject: (id: string) => core.volumes.get(id),
    getBytesAvailable: () => core.available,
    removeVolumeLoadObject: (id: string) => {
      core.removeVolume(id);
      core.volumes.delete(id);
    },
    removeImageLoadObject: (id: string) => {
      core.removeImage(id);
      core.images.delete(id);
    },
  },
  metaData: { get: (type: string, id: string) => core.metadata.get(`${id}:${type}`) },
  utilities: { makeVolumeMetadata: () => ({}), genericMetadataProvider: { add: core.add } },
  volumeLoader: {
    createAndCacheVolumeFromImages: async (id: string) => {
      core.volumes.set(id, {});
    },
    createLocalVolume: (
      id: string,
      options: { scalarData: Float32Array; dimensions: number[] }
    ) => {
      for (let i = 0; i < options.dimensions[2]; i++) {
        core.images.set(`${id}_slice_${i}`, {});
        if (core.failCreate) throw new Error('synthetic allocation failure');
      }
      const volume = { options };
      core.volumes.set(id, volume);
      return volume;
    },
  },
}));
import { createDicomVolume } from '@/services/radiology/dicomVolume';
const geometry = () =>
  [0, 1, 2].map(i => ({
    imageId: `synthetic-${i}`,
    frame: 'synthetic-frame',
    rows: i === 1 ? 2 : 4,
    columns: i === 1 ? 2 : 4,
    spacing: i === 1 ? [2, 2] : [1, 1],
    position: i === 1 ? [0.5, 0.5, i * 2] : [0, 0, i * 2],
    orientation: [1, 0, 0, 0, 1, 0],
  }));
const create = (supported = true, signal = new AbortController().signal) =>
  createDicomVolume('synthetic-volume', geometry(), 'CT', supported, signal);
beforeEach(() => {
  core.images.clear();
  core.volumes.clear();
  core.metadata.clear();
  core.available = 1e8;
  core.failCreate = false;
  vi.clearAllMocks();
  geometry().forEach(s => {
    core.images.set(s.imageId, {
      rows: s.rows,
      columns: s.columns,
      numberOfComponents: 1,
      getPixelData: () => new Int16Array(s.rows * s.columns).fill(542),
    });
    core.metadata.set(`${s.imageId}:imagePixelModule`, {
      photometricInterpretation: 'MONOCHROME2',
    });
    core.metadata.set(`${s.imageId}:modalityLutModule`, {
      rescaleSlope: 2,
      rescaleIntercept: -1024,
    });
    core.metadata.set(`${s.imageId}:generalSeriesModule`, { modality: 'CT' });
  });
});
describe('derived DICOM volume ownership and scaling', () => {
  it('publishes calibrated floats with correct per-plane positions and releases only derivatives', async () => {
    const handle = await create();
    expect(handle.resampled).toBe(true);
    const volume = core.volumes.get('synthetic-volume');
    expect([...volume.options.scalarData]).toEqual(Array(48).fill(60));
    expect(volume.isPreScaled).toBe(true);
    expect(core.add).toHaveBeenCalledWith(
      'synthetic-volume_slice_2',
      expect.objectContaining({
        type: 'imagePlaneModule',
        metadata: expect.objectContaining({ imagePositionPatient: [0, 0, 4] }),
      })
    );
    handle.release();
    handle.release();
    expect(core.volumes.size).toBe(0);
    expect([...core.images.keys()]).toEqual(geometry().map(s => s.imageId));
  });
  it.each(['missing', 'color', 'components', 'dimensions', 'lut', 'scaling', 'modality'])(
    'rejects incompatible decoded %s before publishing a volume',
    async reason => {
      const image = core.images.get('synthetic-1');
      if (reason === 'missing') core.images.delete('synthetic-1');
      if (reason === 'color') image.color = true;
      if (reason === 'components') image.numberOfComponents = 3;
      if (reason === 'dimensions') image.rows = 4;
      if (reason === 'lut') image.modalityLUT = {};
      if (reason === 'scaling')
        image.preScale = {
          scaled: true,
          scalingParameters: { rescaleSlope: 1, rescaleIntercept: 0 },
        };
      if (reason === 'modality')
        core.metadata.set('synthetic-1:generalSeriesModule', { modality: 'MR' });
      await expect(create()).rejects.toThrow(/remuestreo seguro/);
      expect(core.volumes.size).toBe(0);
    }
  );
  it('blocks unsupported padding/mappings and insufficient memory without evicting originals', async () => {
    await expect(create(false)).rejects.toThrow(/relleno/);
    core.available = 1;
    await expect(create()).rejects.toThrow(/memoria/);
    expect(core.removeImage).not.toHaveBeenCalled();
  });
  it('removes partial allocations on renderer failure', async () => {
    core.failCreate = true;
    await expect(create()).rejects.toThrow('synthetic allocation failure');
    expect([...core.images.keys()]).toEqual(geometry().map(s => s.imageId));
    expect(core.volumes.size).toBe(0);
  });
  it('does not publish an aborted reconstruction', async () => {
    const controller = new AbortController();
    const pending = create(true, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(core.volumes.size).toBe(0);
    expect(core.images.size).toBe(3);
  });
});
