import { describe, expect, it, vi } from 'vitest';
import {
  createDailyRecordPitrReader,
  record,
  episode,
  Timestamp,
  NOW,
} from './dailyRecordRestore.test-support';
const setup = () => {
  const ref = { collection: vi.fn(() => 'episodes-query') };
  const get = vi.fn(async (target: unknown) =>
    target === ref ? { exists: true, data: record } : { docs: [{ id: 'episode-1', data: episode }] }
  );
  const runTransaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback({ get }));
  const readDatabase = vi.fn(async () => ({
    pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
    earliestVersionTime: '2026-11-01T12:00:00Z',
  }));
  const read = createDailyRecordPitrReader({
    firestore: { runTransaction },
    Timestamp,
    readDatabase,
  });
  return { ref, get, runTransaction, readDatabase, read };
};
describe('PITR reader port (readTime is not supported by the emulator)', () => {
  it('reads the day and its episodes at one exact read-only timestamp', async () => {
    const h = setup();
    const result = await h.read(h.ref, '2026-11-01T14:00:00.000Z');
    expect(result.record).toEqual(record());
    expect(result.docs[0].data.clinicalEpisodeId).toBe('episode-1');
    expect(h.runTransaction).toHaveBeenCalledWith(expect.any(Function), {
      readOnly: true,
      readTime: Timestamp.fromMillis(NOW - 2 * 3600000),
    });
    expect(h.get).toHaveBeenNthCalledWith(1, h.ref);
    expect(h.get).toHaveBeenNthCalledWith(2, 'episodes-query');
  });
  it('rejects a missing historical day rather than interpreting it as empty', async () => {
    const h = setup();
    h.get.mockResolvedValueOnce({ exists: false, data: record });
    await expect(h.read(h.ref, '2026-11-01T14:00:00Z')).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(h.get).toHaveBeenCalledTimes(1);
  });
  it.each(['2026-10-31T16:00:00Z', '2026-11-01T11:59:00Z'])(
    'rejects before the real PITR start %s',
    async readTime => {
      const h = setup();
      await expect(h.read(h.ref, readTime)).rejects.toMatchObject({ code: 'out-of-range' });
      expect(h.runTransaction).not.toHaveBeenCalled();
    }
  );
  it('fails closed if PITR is disabled', async () => {
    const h = setup();
    h.readDatabase.mockResolvedValue({
      pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_DISABLED',
      earliestVersionTime: '2026-11-01T12:00:00Z',
    });
    await expect(h.read(h.ref, '2026-11-01T14:00:00Z')).rejects.toMatchObject({
      code: 'out-of-range',
    });
  });
  it('does not mask a metadata or episode read failure', async () => {
    const h = setup();
    h.readDatabase.mockRejectedValueOnce(new Error('metadata read failed'));
    await expect(h.read(h.ref, '2026-11-01T14:00:00Z')).rejects.toThrow('metadata read failed');
    h.get.mockRejectedValueOnce(new Error('episode read failed'));
    await expect(h.read(h.ref, '2026-11-01T14:00:00Z')).rejects.toThrow('episode read failed');
  });
});
