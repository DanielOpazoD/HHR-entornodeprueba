import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAdmissionAuditCensus } from '@/services/admin/admissionAuditCensus';

const read = vi.hoisted(() => vi.fn());
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordsRangeFromFirestore: (...args: unknown[]) => read(...args),
}));
beforeEach(() => {
  read.mockReset().mockResolvedValue([]);
});
describe('server-confirmed admission census', () => {
  it('reads month batches and adjacent census days using the server requirement', async () => {
    for await (const _records of readAdmissionAuditCensus(
      '2026-01-31',
      '2026-02-01',
      new AbortController().signal
    )) {
      /* consume */
    }
    expect(read.mock.calls).toEqual([
      ['2026-01-30', '2026-01-31', { requireServer: true }],
      ['2026-02-01', '2026-02-02', { requireServer: true }],
    ]);
  });
  it('propagates a source failure instead of returning a false empty population', async () => {
    read.mockRejectedValue(new Error('Fallo sintético'));
    const next = readAdmissionAuditCensus(
      '2026-07-13',
      '2026-07-13',
      new AbortController().signal
    ).next();
    await expect(next).rejects.toThrow('Fallo sintético');
  });
  it('stops between monthly reads after cancellation', async () => {
    const controller = new AbortController();
    const stream = readAdmissionAuditCensus('2026-01-31', '2026-02-01', controller.signal);
    await stream.next();
    controller.abort();
    await expect(stream.next()).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
