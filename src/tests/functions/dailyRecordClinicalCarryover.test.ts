import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
  makeRecord,
} from './dailyRecordWriteAuthorityFunctions.test-support';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-05-13T16:00:00Z'));
});
afterEach(() => vi.useRealTimers());
const source = (): ReturnType<typeof makeRecord> => ({
  ...makeRecord(),
  date: '2026-05-12',
  beds: {
    R1: {
      ...makeRecord().beds.R1,
      admissionDate: '2026-05-12',
      devices: [],
      vitalSigns: { recordedDate: '2026-05-12', recordedAt: '2026-05-12 09:30', heartRate: 71 },
    },
  },
});
const request = () => ({
  ...makeRecord(),
  beds: {
    R1: {
      ...makeRecord().beds.R1,
      admissionDate: '2026-05-12',
      vitalSigns: { heartRate: 999 },
      clinicalCarryover: {
        sourceDate: '2026-05-12',
        clinicalEpisodeId: 'ep-uno',
        vitalsPending: false,
        devicesPending: false,
      },
    },
  },
});
const run = async (
  previousData = source(),
  remoteData?: ReturnType<typeof makeRecord>,
  now?: string
) => {
  if (now) vi.setSystemTime(new Date(now));
  const mock = createAdminMock({
    previousData,
    remoteData,
    policyData: { schemaVersion: 2, mode: 'preview', revision: 4, clinicalBatchMode: 'enforced' },
  });
  const api = createDailyRecordWriteAuthorityFunctions({
    firestore: mock.admin.firestore(),
    Timestamp: mock.admin.firestore.Timestamp,
    resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
  });
  await api.saveDailyRecordWithClinicalAuthority.run(
    { date: '2026-05-13', mode: 'shadow', record: request() },
    makeContext()
  );
  return mock;
};
describe('authoritative new-day clinical carryover', () => {
  it('reads the prior snapshot and derives the seed rather than accepting client measurements or verification', async () => {
    const { set, docRef, transaction } = await run();
    const saved = set.mock.calls.find(call => call[0] === docRef)![1];
    expect(saved.beds.R1.vitalSigns.heartRate).toBe(71);
    expect(saved.beds.R1.clinicalCarryover.vitalsPending).toBe(true);
    expect(transaction.get).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'previous-daily-record-doc' })
    );
    expect(set.mock.calls.every(([ref]) => ref.path !== 'previous-daily-record-doc')).toBe(true);
  });
  it('does not copy values from a prior bed containing a different patient', async () => {
    const previous = source();
    previous.beds.R1.rut = '22.222.222-2';
    const { set, docRef } = await run(previous);
    const saved = set.mock.calls.find(call => call[0] === docRef)![1];
    expect(saved.beds.R1.vitalSigns).toBeUndefined();
    expect(saved.beds.R1.clinicalCarryover).toBeUndefined();
  });
  it('does not backfill a historical day, even when creating it as an administrator', async () => {
    const { set, docRef } = await run(source(), undefined, '2026-05-14T16:00:00Z');
    expect(set.mock.calls.find(call => call[0] === docRef)![1].beds.R1.vitalSigns).toBeUndefined();
  });
  it('preserves the destination authority instead of re-copying into an existing day', async () => {
    const remote = {
      ...request(),
      beds: { R1: { ...request().beds.R1, vitalSigns: { heartRate: 88 } } },
    };
    const { set, docRef } = await run(source(), remote);
    expect(set.mock.calls.find(call => call[0] === docRef)![1].beds.R1.vitalSigns.heartRate).toBe(
      88
    );
  });
});
