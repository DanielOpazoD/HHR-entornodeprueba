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
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  applyPendingExplicitCensusPatch,
  clearPendingDailyRecordPatchesForTests,
  registerPendingDailyRecordPatch,
} from '@/hooks/controllers/dailyRecordPendingPatchController';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordEvent: vi.fn(), recordError: vi.fn() },
}));

const date = '2026-10-27';
const cleanups: Array<() => void> = [];
const setup = () => {
  const client = new QueryClient();
  const key = getDailyRecordQueryKey(date);
  const previous = DataFactory.createMockDailyRecord(date, {
    lastUpdated: '2026-10-27T10:00:00.000Z',
  });
  previous.beds.R1.clinicalEpisodeId = 'ep_synthetic_original';
  previous.beds.R1.pathology = 'Pending A';
  previous.beds.R2.clinicalEpisodeId = 'ep_synthetic_independent';
  previous.beds.R2.pathology = 'Pending C';
  const incoming = structuredClone(previous);
  incoming.lastUpdated = '2026-10-27T11:00:00.000Z';
  incoming.beds.R1.clinicalEpisodeId = 'ep_synthetic_replacement';
  incoming.beds.R1.pathology = '';
  incoming.beds.R2.pathology = '';
  setDailyRecordQueryData(client, date, previous);
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
  cleanups.push(() => {
    stop?.();
    client.clear();
  });
  return {
    client,
    key,
    previous,
    incoming,
    reader,
    publish,
    stop,
    read: () => client.getQueryData<DailyRecordQueryResult>(key)!,
  };
};

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  clearPendingDailyRecordPatchesForTests();
});

it('keeps blocked-sync details visible while retaining the pending episode reference', () => {
  const { incoming, publish, read } = setup();
  cleanups.push(registerPendingDailyRecordPatch(date, { 'beds.R1.pathology': 'Pending A' }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    publish(
      createSyncDailyRecordResult({
        date,
        record: incoming,
        outcome: 'blocked',
        consistencyState: 'blocked',
        serverConfirmed: false,
        retryability: 'manual_review',
        recoveryAction: 'block_and_surface',
        conflictSummary: { kind: 'local_persistence_failed', sourceOfTruth: 'local' },
        userSafeMessage: 'Fallo sintético de persistencia',
      }),
      false
    );
    expect(read().record?.beds.R1.clinicalEpisodeId).toBe('ep_synthetic_original');
    expect(read().record?.beds.R1.pathology).toBe('Pending A');
    expect(read().runtime).toMatchObject({
      serverConfirmed: false,
      consistencyState: 'blocked',
      retryability: 'manual_review',
      recoveryAction: 'block_and_surface',
      conflictSummary: { kind: 'local_persistence_failed' },
      userSafeMessage: 'Fallo sintético de persistencia',
    });
  }
});

it('ignores a confirmed replacement delivered after unsubscribing', () => {
  const { previous, incoming, publish, read, stop } = setup();
  cleanups.push(registerPendingDailyRecordPatch(date, { 'beds.R1.pathology': 'Pending A' }));
  const before = read();
  stop?.();
  publish(
    createSyncDailyRecordResult({
      date,
      record: incoming,
      outcome: 'clean',
      consistencyState: 'remote_applied',
      serverConfirmed: true,
    }),
    false
  );
  expect(read()).toBe(before);
  const raw = structuredClone(previous);
  raw.beds.R1.pathology = '';
  expect(applyPendingExplicitCensusPatch(date, raw, previous).beds.R1.pathology).toBe('Pending A');
});

describe.each(['subscription', 'query', 'null-recovery', 'unavailable'] as const)(
  'pending episode reference through %s',
  source => {
    it.each(['replacement', 'move'] as const)(
      'retains each pending edit through repeated unconfirmed %s results',
      async change => {
        const { client, previous, incoming, reader, publish, read } = setup();
        const release = registerPendingDailyRecordPatch(date, {
          'beds.R1.pathology': 'Pending A',
          'beds.R2.pathology': 'Pending C',
        });
        cleanups.push(release);
        if (change === 'move') {
          incoming.beds.R3 = { ...previous.beds.R1, bedId: 'R3', pathology: '' };
        }
        const candidate = createDailyRecordReadResult(date, incoming, 'indexeddb', {
          ...(source === 'unavailable'
            ? {
                consistencyState: 'unavailable',
                conflictSummary: { kind: 'remote_unavailable', sourceOfTruth: 'local' },
              }
            : {}),
        });
        const options = {
          ...createDailyRecordQueryOptions(reader, date, client),
          staleTime: 0,
        };
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (source === 'subscription') {
            publish(
              createSyncDailyRecordResult({
                date,
                record: incoming,
                outcome: 'clean',
                consistencyState: 'remote_applied',
                serverConfirmed: false,
              }),
              false
            );
          } else {
            const recovery = Promise.resolve(candidate);
            reader.getForDateWithMeta.mockReturnValueOnce(recovery);
            if (source === 'null-recovery') {
              publish(
                createSyncDailyRecordResult({ date, record: null, outcome: 'missing' }),
                false
              );
              await recovery;
            } else await client.fetchQuery(options);
          }
          expect(read().record?.beds.R1.clinicalEpisodeId).toBe('ep_synthetic_original');
          expect(read().record?.beds.R1.pathology).toBe('Pending A');
          expect(read().record?.beds.R2.pathology).toBe('Pending C');
          expect(read().runtime.serverConfirmed).toBe(false);
          if (source === 'unavailable') {
            expect(read().runtime.conflictSummary?.kind).toBe('remote_unavailable');
          }
        }
        const unchanged = structuredClone(previous);
        unchanged.beds.R1.pathology = '';
        unchanged.beds.R2.pathology = '';
        expect(applyPendingExplicitCensusPatch(date, unchanged, previous).beds.R1.pathology).toBe(
          'Pending A'
        );
        expect(applyPendingExplicitCensusPatch(date, unchanged, previous).beds.R2.pathology).toBe(
          'Pending C'
        );
        release();
        reader.getForDateWithMeta.mockResolvedValue(candidate);
        await client.fetchQuery(options);
        expect(read().record?.beds.R1.clinicalEpisodeId).toBe('ep_synthetic_replacement');
        expect(read().record?.beds.R1.pathology).toBe('');
      }
    );
  }
);

it.each(['none', 'another-date', 'another-bed'] as const)(
  'accepts a cached replacement when the relevant pending edit is %s',
  pending => {
    const { incoming, publish, read } = setup();
    if (pending !== 'none') {
      cleanups.push(
        registerPendingDailyRecordPatch(
          pending === 'another-date' ? '2026-10-26' : date,
          pending === 'another-bed'
            ? { 'beds.R2.pathology': 'Pending value' }
            : { 'beds.R1.pathology': 'Pending value' }
        )
      );
    }
    publish(
      createSyncDailyRecordResult({
        date,
        record: incoming,
        outcome: 'clean',
        consistencyState: 'remote_applied',
        serverConfirmed: false,
      }),
      false
    );
    expect(read().record?.beds.R1.clinicalEpisodeId).toBe('ep_synthetic_replacement');
    expect(read().record?.beds.R1.pathology).toBe('');
    if (pending === 'another-bed') expect(read().record?.beds.R2.pathology).toBe('Pending value');
    expect(read().runtime.serverConfirmed).toBe(false);
  }
);
