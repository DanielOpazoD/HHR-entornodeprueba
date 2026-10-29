import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveDailyRecordPersistenceGoldenPath } from '@/services/repositories/dailyRecordPersistenceGoldenPath';

const buildRecord = (date: string, lastUpdated: string) =>
  DataFactory.createMockDailyRecord(date, { beds: {}, lastUpdated });

describe('daily record audit history metadata boundaries', () => {
  it('keeps the remote reference and absent audit field when no audit merge is needed', () => {
    const local = buildRecord('2026-03-18', '2026-03-18T08:00:00.000Z');
    const remote = buildRecord('2026-03-18', '2026-03-18T12:00:00.000Z');
    const result = resolveDailyRecordPersistenceGoldenPath({
      localRecord: local,
      remoteRecord: remote,
      remoteAvailability: 'resolved',
    });
    expect(result.selectedRecord).toBe(remote);
    expect(result.selectedRecord?.rayenSyncHistory).toBeUndefined();
    expect(result.sourceOfTruth).toBe('remote');
    expect(result.consistencyState).toBe('remote_authoritative');
  });

  it.each(['not_requested', 'missing', 'unavailable'] as const)(
    'does not use audit data from an unresolved remote (%s)',
    remoteAvailability => {
      const local = buildRecord('2026-03-18', '2026-03-18T08:00:00.000Z');
      const result = resolveDailyRecordPersistenceGoldenPath({
        localRecord: local,
        remoteRecord: null,
        remoteAvailability,
        remoteHistorySource: {
          lastUpdated: '2026-03-18T12:00:00.000Z',
          rayenSyncHistory: [
            {
              id: 'unresolved-run',
              sourceDate: local.date,
              startedAt: local.lastUpdated,
              status: 'complete',
              by: 'SYNTHETIC',
            },
          ],
        },
      });
      expect(result.selectedRecord).toBe(local);
      expect(result.selectedRecord?.rayenSyncHistory).toBeUndefined();
      expect(result.shouldHydrateLocal).toBe(false);
    }
  );

  it.each([
    { localTime: '2026-03-18T08:00:00.000Z', remoteTime: 'invalid', expectedStatus: 'complete' },
    { localTime: 'invalid', remoteTime: '', expectedStatus: 'partial' },
  ])(
    'uses the existing zero fallback for audit clocks ($localTime / $remoteTime)',
    ({ localTime, remoteTime, expectedStatus }) => {
      const local = buildRecord('2026-03-18', localTime);
      local.rayenSyncHistory = [
        {
          id: 'clock-run',
          sourceDate: local.date,
          startedAt: '2026-03-18T08:00:00.000Z',
          by: 'SYNTHETIC',
          status: 'complete',
        },
      ];
      const remote = buildRecord(local.date, remoteTime);
      remote.rayenSyncHistory = [{ ...local.rayenSyncHistory[0], status: 'partial' }];
      const result = resolveDailyRecordPersistenceGoldenPath({
        localRecord: local,
        remoteRecord: remote,
        remoteAvailability: 'resolved',
      });
      expect(result.selectedRecord?.rayenSyncHistory?.[0].status).toBe(expectedStatus);
    }
  );
});
