import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DicomTicketExpiredError } from '@/services/radiology/dicomLoadState';
import { createDicomStudyPrefetch } from '@/services/radiology/dicomStudyPrefetch';
import { startDicomSeries } from '@/services/radiology/dicomSeriesLoader';
import type { DicomSeries, DicomStudy } from '@/services/radiology/dicomTypes';
import {
  syntheticDicom,
  syntheticSopUid,
  SYNTHETIC_PATIENT_ID,
  SYNTHETIC_SERIES_UID,
  SYNTHETIC_STUDY_UID,
} from '@/tests/fixtures/syntheticDicom';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), decode: vi.fn(), add: vi.fn() }));
vi.mock('@/services/radiology/mmradDicomService', () => ({ fetchDicomInstance: mocks.fetch }));
vi.mock('@cornerstonejs/core', () => ({
  imageLoader: { loadAndCacheImage: mocks.decode },
  cache: { getImageLoadObject: () => ({}), removeImageLoadObject: vi.fn() },
}));
vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    fileManager: { add: mocks.add, remove: vi.fn() },
    dataSetCacheManager: { unload: vi.fn() },
  },
}));

const COUNT = 8;
const FATAL = 'No se pudo obtener el corte. Vuelve a abrir el estudio.';
const withTickets = (prefix: string): DicomStudy => ({
  uid: SYNTHETIC_STUDY_UID,
  patientId: SYNTHETIC_PATIENT_ID,
  date: '',
  series: [
    {
      uid: SYNTHETIC_SERIES_UID,
      number: 1,
      description: 'Synthetic',
      modality: 'CT',
      rows: 64,
      columns: 64,
      instances: Array.from({ length: COUNT }, (_, i) => ({
        uid: syntheticSopUid(i),
        number: i + 1,
        frames: 1,
        ticket: `${prefix}-${i}`,
      })),
    },
  ],
});
const study = withTickets('old');
const series: DicomSeries = study.series[0];
const renewed = withTickets('new');
const index = (ticket: string) => Number(ticket.split('-')[1]);
const usedTickets = () => mocks.fetch.mock.calls.map(call => String(call[0]));

/** Originals answer until `served` old tickets were used; then every old ticket is expired. */
const serve = (served: number, renewedPatient = SYNTHETIC_PATIENT_ID) => {
  let used = 0;
  mocks.fetch.mockImplementation(async (ticket: string) => {
    await Promise.resolve();
    if (ticket.startsWith('new-')) return syntheticDicom(index(ticket), COUNT, renewedPatient);
    if (used++ >= served) throw new DicomTicketExpiredError();
    return syntheticDicom(index(ticket), COUNT);
  });
};
const start = (prefetch: ReturnType<typeof createDicomStudyPrefetch>) =>
  startDicomSeries(study, series, new AbortController().signal, vi.fn(), prefetch.fetch);
const open = (reopen: (signal: AbortSignal) => Promise<DicomStudy>) => {
  const prefetch = createDicomStudyPrefetch(study, undefined, undefined, reopen);
  prefetch.select(series.uid);
  return { prefetch, source: start(prefetch) };
};
/** Loading the series again in the same open study, as switching back to it does. */
const reload = async (prefetch: ReturnType<typeof createDicomStudyPrefetch>) => {
  const again = start(prefetch);
  await expect(again.completion).rejects.toThrow(FATAL);
  await again.settled;
};

describe('silent renewal of expired DICOM access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let id = 0;
    mocks.add.mockImplementation(() => `dicomfile:${id++}`);
    mocks.decode.mockResolvedValue({});
  });

  it('reopens the study once when tickets expire mid-series and completes it', async () => {
    serve(3);
    const reopen = vi.fn(async () => renewed);
    const { prefetch, source } = open(reopen);
    const loaded = await source.completion;
    expect(loaded.imageIds.filter(Boolean)).toHaveLength(COUNT);
    expect(reopen).toHaveBeenCalledTimes(1);
    expect(usedTickets().filter(ticket => ticket.startsWith('new-')).length).toBeGreaterThan(0);
    loaded.release();
    prefetch.dispose();
  });

  it('shares one metadata request among concurrent expiries', async () => {
    serve(0);
    let resolve!: (value: DicomStudy) => void;
    const reopen = vi.fn(() => new Promise<DicomStudy>(done => (resolve = done)));
    const { prefetch, source } = open(reopen);
    await vi.waitFor(() => expect(mocks.fetch.mock.calls.length).toBeGreaterThanOrEqual(4));
    await Promise.resolve();
    expect(reopen).toHaveBeenCalledTimes(1);
    resolve(renewed);
    const loaded = await source.completion;
    expect(loaded.imageIds.filter(Boolean)).toHaveLength(COUNT);
    expect(reopen).toHaveBeenCalledTimes(1);
    loaded.release();
    prefetch.dispose();
  });

  it.each([
    ['the renewal fails', () => Promise.reject(new Error('No se pudo conectar con MMRAD.'))],
    ['it returns another study', async () => ({ ...renewed, uid: '1.2.826.0.1.3680043.10.543.9' })],
    ['it returns another patient', async () => ({ ...renewed, patientId: '222222222' })],
    [
      'a known original is missing',
      async () => ({
        ...renewed,
        series: [{ ...renewed.series[0], instances: renewed.series[0].instances.slice(1) }],
      }),
    ],
  ])('keeps the existing fatal error when %s', async (_case, reopen) => {
    serve(2);
    const spy = vi.fn(reopen);
    const { prefetch, source } = open(spy);
    await expect(source.completion).rejects.toThrow(FATAL);
    await source.settled;
    expect(spy).toHaveBeenCalledTimes(1);
    expect(usedTickets().some(ticket => ticket.startsWith('new-'))).toBe(false);
    await reload(prefetch);
    expect(spy).toHaveBeenCalledTimes(1);
    prefetch.dispose();
  });

  it('never renews again when the renewed tickets also read as expired', async () => {
    mocks.fetch.mockImplementation(async (ticket: string) => {
      await Promise.resolve();
      if (ticket === 'old-4') return syntheticDicom(4, COUNT);
      throw new DicomTicketExpiredError();
    });
    const reopen = vi.fn(async () => renewed);
    const { prefetch, source } = open(reopen);
    await expect(source.completion).rejects.toThrow(FATAL);
    await source.settled;
    expect(reopen).toHaveBeenCalledTimes(1);
    await reload(prefetch);
    expect(reopen).toHaveBeenCalledTimes(1);
    prefetch.dispose();
  });

  it('still verifies the patient of every original fetched with a renewed ticket', async () => {
    serve(2, '222222222');
    const { prefetch, source } = open(async () => renewed);
    await expect(source.completion).rejects.toThrow('no corresponde');
    await source.settled;
    prefetch.dispose();
  });
});
