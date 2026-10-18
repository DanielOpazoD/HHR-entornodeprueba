import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDicomStudyPrefetch } from '@/services/radiology/dicomStudyPrefetch';
import {
  syntheticDicom,
  syntheticSopUid,
  SYNTHETIC_PATIENT_ID,
  SYNTHETIC_STUDY_UID,
} from '@/tests/fixtures/syntheticDicom';
const fetchMock = vi.hoisted(() => vi.fn());
vi.mock('@/services/radiology/mmradDicomService', () => ({ fetchDicomInstance: fetchMock }));
const study = {
  uid: SYNTHETIC_STUDY_UID,
  patientId: SYNTHETIC_PATIENT_ID,
  date: '',
  series: [1, 2, 3].map(n => ({
    uid: `1.2.3.${n}`,
    number: n,
    description: '',
    modality: 'CT',
    rows: 64,
    columns: 64,
    instances: [0, 1].map(i => ({
      uid: syntheticSopUid(i),
      number: i,
      frames: 1,
      ticket: `${n}:${i}`,
    })),
  })),
};
const bytes = (ticket: string, patient = SYNTHETIC_PATIENT_ID) => {
  const [series, index] = ticket.split(':').map(Number);
  return syntheticDicom(index, 2, patient, undefined, undefined, undefined, {
    seriesUid: `1.2.3.${series}`,
  });
};
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (ticket, _signal, _timing, limit) => {
    const value = bytes(ticket);
    if (limit !== undefined && value.byteLength > limit) throw new Error('budget');
    return value;
  });
});
describe('study-scoped original prefetch', () => {
  it('starts only after completion, downloads subsequent series in order and consumes cache without another request', async () => {
    const session = createDicomStudyPrefetch(study);
    session.select(study.series[0].uid);
    expect(fetchMock).not.toHaveBeenCalled();
    session.complete(study.series[0].uid);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['2:0', '2:1', '3:0', '3:1']);
    session.select(study.series[1].uid);
    const timing = vi.fn();
    expect(await session.fetch('2:0', new AbortController().signal, timing)).toEqual(bytes('2:0'));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(timing).not.toHaveBeenCalled();
    session.dispose();
  });
  it('stops at the memory budget without downloading the rest', async () => {
    const session = createDicomStudyPrefetch(study, 2 * bytes('2:0').byteLength);
    session.select(study.series[0].uid);
    session.complete(study.series[0].uid);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    session.select(study.series[1].uid);
    await session.fetch('2:0', new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it('never caches a mismatched patient and stops background work', async () => {
    fetchMock.mockImplementation(async ticket => bytes(ticket, '999999999'));
    const session = createDicomStudyPrefetch(study);
    session.select(study.series[0].uid);
    session.complete(study.series[0].uid);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    session.select(study.series[1].uid);
    fetchMock.mockImplementation(async ticket => bytes(ticket));
    await session.fetch('2:0', new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it('aborts and drains background work on selection and drops cache on close', async () => {
    let aborted = false;
    fetchMock.mockImplementationOnce(
      (_ticket, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(signal.reason);
          })
        )
    );
    const session = createDicomStudyPrefetch(study);
    session.select(study.series[0].uid);
    session.complete(study.series[0].uid);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    session.select(study.series[1].uid);
    await session.fetch('2:0', new AbortController().signal);
    expect(aborted).toBe(true);
    session.dispose();
    session.complete(study.series[1].uid);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
