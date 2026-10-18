import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDicomSeries } from '@/services/radiology/dicomSeriesLoader';
import { DicomTransferError } from '@/services/radiology/dicomLoadState';
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
}));
vi.mock('@/services/radiology/mmradDicomService', () => ({ fetchDicomInstance: mocks.fetch }));
vi.mock('@cornerstonejs/core', () => ({
  imageLoader: { loadAndCacheImage: mocks.decode },
  cache: { getImageLoadObject: () => ({}), removeImageLoadObject: mocks.remove },
}));
vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  wadouri: {
    fileManager: { add: mocks.add, remove: vi.fn() },
    dataSetCacheManager: { unload: vi.fn() },
  },
}));
const series = {
  uid: SYNTHETIC_SERIES_UID,
  number: 1,
  description: 'Synthetic',
  modality: 'CT',
  rows: 64,
  columns: 64,
  instances: Array.from({ length: 24 }, (_, i) => ({
    uid: syntheticSopUid(i),
    number: i + 1,
    frames: 1,
    ticket: String(i),
  })),
};
const study = {
  uid: SYNTHETIC_STUDY_UID,
  patientId: SYNTHETIC_PATIENT_ID,
  date: '',
  series: [series],
};
const sessions: ReturnType<typeof startDicomSeries>[] = [];
const start = (signal = new AbortController().signal) => {
  const source = startDicomSeries(study, series, signal, vi.fn());
  sessions.push(source);
  return source;
};
beforeEach(() => {
  vi.clearAllMocks();
  let id = 0;
  mocks.add.mockImplementation(() => `dicomfile:${id++}`);
  mocks.fetch.mockImplementation(async (ticket: string) => syntheticDicom(Number(ticket), 24));
  mocks.decode.mockResolvedValue({});
});
afterEach(async () => {
  sessions.splice(0).forEach(s => s.cancel());
  vi.useRealTimers();
});
describe('adaptive verified loading', () => {
  it('counts transferred bytes independently from cached originals', async () => {
    mocks.fetch.mockImplementation(async (ticket, _signal, timing) => {
      const bytes = syntheticDicom(Number(ticket), 24);
      if (Number(ticket) % 2 === 0) timing({ transfer: 1 }, bytes.byteLength);
      return bytes;
    });
    const source = start();
    await source.completion;
    let network = 0,
      raw = 0;
    const unsubscribe = source.loading.subscribe(state => {
      network = state.networkBytes ?? 0;
      raw = state.rawBytes;
    });
    expect(network).toBeGreaterThan(0);
    expect(network).toBeLessThan(raw);
    unsubscribe();
  });
  it('continues bounded downloads while two decoders are occupied, prioritizes the next decode and deduplicates demand', async () => {
    let finish!: () => void;
    mocks.decode.mockReturnValue(
      new Promise<object>(resolve => {
        finish = () => resolve({});
      })
    );
    const source = start();
    await vi.waitFor(() => expect(mocks.fetch.mock.calls.length).toBeGreaterThan(4));
    expect(mocks.decode).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls.length).toBeLessThanOrEqual(10);
    const requested = source.request(23);
    expect(source.request(23)).toBe(requested);
    await vi.waitFor(() =>
      expect(mocks.fetch.mock.calls.some(([ticket]) => ticket === '23')).toBe(true)
    );
    const count = mocks.fetch.mock.calls.filter(([ticket]) => ticket === '23').length;
    expect(count).toBe(1);
    finish();
    await requested;
    await source.completion;
    expect(source.loading.snapshot().available).toEqual([[0, 23]]);
    expect(mocks.fetch).toHaveBeenCalledTimes(24);
  });
  it('backs off globally on transient failures, preserves verified cuts and retries only exhausted cuts', async () => {
    vi.useFakeTimers();
    let fail = true;
    mocks.fetch.mockImplementation(async (ticket: string) => {
      if (ticket === '0' && fail) throw new DicomTransferError(true, 1000);
      return syntheticDicom(Number(ticket), 24);
    });
    const source = start();
    source.loading.setLimit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(source.loading.snapshot().ready).toBeGreaterThan(0);
    const before = mocks.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.fetch.mock.calls.length).toBe(before);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(source.loading.snapshot().failed).toEqual([0]);
    expect(mocks.fetch.mock.calls.filter(([ticket]) => ticket === '0')).toHaveLength(3);
    expect(source.loading.snapshot().ready).toBe(23);
    fail = false;
    const calls = mocks.fetch.mock.calls.length;
    source.loading.retryFailed();
    await vi.advanceTimersByTimeAsync(5000);
    await source.completion;
    expect(mocks.fetch.mock.calls.length).toBe(calls + 1);
    expect(source.loading.snapshot().ready).toBe(24);
  });
  it('reports every paired decode completion once, including the final total', async () => {
    const progress = vi.fn();
    const source = startDicomSeries(study, series, new AbortController().signal, progress);
    sessions.push(source);
    await source.completion;
    expect(progress.mock.calls.map(([ready]) => ready)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1)
    );
    expect(progress).toHaveBeenLastCalledWith(24, 24);
  });

  it('rejects every consumer with a sanitized decoder error, never a dataset wrapper', async () => {
    const wrapper = {
      error: new Error('Synthetic decode failure'),
      dataSet: { private: 'synthetic-payload' },
    };
    mocks.decode.mockRejectedValue(wrapper);
    const source = start();
    const cut = source.request(12);
    const error = await cut.catch(value => value);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBe(wrapper);
    expect(error).not.toHaveProperty('dataSet');
    expect(error).not.toHaveProperty('error');
    await expect(source.completion).rejects.toThrow('No se pudo preparar');
    await source.settled;
    expect(mocks.remove).toHaveBeenCalledTimes(mocks.add.mock.calls.length);
  });

  it('does not retry permanent failures and rejects an already cancelled session', async () => {
    mocks.fetch.mockRejectedValue(new DicomTransferError(false));
    const source = start();
    await expect(source.completion).rejects.toThrow('No se pudo obtener');
    await source.settled;
    expect(source.loading.snapshot().retries).toBe(0);
    const controller = new AbortController();
    controller.abort();
    mocks.fetch.mockClear();
    const cancelled = start(controller.signal);
    await expect(cancelled.completion).rejects.toMatchObject({ name: 'AbortError' });
    await cancelled.settled;
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it('aborts retry timers without new requests and releases every verified buffer', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockRejectedValue(new DicomTransferError(true, 5000));
    const source = start();
    await vi.advanceTimersByTimeAsync(0);
    source.cancel();
    const count = mocks.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    await source.settled;
    expect(mocks.fetch).toHaveBeenCalledTimes(count);
  });
});
