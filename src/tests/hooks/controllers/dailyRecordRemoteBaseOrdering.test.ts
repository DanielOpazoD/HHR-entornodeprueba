import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  createDailyRecordReadResult,
  type DailyRecordQueryResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import {
  createSyncDailyRecordResult,
  type SyncDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import {
  createDailyRecordSubscription,
  createDailyRecordQueryOptions,
  getDailyRecordQueryKey,
  setAuthoritativeDailyRecordRead,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  applyPendingExplicitCensusPatch,
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';
import {
  getDailyRecordFreshnessStatus,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';

afterEach(() => {
  clearPendingDailyRecordPatchesForTests();
  resetDailyRecordFreshnessGateForTests();
});

describe.each(['query', 'null-recovery', 'null-recovery-error'] as const)(
  'remote census base with independent pending edits through %s',
  recovery => {
    it.each(['remote_authoritative', 'remote_applied', 'up_to_date'] as const)(
      'preserves the %s occupant across repeated local reads and an older remote snapshot',
      async consistencyState => {
        const date = '2026-10-27';
        const client = new QueryClient();
        const key = getDailyRecordQueryKey(date);
        const local = DataFactory.createMockDailyRecord(date, {
          lastUpdated: '2026-10-27T10:00:00.000Z',
        });
        local.beds.R1.clinicalEpisodeId = 'previous-episode';
        local.beds.R2.clinicalEpisodeId = 'independent-episode';
        const remote = structuredClone(local);
        remote.beds.R1.clinicalEpisodeId = 'current-episode';
        remote.beds.R2.pathology = 'Remote diagnosis';
        setDailyRecordQueryData(client, date, local);
        registerPendingDailyRecordPatch(date, {
          'beds.R2.pathology': 'Accepted pending diagnosis',
        });
        const reader = { getForDateWithMeta: vi.fn() };
        let publish!: (result: SyncDailyRecordResult, pending: boolean) => void;
        const stop = createDailyRecordSubscription(
          {
            ...reader,
            subscribeDetailed: (_date, callback) => {
              publish = callback;
              return () => {};
            },
          },
          date,
          client
        );
        try {
          if (consistencyState === 'remote_authoritative') {
            setAuthoritativeDailyRecordRead(client, date, remote);
          } else {
            publish(
              createSyncDailyRecordResult({
                date,
                record: remote,
                outcome: 'clean',
                consistencyState,
                serverConfirmed: true,
              }),
              false
            );
          }
          const read = () => client.getQueryData<DailyRecordQueryResult>(key)!;
          expect(read().record?.beds.R1.clinicalEpisodeId).toBe('current-episode');
          expect(read().record?.beds.R2.pathology).toBe('Accepted pending diagnosis');
          expect(read().runtime.sourceOfTruth).toBe('local');
          resetDailyRecordFreshnessGateForTests();
          markDailyRecordTabHidden(0);
          markDailyRecordTabVisible(6 * 60 * 1000);
          reader.getForDateWithMeta.mockResolvedValue(
            createDailyRecordReadResult(date, local, 'indexeddb')
          );
          const options = {
            ...createDailyRecordQueryOptions(reader, date, client),
            staleTime: 0,
          };
          for (let attempt = 0; attempt < 2; attempt += 1) {
            await client.fetchQuery(options);
            expect(read().record?.beds.R1.clinicalEpisodeId).toBe('current-episode');
            expect(read().record?.beds.R2.pathology).toBe('Accepted pending diagnosis');
            expect(read().runtime.serverConfirmed).toBe(false);
            expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
          }
          reader.getForDateWithMeta.mockResolvedValue(
            createDailyRecordReadResult(date, local, 'indexeddb', {
              consistencyState: 'unavailable',
              conflictSummary: { kind: 'remote_unavailable', sourceOfTruth: 'local' },
            })
          );
          if (recovery === 'query') await client.fetchQuery(options);
          else {
            if (recovery === 'null-recovery-error') {
              reader.getForDateWithMeta.mockRejectedValueOnce(new Error('Synthetic read failure'));
            }
            const previous = client.getQueryState(key);
            publish(createSyncDailyRecordResult({ date, record: null, outcome: 'missing' }), false);
            await vi.waitFor(() => expect(client.getQueryState(key)).not.toBe(previous));
          }
          if (recovery !== 'null-recovery-error') {
            expect(read().runtime.availabilityState).toBe('recoverable_local');
            expect(read().runtime.conflictSummary?.kind).toBe('remote_unavailable');
          }
          expect(read().record?.beds.R1.clinicalEpisodeId).toBe('current-episode');
          reader.getForDateWithMeta.mockResolvedValue(
            createDailyRecordReadResult(
              date,
              { ...local, lastUpdated: '2026-10-27T09:59:00.000Z' },
              'firestore',
              { serverConfirmed: true }
            )
          );
          await client.fetchQuery(options);
          expect(read().record?.beds.R1.clinicalEpisodeId).toBe('current-episode');
          expect(read().record?.beds.R2.pathology).toBe('Accepted pending diagnosis');
          expect(read().runtime.serverConfirmed).toBe(false);
          expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
          const newerLocal = { ...remote, lastUpdated: '2026-10-27T10:10:00.000Z' };
          reader.getForDateWithMeta.mockResolvedValue(
            createDailyRecordReadResult(date, newerLocal, 'indexeddb')
          );
          await client.fetchQuery(options);
          expect(read().record?.lastUpdated).toBe(newerLocal.lastUpdated);
          expect(read().runtime.serverConfirmed).toBe(false);

          const nextRemote = { ...remote, lastUpdated: '2026-10-27T10:05:00.000Z' };
          reader.getForDateWithMeta.mockResolvedValue(
            createDailyRecordReadResult(date, nextRemote, 'firestore', { serverConfirmed: true })
          );
          await client.fetchQuery(options);
          expect(read().record?.lastUpdated).toBe(nextRemote.lastUpdated);
          expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed');
          expect(applyPendingExplicitCensusPatch(date, nextRemote, local).beds.R2.pathology).toBe(
            'Accepted pending diagnosis'
          );
        } finally {
          stop?.();
          client.clear();
        }
      }
    );
  }
);
