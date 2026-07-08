import { describe, expect, it } from 'vitest';
import type { UserHealthStatus } from '@/services/admin/healthService';
import { buildSystemHealthSyncConvergencePanelModel } from '@/features/admin/components/systemHealthSyncConvergenceModel';

const buildUser = (overrides: Partial<UserHealthStatus>): UserHealthStatus => ({
  uid: 'u1',
  email: 'user@example.com',
  displayName: 'User Example',
  lastSeen: '2026-05-21T14:06:00.000Z',
  isOnline: true,
  isOutdated: false,
  pendingMutations: 0,
  pendingSyncTasks: 0,
  failedSyncTasks: 0,
  conflictSyncTasks: 0,
  retryingSyncTasks: 0,
  syncOrphanedTasks: 0,
  oldestPendingAgeMs: 0,
  oldestDirectQueueAgeMs: 0,
  remoteSyncReason: 'ready',
  versionUpdateReason: 'current',
  localErrorCount: 0,
  degradedLocalPersistence: false,
  repositoryWarningCount: 0,
  slowestRepositoryOperationMs: 0,
  operationalObservedCount: 0,
  operationalFailureCount: 0,
  operationalRetryableCount: 0,
  operationalRecoverableCount: 0,
  operationalDegradedCount: 0,
  operationalBlockedCount: 0,
  operationalUnauthorizedCount: 0,
  operationalLastHourObservedCount: 0,
  operationalSyncObservedCount: 0,
  operationalIndexedDbObservedCount: 0,
  operationalClinicalDocumentObservedCount: 0,
  operationalCreateDayObservedCount: 0,
  operationalHandoffObservedCount: 0,
  operationalExportBackupObservedCount: 0,
  operationalDailyRecordRecoveredRealtimeNullCount: 0,
  operationalDailyRecordConfirmedRealtimeNullCount: 0,
  operationalSyncReadUnavailableCount: 0,
  operationalIndexedDbFallbackModeCount: 0,
  operationalAuthBootstrapTimeoutCount: 0,
  appVersion: 'v1',
  platform: 'MacIntel',
  userAgent: 'Vitest',
  ...overrides,
});

