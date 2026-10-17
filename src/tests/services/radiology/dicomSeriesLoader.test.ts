import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planDicomVolume } from '@/domain/radiology/dicomGeometry';
import { loadDicomSeries } from '@/services/radiology/dicomSeriesLoader';
import type { DicomSeries, DicomStudy } from '@/services/radiology/dicomTypes';
import {
  syntheticDicom,
  syntheticSopUid,
  SYNTHETIC_PATIENT_ID,
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
} from '@/tests/fixtures/syntheticDicom';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  decode: vi.fn(),
  add: vi.fn(),
  remove: vi.fn(),
  unload: vi.fn(),
}));
vi.mock('@/services/radiology/mmradDicomService', () => ({ fetchDicomInstance: mocks.fetch }));
vi.mock('@cornerstonejs/core', () => ({
  imageLoader: { loadAndCacheImage: mocks.decode },
  cache: { getImageLoadObject: () => ({}), removeImageLoadObject: mocks.remove },
}));
vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    fileManager: { add: mocks.add, remove: vi.fn() },
    dataSetCacheManager: { unload: mocks.unload },
  },
}));

const series: DicomSeries = {
  uid: SYNTHETIC_SERIES_UID,
  number: 1,
  description: 'Synthetic',
  modality: 'CT',
  rows: 64,
  columns: 64,
  instances: Array.from({ length: 5 }, (_, i) => ({
    uid: syntheticSopUid(i),
    number: i + 1,
    frames: 1,
    ticket: String(i),
  })),
};
const study: DicomStudy = {
  uid: SYNTHETIC_STUDY_UID,
  patientId: SYNTHETIC_PATIENT_ID,
  date: '',
  series: [series],
};
const localizerPlane = {
  imageType: 'ORIGINAL\\PRIMARY\\LOCALIZER',
  orientation: [1, 0, 0, 0, 0, 1],
};
const localizerMatrix = {
  rows: 32,
  columns: 16,
  spacing: [2, 4] as [number, number],
  position: [0, 0] as [number, number],
  padding: true,
};
const load = () => loadDicomSeries(study, series, new AbortController().signal, vi.fn());
const install = (plane = localizerPlane, localizerIndex = 0, patient = SYNTHETIC_PATIENT_ID) => {
  mocks.fetch.mockImplementation(async (ticket: string) => {
    const i = Number(ticket),
      localizer = i === localizerIndex;
    return syntheticDicom(
      i,
      5,
      localizer ? patient : SYNTHETIC_PATIENT_ID,
      undefined,
      undefined,
      localizer ? localizerMatrix : undefined,
      localizer ? plane : undefined
    );
  });
};

describe('verified DICOM source selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let id = 0;
    mocks.add.mockImplementation(() => `dicomfile:${id++}`);
    mocks.decode.mockResolvedValue({});
    install();
  });

  it('retains every original but reconstructs only non-localizer CT slices', async () => {
    const loaded = await load();
    expect(loaded.imageIds).toHaveLength(5);
    expect(loaded.geometry).toHaveLength(5);
    expect(mocks.decode).toHaveBeenCalledTimes(5);
    expect(loaded.volumeGeometry).toEqual(loaded.geometry.slice(1));
    expect(planDicomVolume(loaded.volumeGeometry).dimensions[2]).toBe(4);
    expect(loaded.resamplingSupported).toBe(true); // Padding belongs only to the localizer.
    loaded.release();
    expect(mocks.remove.mock.calls.map(([id]) => id)).toEqual(loaded.imageIds);
    expect(mocks.unload).toHaveBeenCalledTimes(5);
  });

  it.each([
    { ...localizerPlane, imageType: 'ORIGINAL\\PRIMARY\\SCOUT' },
    { ...localizerPlane, imageType: 'LOCALIZER\\PRIMARY\\AXIAL' },
    { ...localizerPlane, imageType: 'ORIGINAL\\PRIMARY\\LOCALIZER_EXTRA' },
    { ...localizerPlane, imageType: '' },
    { ...localizerPlane, modality: 'MR' },
    { ...localizerPlane, sopClass: '1.2.840.10008.5.1.4.1.1.2.1' },
  ])(
    'never guesses an exclusion from orientation, size or a nonstandard marker: %j',
    async plane => {
      install(plane);
      const loaded = await load();
      expect(loaded.volumeGeometry).toEqual(loaded.geometry);
      expect(() => planDicomVolume(loaded.volumeGeometry)).toThrow('orientaciones');
    }
  );

  it('verifies the identity of a localizer before excluding or decoding it', async () => {
    install(localizerPlane, 0, '999999999');
    await expect(load()).rejects.toThrow('no corresponde al paciente o al estudio');
    expect(mocks.add.mock.calls.length).toBeLessThan(5);
    expect(mocks.decode).toHaveBeenCalledTimes(mocks.add.mock.calls.length);
    expect(mocks.remove).toHaveBeenCalledTimes(mocks.add.mock.calls.length);
  });

  it('still rejects resampling when padding belongs to a retained volume source', async () => {
    mocks.fetch.mockImplementation(async (ticket: string) => {
      const i = Number(ticket);
      return syntheticDicom(
        i,
        5,
        SYNTHETIC_PATIENT_ID,
        undefined,
        undefined,
        localizerMatrix,
        i === 0 ? localizerPlane : undefined
      );
    });
    const loaded = await load();
    expect(loaded.volumeGeometry).toHaveLength(4);
    expect(loaded.resamplingSupported).toBe(false);
  });

  it('does not conceal a missing volumetric slice after removing a localizer', async () => {
    install(localizerPlane, 2);
    const loaded = await load();
    expect(() => planDicomVolume(loaded.volumeGeometry)).toThrow('espaciado uniforme');
  });

  it('keeps a localizer-only series available in Original without manufacturing a volume', async () => {
    mocks.fetch.mockImplementation(async (ticket: string) =>
      syntheticDicom(
        Number(ticket),
        5,
        SYNTHETIC_PATIENT_ID,
        undefined,
        undefined,
        localizerMatrix,
        localizerPlane
      )
    );
    const loaded = await load();
    expect(loaded.imageIds).toHaveLength(5);
    expect(loaded.volumeGeometry).toHaveLength(0);
    expect(() => planDicomVolume(loaded.volumeGeometry)).toThrow('al menos tres cortes');
  });
});
