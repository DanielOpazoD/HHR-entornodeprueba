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

  it('requires HU calibration across every volume source but ignores excluded localizers', async () => {
    mocks.decode.mockResolvedValue({
      preScale: { scaled: true, scalingParameters: { rescaleSlope: 1, rescaleIntercept: 0 } },
    });
    const valid = await load();
    expect(valid.huCalibrated).toBe(true);
    valid.release();
    const originalFetch = mocks.fetch.getMockImplementation()!;
    mocks.fetch.mockImplementation((ticket: string) =>
      ticket === '3'
        ? Promise.resolve(
            syntheticDicom(3, 5, undefined, undefined, undefined, undefined, undefined, {
              unit: 'US',
            })
          )
        : originalFetch(ticket)
    );
    const invalid = await load();
    expect(invalid.huCalibrated).toBe(false);
    invalid.release();
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
    expect(mocks.decode.mock.calls.length).toBeLessThanOrEqual(mocks.add.mock.calls.length);
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(mocks.add.mock.calls.length));
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

describe('progressive verified download queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let id = 0;
    mocks.add.mockImplementation(() => `dicomfile:${id++}`);
    mocks.decode.mockResolvedValue({});
  });

  it('renders a verified cut before completion and prioritizes the requested cut next', async () => {
    const { startDicomSeries } = await import('@/services/radiology/dicomSeriesLoader');
    const extended = {
      ...series,
      instances: Array.from({ length: 12 }, (_, i) => ({
        uid: syntheticSopUid(i),
        number: i + 1,
        frames: 1,
        ticket: String(i),
      })),
    };
    const waiting = new Map<string, (bytes: Uint8Array) => void>();
    mocks.fetch.mockImplementation(
      (ticket: string, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          waiting.set(ticket, resolve);
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        })
    );
    const source = startDicomSeries(study, extended, new AbortController().signal, vi.fn());
    let complete = false;
    void source.completion
      .then(() => {
        complete = true;
      })
      .catch(() => undefined);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(4));
    expect(mocks.fetch.mock.calls[0][0]).toBe('6');
    const first = source.request(6);
    const selected = source.request(11);
    waiting.get('6')!(syntheticDicom(6, 12));
    await expect(first).resolves.toMatch(/^dicomfile:/);
    await vi.waitFor(() => expect(waiting.has('11')).toBe(true));
    expect(complete).toBe(false);
    waiting.get('11')!(syntheticDicom(11, 12));
    await expect(selected).resolves.toMatch(/^dicomfile:/);
    source.cancel();
    await expect(source.completion).rejects.toMatchObject({ name: 'AbortError' });
    await source.settled;
    expect(mocks.remove).toHaveBeenCalledTimes(mocks.add.mock.calls.length);
  });

  it('rejects a late foreign image without publishing it and releases earlier valid images', async () => {
    const { startDicomSeries } = await import('@/services/radiology/dicomSeriesLoader');
    let foreign!: (bytes: Uint8Array) => void;
    mocks.fetch.mockImplementation((ticket: string) =>
      ticket === '0'
        ? new Promise(resolve => {
            foreign = resolve;
          })
        : Promise.resolve(syntheticDicom(Number(ticket), 5))
    );
    const source = startDicomSeries(study, series, new AbortController().signal, vi.fn());
    await expect(source.request(2)).resolves.toMatch(/^dicomfile:/);
    const bad = source.request(0);
    foreign(syntheticDicom(0, 5, '999999999'));
    await expect(bad).rejects.toThrow('no corresponde al paciente o al estudio');
    await expect(source.completion).rejects.toThrow('no corresponde al paciente o al estudio');
    expect(mocks.add.mock.calls.length).toBeLessThan(5);
    await source.settled;
    expect(mocks.remove).toHaveBeenCalledTimes(mocks.add.mock.calls.length);
  });

  it('invalidates the session immediately while another decode is still pending', async () => {
    const { startDicomSeries } = await import('@/services/radiology/dicomSeriesLoader');
    let foreign!: (bytes: Uint8Array) => void;
    let finish!: () => void;
    mocks.fetch.mockImplementation((ticket: string) =>
      ticket === '0'
        ? new Promise(resolve => {
            foreign = resolve;
          })
        : Promise.resolve(syntheticDicom(Number(ticket), 5))
    );
    mocks.decode.mockReturnValue(
      new Promise<void>(resolve => {
        finish = resolve;
      })
    );
    const source = startDicomSeries(study, series, new AbortController().signal, vi.fn());
    await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalledTimes(2));
    foreign(syntheticDicom(0, 5, '999999999'));
    await expect(source.completion).rejects.toThrow('no corresponde al paciente o al estudio');
    expect(mocks.remove).not.toHaveBeenCalled();
    finish();
    await source.settled;
    expect(mocks.remove).toHaveBeenCalledTimes(mocks.add.mock.calls.length);
  });

  it('releases images that finish decoding after cancellation without reporting them ready', async () => {
    const { startDicomSeries } = await import('@/services/radiology/dicomSeriesLoader');
    mocks.fetch.mockImplementation((ticket: string) =>
      Promise.resolve(syntheticDicom(Number(ticket), 5))
    );
    let finish!: () => void;
    const decoding = new Promise<void>(resolve => {
      finish = resolve;
    });
    mocks.decode.mockReturnValue(decoding);
    const progress = vi.fn();
    const source = startDicomSeries(study, series, new AbortController().signal, progress);
    await vi.waitFor(() => expect(mocks.decode).toHaveBeenCalledTimes(2));
    source.cancel();
    finish();
    await expect(source.completion).rejects.toMatchObject({ name: 'AbortError' });
    await source.settled;
    expect(progress).not.toHaveBeenCalled();
    expect(mocks.remove).toHaveBeenCalledTimes(mocks.add.mock.calls.length);
  });
});