describe('systemHealthSyncConvergencePanel', () => {
  it('summarizes pending operations, recoverable divergences and last accepted truth', () => {
    const model = buildSystemHealthSyncConvergencePanelModel([
      buildUser({
        pendingSyncTasks: 2,
        retryingSyncTasks: 1,
        oldestPendingAgeMs: 12 * 60 * 1000,
        operationalSyncObservedCount: 4,
        recentEvents: [
          {
            id: 'truth-ok',
            source: 'operational',
            category: 'sync',
            severity: 'info',
            status: 'recovered',
            timestamp: '2026-05-21T14:05:00.000Z',
            message: 'sync_queue_truth_selected',
            operation: 'sync_queue_truth_selected',
            module: 'Censo diario',
            action: 'accepted',
            runtimeState: 'recoverable',
            telemetryStatus: 'success',
            contextSummary: ['fecha clinica: 2026-05-21'],
          },
          {
            id: 'replay-stale',
            source: 'operational',
            category: 'sync',
            severity: 'warning',
            status: 'recovered',
            timestamp: '2026-05-21T14:04:00.000Z',
            message: 'stale replay recovered',
            operation: 'sync_queue_replay_stale',
            module: 'Censo diario',
            action: 'replay',
            runtimeState: 'recoverable',
            telemetryStatus: 'partial',
            contextSummary: ['fecha clinica: 2026-05-21'],
          },
        ],
      }),
    ]);

    expect(model).toMatchObject({
      status: 'recoverable',
      statusLabel: 'Con recuperación pendiente',
      pendingOperations: 3,
      recoverableDivergences: 1,
      affectedUsers: 1,
      lastConvergenceOkAt: '2026-05-21T14:05:00.000Z',
    });
    expect(model.summary).toContain('3 operaciones pendientes/reintentando');
    expect(model.technicalDetails).toEqual(
      expect.arrayContaining([
        'User Example: 2 pendientes, 1 reintentando',
        'Operación recuperable: sync_queue_replay_stale en Censo diario',
      ])
    );
  });

  it('escalates failed or conflicted sync work as needing clinical review', () => {
    const model = buildSystemHealthSyncConvergencePanelModel([
      buildUser({
        failedSyncTasks: 1,
        conflictSyncTasks: 1,
        pendingSyncTasks: 1,
        recentEvents: [
          {
            id: 'blocked',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-05-21T14:05:00.000Z',
            message: 'blocked',
            operation: 'sync_queue_truth_selected',
            module: 'Entrega turno',
            runtimeState: 'blocked',
            telemetryStatus: 'failed',
          },
        ],
      }),
    ]);

    expect(model).toMatchObject({
      status: 'needs_review',
      statusLabel: 'Requiere revisión',
      pendingOperations: 1,
      blockedOperations: 2,
      affectedUsers: 1,
    });
    expect(model.summary).toContain('2 operaciones fallidas/en conflicto');
  });

  it('surfaces clinical signal groups and operator next steps without exposing raw logs first', () => {
    const model = buildSystemHealthSyncConvergencePanelModel([
      buildUser({
        displayName: 'Hospitalizados HHR',
        pendingSyncTasks: 1,
        conflictSyncTasks: 1,
        recentEvents: [
          {
            id: 'medical-divergence',
            source: 'operational',
            category: 'sync',
            severity: 'critical',
            status: 'open',
            timestamp: '2026-07-02T11:05:00.000Z',
            message: 'Entrega médica divergente en medicalHandoffBySpecialty.cirugia.note.',
            operation: 'medical_handoff_divergent',
            module: 'Entrega médica',
            runtimeState: 'blocked',
            telemetryStatus: 'failed',
            contextSummary: ['Paciente: Ana Perez', 'RUT: 12.345.678-5', 'Cama: R1'],
          },
          {
            id: 'nursing-recovered',
            source: 'operational',
            category: 'sync',
            severity: 'warning',
            status: 'recovered',
            timestamp: '2026-07-02T11:00:00.000Z',
            message: 'Entrega de enfermería recuperada por replay.',
            operation: 'handoff_divergent',
            module: 'Entrega enfermería',
            runtimeState: 'recoverable',
            telemetryStatus: 'success',
            contextSummary: ['Paciente: Pedro Silva', 'Cama: R2'],
          },
        ],
      }),
    ]);

    expect(model.operatorActions).toEqual(
      expect.arrayContaining([
        expect.stringContaining('reintentar cola local'),
        expect.stringContaining('abrir centro de conflictos'),
      ])
    );
    expect(model.clinicalSignals).toEqual([
      expect.objectContaining({
        label: 'Entrega médica',
        count: 1,
        examples: expect.arrayContaining([
          expect.stringContaining('Ana Perez'),
          expect.stringContaining('medicalHandoffBySpecialty.cirugia.note'),
        ]),
      }),
      expect.objectContaining({
        label: 'Entrega enfermería',
        count: 1,
        examples: expect.arrayContaining([expect.stringContaining('Pedro Silva')]),
      }),
    ]);
  });

  it('keeps clinical signal ownership when different users emit repeated event ids', () => {
    const model = buildSystemHealthSyncConvergencePanelModel([
      buildUser({
        uid: 'nurse-1',
        displayName: 'Hospitalizados HHR',
        recentEvents: [
          {
            id: 'shared-event-id',
            source: 'operational',
            category: 'sync',
            severity: 'warning',
            status: 'recovered',
            timestamp: '2026-07-02T11:00:00.000Z',
            message: 'Censo recuperado por replay.',
            operation: 'daily_record_replay',
            module: 'Censo diario',
            runtimeState: 'recoverable',
            telemetryStatus: 'success',
            contextSummary: ['Paciente: Ana Perez'],
          },
        ],
      }),
      buildUser({
        uid: 'doctor-1',
        displayName: 'Médico Turno',
        recentEvents: [
          {
            id: 'shared-event-id',
            source: 'operational',
            category: 'sync',
            severity: 'warning',
            status: 'recovered',
            timestamp: '2026-07-02T11:01:00.000Z',
            message: 'Censo recuperado por replay médico.',
            operation: 'daily_record_replay',
            module: 'Censo diario',
            runtimeState: 'recoverable',
            telemetryStatus: 'success',
            contextSummary: ['Paciente: Pedro Silva'],
          },
        ],
      }),
    ]);

    expect(model.clinicalSignals).toEqual([
      expect.objectContaining({
        label: 'Censo diario',
        count: 2,
        examples: [
          expect.stringContaining('Hospitalizados HHR · Censo recuperado por replay.'),
          expect.stringContaining('Médico Turno · Censo recuperado por replay médico.'),
        ],
      }),
    ]);
  });
});
