import { afterEach, expect, it, vi } from 'vitest';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { errorService } from '@/services/utils/errorService';
import { dispatchOperationalTelemetryExternally } from '@/services/observability/operationalTelemetryExternalAdapter';
import { buildRecentUserHealthEvents } from '@/hooks/controllers/systemHealthReporterController';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { CreateSyncQueueEngineOptions } from '@/services/storage/sync/syncQueueEngineContracts';
vi.mock('@/services/storage/indexeddb/indexedDbErrorLogService', () => ({ saveErrorLog: vi.fn() }));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
const patient = (id: string) => ({
  patientName: `Paciente ${id}`,
  clinicalEpisodeId: id,
  rut: 'PAS-123',
  documentType: 'Pasaporte',
});
const task = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  id: 1,
  opId: 'synthetic',
  type: 'UPDATE_DAILY_RECORD',
  key: '2026-11-10',
  payload: { beds: { R1: patient('synthetic-A'), R2: patient('synthetic-C') } },
  timestamp: 1,
  status: 'PROCESSING',
  retryCount: 0,
  leaseOwner: 'worker',
  leaseUntil: Date.now() + 30000,
  attemptId: 'attempt',
  syncContract: { changedPaths: ['beds.R1.pathology'], clinicalEpisodeKeys: ['synthetic-A'] },
  ...overrides,
});
const fail = async (captured: SyncTask) => {
  let first = true;
  const current = { beds: { R1: patient('synthetic-B') } };
  const readCurrent = vi.fn(async () => current);
  const options = {
    store: {
      claimReadyPending: async () => (first ? ((first = false), [captured]) : []),
      updateClaimed: async () => true,
      getDailyRecord: readCurrent,
    },
    runtime: { isOnline: () => true, onOnline: () => {}, getOwnerKey: () => null },
    transport: {
      run: async () => {
        throw Object.assign(new Error('synthetic denied'), { code: 'permission-denied' });
      },
    },
    batchSize: 25,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  };
  await createSyncQueueEngine(options as unknown as CreateSyncQueueEngineOptions).processQueue();
  const log = errorService
    .getAllErrors()
    .find(entry => entry.message === 'Sync task permanently failed');
  expect(log).toBeDefined();
  expect(readCurrent).not.toHaveBeenCalled();
  return log!;
};
afterEach(() => {
  errorService.clearErrors();
  vi.unstubAllGlobals();
});
it('names captured episode A despite current bed occupant B', async () => {
  const log = await fail(task());
  expect(log.context).toMatchObject({ localSyncFailure: [{ clinicalEpisodeId: 'synthetic-A' }] });
  expect(JSON.stringify(log.context)).toContain('Paciente synthetic-A');
  expect(JSON.stringify(log.context)).not.toContain('synthetic-B');
  expect(JSON.stringify(log.context)).not.toContain('synthetic-C');
});
it('prefers original patch context when the captured projection has another occupant', async () => {
  const log = await fail(
    task({
      payload: { beds: { R1: patient('synthetic-B') } },
      patchBaseContext: {
        'beds.R1.patientName': 'Paciente synthetic-A',
        'beds.R1.clinicalEpisodeId': 'synthetic-A',
      },
    })
  );
  expect(log.context).toMatchObject({ localSyncFailure: [{ clinicalEpisodeId: 'synthetic-A' }] });
  expect(JSON.stringify(log.context)).not.toContain('synthetic-B');
});
it('identifies newborn independently of mother', async () => {
  const log = await fail(
    task({
      payload: { beds: { R1: { ...patient('mother'), clinicalCrib: patient('newborn') } } },
      syncContract: { changedPaths: ['beds.R1.clinicalCrib.pathology'] },
    })
  );
  expect(JSON.stringify(log.context)).toContain('newborn');
  expect(JSON.stringify(log.context)).toContain('clinicalCrib');
  expect(JSON.stringify(log.context)).not.toContain('mother');
});
it('keeps each changed bed and episode without attributing the whole day', async () => {
  const log = await fail(
    task({ syncContract: { changedPaths: ['beds.R1.pathology', 'beds.R2.status'] } })
  );
  expect(log.context).toMatchObject({
    localSyncFailure: [{ clinicalEpisodeId: 'synthetic-A' }, { clinicalEpisodeId: 'synthetic-C' }],
  });
});
it('declares old tasks without episode evidence unknown', async () => {
  const log = await fail(task({ payload: {}, syncContract: undefined }));
  expect(JSON.stringify(log.context)).toContain('desconocido');
});
it('uses captured specialist targets', async () => {
  const log = await fail(
    task({
      type: 'UPDATE_SPECIALIST_HANDOFF',
      payload: {
        date: '2026-11-10',
        patch: {},
        expectedOccupants: [{ ...patient('specialist-A'), bedId: 'R1', target: 'clinicalCrib' }],
      },
      syncContract: undefined,
    })
  );
  expect(JSON.stringify(log.context)).toContain('specialist-A');
});
it('keeps new local context out of the external payload and health summary', async () => {
  const log = await fail(task());
  expect(log.context).toMatchObject({ localSyncFailure: [{ clinicalEpisodeId: 'synthetic-A' }] });
  const send = vi.fn(async (_url: string, _options: RequestInit) => ({ ok: true }));
  vi.stubGlobal('fetch', send);
  vi.stubGlobal('navigator', {});
  const event = {
    category: 'sync' as const,
    status: 'failed' as const,
    operation: 'error_service_log' as const,
    timestamp: log.timestamp,
    issues: [log.message],
  };
  const config = { enabled: true, endpoint: 'https://synthetic.invalid/telemetry', sampleRate: 1 };
  await dispatchOperationalTelemetryExternally({ ...event, context: log.context }, config);
  await dispatchOperationalTelemetryExternally(
    {
      ...event,
      context: Object.fromEntries(
        Object.entries(log.context || {}).filter(([key]) => key !== 'localSyncFailure')
      ),
    },
    config
  );
  expect(send).toHaveBeenCalledTimes(2);
  const sent = send.mock.calls.map(([, options]) => JSON.parse(String(options.body)));
  expect(sent[0].event.context).toEqual(sent[1].event.context);
  expect(JSON.stringify(sent[0])).not.toMatch(
    /synthetic-A|Paciente|clinicalEpisode|localSyncFailure|PAS-123/
  );
  const health = buildRecentUserHealthEvents({ localErrors: [log], operationalEvents: [] });
  expect(JSON.stringify(health)).not.toContain('synthetic-A');
});
