import { describe, expect, it } from 'vitest';
import {
  presentRayenCoverageIssue,
  presentRayenDeferredHistoricalAdmissionNote,
  presentRayenLegacyCoverageGap,
  presentRayenStructuralIssue,
  presentRayenStructuralReviewDetails,
  formatRayenSyncDuration,
  presentRayenCoverage,
  presentRayenSyncOutcome,
  presentRayenSyncRecovery,
  rayenFailureReasonLabel,
  rayenPrimaryActionLabel,
  rayenSyncStatusLabel,
} from '@/features/rayen-import/components/rayenSyncPresentation';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';

describe('rayen sync presentation', () => {
  it('formats persisted run duration without inventing a value for incomplete or invalid events', () => {
    expect(formatRayenSyncDuration('2026-07-27T10:00:00.000Z', '2026-07-27T10:02:05.000Z')).toBe(
      '2 min 5 s'
    );
    expect(formatRayenSyncDuration('2026-07-27T10:00:00.000Z', '2026-07-27T10:00:18.000Z')).toBe(
      '18 s'
    );
    expect(formatRayenSyncDuration('invalid', '2026-07-27T10:00:18.000Z')).toBeNull();
    expect(formatRayenSyncDuration('2026-07-27T10:00:00.000Z')).toBeNull();
  });

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

  it('describes legacy coverage gaps with the counter that actually failed', () => {
    expect(
      presentRayenLegacyCoverageGap({
        total: 3,
        completed: 2,
        errors: 1,
        sourceErrors: 0,
        completedAt: 'now',
      })
    ).toContain('1 paciente con información clínica incompleta');
    expect(
      presentRayenLegacyCoverageGap({
        total: 3,
        completed: 2,
        errors: 0,
        sourceErrors: 2,
        completedAt: 'now',
      })
    ).toContain('2 fallas de fuente');
  });

  it('names the action the current extension state can actually perform', () => {
    expect(rayenPrimaryActionLabel('checking', false)).toBe('Comprobando…');
    expect(rayenPrimaryActionLabel('ready', false)).toBe('Sincronizar');
    // Botón honesto: infactible → deshabilitado con la razón en el title; la
    // etiqueta ya no muta a llamados a la acción que el clic no cumple.
    expect(rayenPrimaryActionLabel('degraded', false)).toBe('Sincronizar');
    expect(rayenPrimaryActionLabel('blocked', false)).toBe('Sincronizar');
    expect(rayenPrimaryActionLabel('incompatible', false)).toBe('Sincronizar');
    expect(rayenPrimaryActionLabel('offline', false)).toBe('Sincronizar');
    expect(rayenPrimaryActionLabel('ready', true)).toBe('Sincronizando…');
  });

  it('explains the actual causes of a partial synchronization', () => {
    const event: RayenSyncEvent = {
      id: 'run-partial',
      startedAt: '2026-07-14T10:00:00.000Z',
      by: 'Operador',
      status: 'partial',
      structuralReview: {
        structureConfirmed: true,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 0,
      },
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

  it('identifies a census load failure without presenting it as a save failure', () => {
    const issue = {
      bedId: '*',
      source: 'census' as const,
      reason: 'record_load_failed' as const,
    };
    expect(presentRayenCoverageIssue(issue)).toBe(
      'General · Carga del censo HHR: no se pudo cargar el censo actual; comprueba la conexión y reintenta.'
    );
    expect(
      presentRayenSyncOutcome({
        id: 'run-load-failed',
        startedAt: '2026-08-26T10:00:00.000Z',
        by: 'Operador',
        status: 'partial',
        coverage: {
          total: 1,
          completed: 1,
          errors: 0,
          sourceErrors: 1,
          issues: [issue],
          completedAt: '2026-08-26T10:00:01.000Z',
        },
      }).detail
    ).toBe('No se pudo cargar el censo HHR');
  });

  it('explains a structurally partial run even when clinical coverage is complete', () => {
    const event: RayenSyncEvent = {
      id: 'run-structural-partial',
      startedAt: '2026-08-23T22:00:00.000Z',
      by: 'Operador',
      status: 'partial',
      structuralReview: {
        structureConfirmed: true,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 1,
        issues: [{ bedId: 'H5C2', reason: 'occupied-local-bed' }],
      },
      coverage: {
        total: 10,
        completed: 10,
        errors: 0,
        sourceErrors: 0,
        completedAt: '2026-08-23T22:01:00.000Z',
      },
      source: { fichaMedico: 'ready', gestionCamas: 'ready' },
    };

    expect(presentRayenSyncOutcome(event)).toMatchObject({
      label: 'Parcial',
      detail: '1 cambio del censo no se aplicó',
      unresolved: true,
    });
    expect(presentRayenSyncRecovery(event, 'ready')).toMatchObject({
      title: 'Censo pendiente de revisión',
      detail: '1 cambio del censo no se aplicó. Eloísa está operativa.',
      action: 'retry_full',
    });
    expect(presentRayenStructuralIssue(event.structuralReview!.issues![0])).toBe(
      'Cama H5C2: la cama está ocupada por otro paciente en HHR.'
    );
  });

  it('explains legacy structural partials without inventing a bed or cause', () => {
    expect(
      presentRayenStructuralReviewDetails({
        structureConfirmed: true,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 1,
      })
    ).toEqual([
      '1 cambio del censo no se aplicó; esta ejecución anterior no conservó la cama y la causa.',
    ]);
  });

  it('identifies a staffing source failure in user-facing recovery guidance', () => {
    expect(
      presentRayenCoverageIssue({
        bedId: 'H2C1',
        source: 'staffing',
        reason: 'source_unavailable',
      })
    ).toBe(
      'Cama H2C1 · Enfermería / TENS: Eloísa no devolvió esta información; comprueba la ficha y reintenta.'
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

  it('keeps an unverified D-1 backfill informative without reopening the current-day census', () => {
    const event: RayenSyncEvent = {
      id: 'run-deferred-history',
      startedAt: '2026-08-23T22:00:00.000Z',
      by: 'Operador',
      status: 'complete',
      structuralReview: {
        structureConfirmed: true,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 0,
        deferredHistoricalAdmissionBedIds: ['H5C2'],
      },
    };

    expect(presentRayenSyncOutcome(event)).toMatchObject({
      label: 'Completa',
      unresolved: false,
    });
    expect(presentRayenSyncRecovery(event, 'ready')).toBeNull();
    expect(presentRayenDeferredHistoricalAdmissionNote(event.structuralReview)).toContain(
      'El ingreso del día actual quedó sincronizado'
    );
    expect(presentRayenDeferredHistoricalAdmissionNote(event.structuralReview)).toContain(
      'la cama H5C2'
    );
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
      action: 'retry_full',
      actionLabel: 'Revisar censo',
    });
    expect(presentRayenSyncRecovery(event, 'ready', true)).toMatchObject({
      title: 'Sincronización en curso',
      action: null,
    });
    expect(presentRayenSyncRecovery({ ...event, status: 'complete' }, 'ready')).toBeNull();
  });

  it('retries only clinical data after the census was already confirmed', () => {
    const event: RayenSyncEvent = {
      id: 'run-clinical-partial',
      startedAt: '2026-07-14T10:00:00.000Z',
      by: 'Operador',
      status: 'partial',
      structuralReview: {
        structureConfirmed: true,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 0,
      },
      coverage: {
        total: 10,
        completed: 9,
        errors: 1,
        sourceErrors: 0,
        completedAt: '2026-07-14T10:03:00.000Z',
      },
    };

    expect(presentRayenSyncRecovery(event, 'ready')).toMatchObject({
      title: 'Información clínica pendiente',
      action: 'retry_clinical',
      actionLabel: 'Reintentar información clínica',
    });
  });

  it('does not infer a clinical-only retry from legacy coverage without structural proof', () => {
    const event: RayenSyncEvent = {
      id: 'legacy-partial',
      startedAt: '2026-07-14T10:00:00.000Z',
      by: 'Operador',
      status: 'partial',
      coverage: {
        total: 10,
        completed: 9,
        errors: 1,
        sourceErrors: 0,
        completedAt: '2026-07-14T10:03:00.000Z',
      },
    };

    expect(presentRayenSyncRecovery(event, 'ready')).toMatchObject({
      title: 'Censo pendiente de revisión',
      action: 'retry_full',
      actionLabel: 'Revisar censo',
    });
  });

  it('keeps the persisted last-sync status concise and backward compatible', () => {
    expect(rayenSyncStatusLabel('complete')).toBe('Completa');
    expect(rayenSyncStatusLabel('partial')).toBe('Parcial');
    expect(rayenSyncStatusLabel('applied')).toBe('Censo aplicado');
    expect(rayenSyncStatusLabel(undefined)).toBeNull();
  });

  it('una pestaña de Ficha Médico inactiva pide recargarla antes de ofrecer «Revisar censo», aunque Eloísa esté sana', () => {
    expect(rayenFailureReasonLabel('ficha_medico_stale')).toBe(
      'Ficha Médico inactiva: recargar la pestaña'
    );

    const event: RayenSyncEvent = {
      id: 'stale-tab',
      startedAt: '2026-09-02T13:37:55.000Z',
      completedAt: '2026-09-02T13:37:56.000Z',
      by: 'Operador',
      status: 'failed',
      failureReason: 'ficha_medico_stale',
    };
    const recovery = presentRayenSyncRecovery(event, 'ready', false);

    expect(recovery).toMatchObject({
      title: 'Ficha Médico quedó inactiva',
      action: 'retry_full',
      actionLabel: 'Revisar censo',
      tone: 'warning',
    });
    expect(recovery?.detail).toContain('Recárgala (Cmd+R)');
    expect(recovery?.detail).not.toContain('Eloísa está operativa');
  });
});
