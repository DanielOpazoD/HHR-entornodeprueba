import { describe, expect, it } from 'vitest';
import {
  presentRayenCoverageIssue,
  presentRayenCoverage,
  presentRayenSyncOutcome,
  presentRayenSyncRecovery,
  rayenPrimaryActionLabel,
  rayenSyncStatusLabel,
} from '@/features/rayen-import/components/rayenSyncPresentation';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

describe('rayen sync presentation', () => {
  it('keeps legacy, complete, patient-error and source-error coverage distinguishable', () => {
    expect(presentRayenCoverage(undefined, true).label).toBe(
      'No disponible en sincronizaciones antiguas'
    );
    expect(presentRayenCoverage(undefined, true, true)).toEqual({
      label: 'Enriquecimiento pendiente',
      tone: 'warning',
    });
    expect(
      presentRayenCoverage(
        { total: 3, completed: 3, errors: 0, sourceErrors: 0, completedAt: 'now' },
        true
      )
    ).toEqual({ label: '3/3 completa', tone: 'success' });
    expect(
      presentRayenCoverage(
        { total: 3, completed: 2, errors: 1, sourceErrors: 2, completedAt: 'now' },
        true
      ).label
    ).toBe('2/3 · 1 pendiente');
    expect(
      presentRayenCoverage(
        { total: 3, completed: 3, errors: 0, sourceErrors: 1, completedAt: 'now' },
        true
      ).label
    ).toBe('3/3 · fuente parcial');
  });

  it('names the action the current extension state can actually perform', () => {
    expect(rayenPrimaryActionLabel('checking', false)).toBe('Comprobando…');
    expect(rayenPrimaryActionLabel('ready', false)).toBe('Sincronizar');
    expect(rayenPrimaryActionLabel('degraded', false)).toBe('Sincronizar parcial');
    expect(rayenPrimaryActionLabel('blocked', false)).toBe('Revisar Ficha Médico');
    expect(rayenPrimaryActionLabel('incompatible', false)).toBe('Actualizar extensión');
    expect(rayenPrimaryActionLabel('offline', false)).toBe('Comprobar conexión');
    expect(rayenPrimaryActionLabel('ready', true)).toBe('Sincronizando…');
  });

  it('explains the actual causes of a partial synchronization', () => {
    const event: RayenSyncEvent = {
      id: 'run-partial',
      startedAt: '2026-07-14T10:00:00.000Z',
      by: 'Operador',
      status: 'partial',
      coverage: {
        total: 11,
        completed: 10,
        errors: 1,
        sourceErrors: 2,
        completedAt: '2026-07-14T10:03:00.000Z',
      },
      source: { fichaMedico: 'ready', gestionCamas: 'missing' },
    };

    expect(presentRayenSyncOutcome(event)).toMatchObject({
      label: 'Parcial',
      detail:
        '1 paciente no se pudo completar · Fuente clínica incompleta · Gestión de Camas no disponible',
      tone: 'warning',
      unresolved: true,
    });
  });

  it('turns a persisted issue into a concrete recovery instruction', () => {
    expect(
      presentRayenCoverageIssue({
        bedId: 'R2',
        source: 'patch',
        reason: 'concurrent_write',
      })
    ).toBe(
      'Cama R2 · Guardado del censo: el censo cambió mientras se guardaba; reintenta para completar este dato.'
    );
  });

  it('does not mislabel an historical CUDYR archive issue as an incomplete Eloísa source', () => {
    const event: RayenSyncEvent = {
      id: 'run-cudyr-history',
      startedAt: '2026-07-17T07:16:00.000Z',
      by: 'Operador',
      status: 'partial',
      coverage: {
        total: 9,
        completed: 8,
        errors: 1,
        sourceErrors: 1,
        completedAt: '2026-07-17T07:17:00.000Z',
        issues: [{ bedId: 'R1', source: 'cudyr', reason: 'historical_archive_failed' }],
      },
    };

    expect(presentRayenSyncOutcome(event).detail).toBe('1 paciente no se pudo completar');
  });

  it('does not mislabel a global synchronization issue as an incomplete clinical source', () => {
    const event: RayenSyncEvent = {
      id: 'run-global-issue',
      startedAt: '2026-07-17T07:16:00.000Z',
      by: 'Operador',
      status: 'partial',
      coverage: {
        total: 9,
        completed: 9,
        errors: 0,
        sourceErrors: 1,
        completedAt: '2026-07-17T07:17:00.000Z',
        issues: [{ bedId: '*', source: 'patch', reason: 'sync_already_running' }],
      },
    };

    expect(presentRayenSyncOutcome(event).detail).toBe('Enriquecimiento clínico parcial');
  });

  it('offers reviewed recovery only after the connection is ready again', () => {
    const event: RayenSyncEvent = {
      id: 'run-failed',
      startedAt: '2026-07-14T10:00:00.000Z',
      by: 'Operador',
      status: 'failed',
      failureReason: 'snapshot_timeout',
    };

    expect(presentRayenSyncRecovery(event, 'offline')).toMatchObject({
      action: 'refresh',
      actionLabel: 'Comprobar nuevamente',
    });
    expect(presentRayenSyncRecovery(event, 'ready')).toMatchObject({
      action: 'retry',
      actionLabel: 'Reintentar con revisión',
    });
    expect(presentRayenSyncRecovery(event, 'ready', true)).toMatchObject({
      title: 'Sincronización en curso',
      action: null,
    });
    expect(presentRayenSyncRecovery({ ...event, status: 'complete' }, 'ready')).toBeNull();
  });

  it('keeps the persisted last-sync status concise and backward compatible', () => {
    expect(rayenSyncStatusLabel('complete')).toBe('Completa');
    expect(rayenSyncStatusLabel('partial')).toBe('Parcial');
    expect(rayenSyncStatusLabel('applied')).toBe('Censo aplicado');
    expect(rayenSyncStatusLabel(undefined)).toBeNull();
  });
});
