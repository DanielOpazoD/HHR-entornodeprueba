// @vitest-environment node

/**
 * What the production log can count about sync conflicts and sync notices: each event goes the
 * whole way, from the producer through the browser sanitizer and the beacon to the Netlify ingest
 * policy, and only closed values survive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { recordSyncQueueConflictTelemetry } from '@/services/storage/sync/syncQueueTelemetryController';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import type { CreateSyncQueueEngineOptions } from '@/services/storage/sync/syncQueueEngineContracts';
import { presentSyncOutcomeFeedback } from '@/hooks/controllers/dailyRecordSyncNotificationController';
import { parseOperationalTelemetryBody } from '@/services/observability/operationalTelemetryIngestPolicy';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const beacons: Blob[] = [];

const ingestedEvents = async () =>
  Promise.all(
    beacons.map(async blob => {
      const parsed = parseOperationalTelemetryBody(await blob.text());
      if (!parsed.ok) throw new Error(`ingest refused the beacon: ${parsed.reason}`);
      return parsed.event;
    })
  );

const conflictTask = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  id: 7,
  opId: 'UPDATE_DAILY_RECORD:daily:2026-11-15:1',
  type: 'UPDATE_DAILY_RECORD',
  key: 'daily:2026-11-15',
  payload: { date: '2026-11-15' },
  timestamp: Date.parse('2026-11-15T12:00:00.000Z'),
  retryCount: 0,
  status: 'CONFLICT',
  origin: 'conflict_auto_merge',
  contexts: ['clinical'],
  ...overrides,
});

describe('sync conflicts and notices reach the production log as countable values', () => {
  beforeEach(() => {
    beacons.length = 0;
    vi.stubEnv('VITE_OPERATIONAL_TELEMETRY_ENDPOINT', '/.netlify/functions/operational-telemetry');
    Object.defineProperty(globalThis, 'navigator', {
      value: { sendBeacon: (_url: string, blob: Blob) => (beacons.push(blob), true) },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('counts a queue task that became CONFLICT by its origin, without its key or patient', async () => {
    recordSyncQueueConflictTelemetry(
      conflictTask(),
      'Ana Pérez 12.345.678-5: la versión del servidor cambió'
    );

    await vi.waitFor(() => expect(beacons).toHaveLength(1));
    const [event] = await ingestedEvents();
    expect(event).toMatchObject({
      category: 'sync',
      status: 'degraded',
      operation: 'sync_queue_task_conflict',
      context: { origin: 'conflict_auto_merge' },
    });
    expect(event.date).toBeUndefined();
    const wire = JSON.stringify(event);
    expect(wire).not.toContain('12.345.678');
    expect(wire).not.toContain('Ana');
    expect(wire).not.toContain('daily:');
  });

  it('counts an edit held as a conflict because its bed changed patient', async () => {
    recordSyncQueueConflictTelemetry(
      conflictTask({
        origin: 'direct_queue',
        key: 'daily:2026-11-15:detached:7:["R1","nursingNote","rut","12.345.678-5","Ana","e1"]',
      }),
      'held'
    );

    await vi.waitFor(() => expect(beacons).toHaveLength(1));
    const [event] = await ingestedEvents();
    expect(event.context).toEqual({ origin: 'direct_queue', reason: 'occupant_changed' });
    expect(JSON.stringify(event)).not.toContain('12.345.678');
  });

  it('counts each held edit once the ACK stored it, and none when the ACK was refused', async () => {
    const held = conflictTask({
      id: undefined,
      origin: 'direct_queue',
      key: 'daily:2026-11-15:detached:7:["R1","nursingNote","rut","12.345.678-5","Ana","e1"]',
      error: 'Ana Pérez ya no ocupa la cama R1',
    });
    const run = async (acked: boolean) => {
      let first = true;
      const engine = createSyncQueueEngine({
        store: {
          claimReadyPending: async () =>
            first
              ? ((first = false),
                [
                  conflictTask({
                    status: 'PROCESSING',
                    leaseOwner: 'worker',
                    leaseUntil: Date.now() + 30_000,
                    attemptId: 'attempt',
                  }),
                ])
              : [],
          updateClaimed: async () => true,
          deleteClaimed: async () => acked,
        },
        runtime: { isOnline: () => true, onOnline: () => {}, getOwnerKey: () => null },
        transport: { run: async () => ({ detachedConflicts: [held] }) },
        batchSize: 25,
        maxPendingTasks: 100,
        maxRetries: 3,
        baseRetryDelayMs: 1000,
        maxRetryDelayMs: 30000,
      } as unknown as CreateSyncQueueEngineOptions);
      await engine.processQueue();
      await new Promise(resolve => setTimeout(resolve, 20));
    };

    await run(true);
    const events = await ingestedEvents();
    expect(events.filter(event => event.operation === 'sync_queue_task_conflict')).toHaveLength(1);
    expect(events.find(event => event.operation === 'sync_queue_task_conflict')?.context).toEqual({
      origin: 'direct_queue',
      reason: 'occupant_changed',
    });

    beacons.length = 0;
    await run(false);
    expect(
      (await ingestedEvents()).filter(event => event.operation === 'sync_queue_task_conflict')
    ).toHaveLength(0);
  });

  it('counts the sync notice shown to the person by its kind, never by its text', async () => {
    const shown = vi.fn();
    presentSyncOutcomeFeedback(
      {
        channel: 'warning',
        kind: 'auto_merged',
        title: 'Cambio actualizado',
        message: 'El sistema integró los cambios recientes automáticamente.',
      },
      'Actualización',
      { success: vi.fn(), warning: shown, error: vi.fn() }
    );

    expect(shown).toHaveBeenCalledWith(
      'Cambio actualizado',
      'El sistema integró los cambios recientes automáticamente.'
    );
    await vi.waitFor(() => expect(beacons).toHaveLength(1));
    const [event] = await ingestedEvents();
    expect(event).toMatchObject({
      category: 'daily_record',
      status: 'degraded',
      operation: 'daily_record_sync_notice',
      context: { noticeKind: 'auto_merged' },
      issues: [],
    });
    expect(JSON.stringify(event)).not.toContain('integró');
  });

  it('keeps a routine confirmation and an unclassified notice out of the count', async () => {
    const channels = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    presentSyncOutcomeFeedback(
      { channel: 'success', title: 'Cambio guardado', message: 'Confirmado.' },
      'Actualización',
      channels
    );
    presentSyncOutcomeFeedback(
      { channel: 'warning', title: 'Sincronización', message: 'Refresco parcial.' },
      'Sincronización',
      channels
    );

    expect(channels.success).toHaveBeenCalledTimes(1);
    expect(channels.warning).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(beacons).toHaveLength(0);
  });

  it('drops a notice kind or origin that is not a closed value', async () => {
    presentSyncOutcomeFeedback(
      {
        channel: 'warning',
        // A crafted kind must not reach the log as free text.
        kind: 'Ana Pérez' as 'auto_merged',
        title: 'x',
        message: 'y',
      },
      'Actualización',
      { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
    );
    recordSyncQueueConflictTelemetry(
      conflictTask({ origin: 'Ana Pérez' as SyncTask['origin'] }),
      'x'
    );

    await vi.waitFor(() => expect(beacons).toHaveLength(2));
    const events = await ingestedEvents();
    expect(events.map(event => event.context)).toEqual([{}, {}]);
    expect(JSON.stringify(events)).not.toContain('Ana');
  });
});
