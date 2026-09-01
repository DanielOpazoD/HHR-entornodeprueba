import { describe, expect, it } from 'vitest';
import {
  buildSyncQueueChipModel,
  listQuarantinedOperations,
  SYNC_QUEUE_CHIP_PENDING_VISIBILITY_MS,
} from '@/features/rayen-import/components/syncQueueStatusPresentation';
import type { SyncQueueOperation, SyncQueueStats } from '@/hooks/useSyncQueueMonitor';

const makeStats = (overrides: Partial<SyncQueueStats> = {}): SyncQueueStats => ({
  pending: 0,
  failed: 0,
  retrying: 0,
  acked: 0,
  conflict: 0,
  oldestPendingAgeMs: 0,
  ...overrides,
});

describe('syncQueueStatusPresentation', () => {
  it('permanece oculto en operación normal, incluso con una escritura en vuelo', () => {
    expect(buildSyncQueueChipModel(makeStats()).tone).toBe('hidden');
    // Un guardado recién encolado (pre-outbox hold) no debe hacer parpadear la barra.
    expect(buildSyncQueueChipModel(makeStats({ pending: 1, oldestPendingAgeMs: 2_000 })).tone).toBe(
      'hidden'
    );
  });

  it('anuncia lo pendiente cuando envejece o ya está reintentando', () => {
    const aged = buildSyncQueueChipModel(
      makeStats({ pending: 2, oldestPendingAgeMs: SYNC_QUEUE_CHIP_PENDING_VISIBILITY_MS })
    );
    expect(aged.tone).toBe('syncing');
    expect(aged.label).toBe('2 por sincronizar');

    const retrying = buildSyncQueueChipModel(
      makeStats({ pending: 1, retrying: 1, oldestPendingAgeMs: 1_000 })
    );
    expect(retrying.tone).toBe('syncing');
  });

  it('pasa a atención cuando hay tareas en cuarentena, sumando FAILED y CONFLICT', () => {
    const model = buildSyncQueueChipModel(makeStats({ failed: 1, conflict: 1, pending: 3 }));
    expect(model.tone).toBe('attention');
    expect(model.label).toBe('2 sin sincronizar');
  });

  it('presenta las operaciones en cuarentena con la taxonomía en castellano', () => {
    const operations: SyncQueueOperation[] = [
      {
        id: 7,
        type: 'UPDATE_DAILY_RECORD',
        status: 'FAILED',
        retryCount: 5,
        timestamp: 1,
        key: 'daily:2026-09-01',
        lastErrorCategory: 'authorization',
        lastErrorAction: 'Revisar permisos/reglas y sesión del usuario.',
      },
      {
        id: 8,
        type: 'UPDATE_DAILY_RECORD',
        status: 'CONFLICT',
        retryCount: 0,
        timestamp: 2,
        key: 'daily:2026-09-02',
        lastErrorCategory: 'conflict',
      },
      // Activas o sin id: fuera de la lista de cuarentena.
      { id: 9, type: 'UPDATE_DAILY_RECORD', status: 'PENDING', retryCount: 0, timestamp: 3 },
      { type: 'UPDATE_DAILY_RECORD', status: 'FAILED', retryCount: 0, timestamp: 4 },
    ];

    expect(listQuarantinedOperations(operations)).toEqual([
      {
        id: 7,
        targetLabel: 'Censo del 01-09-2026',
        statusLabel: 'Detenido',
        categoryLabel: 'Sin permisos',
        actionHint: 'Revisar permisos/reglas y sesión del usuario.',
        attemptsLabel: '6 intentos',
      },
      {
        id: 8,
        targetLabel: 'Censo del 02-09-2026',
        statusLabel: 'En conflicto',
        categoryLabel: 'Conflicto de versiones',
        actionHint: null,
        attemptsLabel: null,
      },
    ]);
  });
});
