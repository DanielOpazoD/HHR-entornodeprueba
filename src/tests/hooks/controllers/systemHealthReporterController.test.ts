import { describe, expect, it } from 'vitest';
import {
  buildRecentUserHealthEvents,
  buildUserHealthStatus,
  canReportSystemHealthForRole,
  canReportSystemHealthForRuntime,
} from '@/hooks/controllers/systemHealthReporterController';

describe('systemHealthReporterController', () => {
  it('allows health reporting only for admin and nursing roles', () => {
    expect(canReportSystemHealthForRole('admin')).toBe(true);
    expect(canReportSystemHealthForRole('nurse_hospital')).toBe(true);
    expect(canReportSystemHealthForRole('doctor_urgency')).toBe(false);
    expect(canReportSystemHealthForRole('viewer')).toBe(false);
    expect(canReportSystemHealthForRole(undefined)).toBe(false);
  });

  it('allows runtime health reporting only when the remote sync runtime is ready', () => {
    expect(canReportSystemHealthForRuntime('admin', 'ready')).toBe(true);
    expect(canReportSystemHealthForRuntime('nurse_hospital', 'ready')).toBe(true);
    expect(canReportSystemHealthForRuntime('admin', 'local_only')).toBe(false);
    expect(canReportSystemHealthForRuntime('admin', 'bootstrapping')).toBe(false);
    expect(canReportSystemHealthForRuntime('viewer', 'ready')).toBe(false);
  });

  it('builds a normalized health payload with sync and repository metrics', () => {
    const status = buildUserHealthStatus({
      uid: 'u1',
      email: 'user@example.com',
      displayName: 'User',
      isFirebaseConnected: true,
      isOutdated: false,
      remoteSyncReason: 'ready',
      versionUpdateReason: 'current',
      mutatingCount: 2,
      localErrorCount: 3,
      degradedLocalPersistence: true,
      navigatorOnline: true,
      platform: 'MacIntel',
      userAgent: 'Vitest',
      syncTelemetry: {
        pending: 4,
        failed: 1,
        conflict: 2,
        retrying: 1,
        orphanedTasks: 2,
        oldestPendingAgeMs: 9000,
        batchSize: 25,
        oldestPendingBudgetState: 'ok',
        retryingBudgetState: 'warning',
        runtimeState: 'degraded',
      },
      repositoryPerformance: {
        totalRecorded: 12,
        warningCount: 3,
        slowestOperationMs: 480,
        slowestOperation: 'getForDate',
        latestWarningAt: '2026-03-01T00:00:00.000Z',
        recentWarningOperations: [],
      },
      operationalTelemetry: {
        recentEventCount: 5,
        recentFailedCount: 2,
        recentObservedCount: 3,
        recentRetryableCount: 1,
        recentRecoverableCount: 1,
        recentDegradedCount: 0,
        recentBlockedCount: 1,
        recentUnauthorizedCount: 0,
        lastHourObservedCount: 2,
        syncFailureCount: 1,
        syncObservedCount: 2,
        degradedLocalCount: 1,
        indexedDbObservedCount: 1,
        clinicalDocumentObservedCount: 1,
        createDayObservedCount: 1,
        handoffObservedCount: 1,
        exportObservedCount: 1,
        backupObservedCount: 1,
        exportOrBackupObservedCount: 2,
        dailyRecordRecoveredRealtimeNullCount: 1,
        dailyRecordConfirmedRealtimeNullCount: 0,
        syncReadUnavailableCount: 1,
        indexedDbFallbackModeCount: 1,
        authBootstrapTimeoutCount: 1,
        topObservedCategory: 'backup',
        topObservedOperation: 'backup_handoff_pdf',
        latestObservedOperation: 'backup_handoff_pdf',
        latestRuntimeState: 'recoverable',
        latestIssueAt: '2026-03-02T00:00:00.000Z',
      },
    });

    expect(status.pendingMutations).toBe(6);
    expect(status.pendingSyncTasks).toBe(4);
    expect(status.syncOrphanedTasks).toBe(2);
    expect(status.remoteSyncReason).toBe('ready');
    expect(status.versionUpdateReason).toBe('current');
    expect(status.failedSyncTasks).toBe(1);
    expect(status.degradedLocalPersistence).toBe(true);
    expect(status.repositoryWarningCount).toBe(3);
    expect(status.slowestRepositoryOperationMs).toBe(480);
    expect(status.operationalObservedCount).toBe(3);
    expect(status.operationalFailureCount).toBe(2);
    expect(status.operationalRetryableCount).toBe(1);
    expect(status.operationalRecoverableCount).toBe(1);
    expect(status.operationalBlockedCount).toBe(1);
    expect(status.operationalLastHourObservedCount).toBe(2);
    expect(status.operationalSyncObservedCount).toBe(2);
    expect(status.operationalIndexedDbObservedCount).toBe(1);
    expect(status.operationalClinicalDocumentObservedCount).toBe(1);
    expect(status.operationalCreateDayObservedCount).toBe(1);
    expect(status.operationalHandoffObservedCount).toBe(1);
    expect(status.operationalExportBackupObservedCount).toBe(2);
    expect(status.operationalDailyRecordRecoveredRealtimeNullCount).toBe(1);
    expect(status.operationalSyncReadUnavailableCount).toBe(1);
    expect(status.operationalIndexedDbFallbackModeCount).toBe(1);
    expect(status.operationalAuthBootstrapTimeoutCount).toBe(1);
    expect(status.operationalTopObservedCategory).toBe('backup');
    expect(status.operationalTopObservedOperation).toBe('backup_handoff_pdf');
    expect(status.latestOperationalOperation).toBe('backup_handoff_pdf');
    expect(status.latestOperationalRuntimeState).toBe('recoverable');
    expect(status.appVersion).toContain('sync-batch:25');
    expect(status.appVersion).toContain('authority:client_only');
  });

  it('builds recent user health events with safe operational context', () => {
    const events = buildRecentUserHealthEvents({
      localErrors: [
        {
          id: 'err-1',
          timestamp: '2026-05-21T14:02:00.000Z',
          message: 'No se pudo guardar el censo diario',
          severity: 'critical',
          userId: 'u1',
          userEmail: 'user@example.com',
          url: 'https://hhr.local/censo?debug=true',
          context: {
            module: 'Censo diario',
            action: 'Guardar dia',
            patientName: 'No debe exponerse',
            rut: '11111111-1',
          },
        },
      ],
      operationalEvents: [
        {
          category: 'sync',
          status: 'failed',
          runtimeState: 'blocked',
          operation: 'daily_record_remote_write',
          timestamp: '2026-05-21T14:03:00.000Z',
          issues: ['permission-denied'],
          context: {
            route: '/censo',
            button: 'Reintentar sincronizacion',
          },
        },
      ],
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: 'operational:sync:daily_record_remote_write:2026-05-21T14:03:00.000Z',
      source: 'operational',
      category: 'sync',
      severity: 'critical',
      status: 'open',
      operation: 'daily_record_remote_write',
      action: 'Reintentar sincronizacion',
      route: '/censo',
    });
    expect(events[1]).toMatchObject({
      id: 'local_error:err-1',
      source: 'local_error',
      category: 'local_error',
      severity: 'critical',
      status: 'open',
      message: 'No se pudo guardar el censo diario',
      module: 'Censo diario',
      action: 'Guardar dia',
      route: '/censo',
    });
    expect(JSON.stringify(events)).not.toContain('No debe exponerse');
    expect(JSON.stringify(events)).not.toContain('11111111-1');
  });

  it('keeps sync truth selection successes visible for convergence monitoring', () => {
    const events = buildRecentUserHealthEvents({
      localErrors: [],
      operationalEvents: [
        {
          category: 'sync',
          status: 'success',
          runtimeState: 'recoverable',
          operation: 'sync_queue_truth_selected',
          timestamp: '2026-05-21T14:05:00.000Z',
          issues: [],
          context: {
            module: 'Censo diario',
            action: 'Verdad clinica aceptada',
            route: '/censo',
            clinicalDate: '2026-05-21',
            bedLabel: 'Cama R1',
            patientName: 'Paciente no debe exponerse',
            rut: '11111111-1',
            clientId: 'anon_a1b2c3',
            tabId: 'anon_d4e5f6',
          },
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'operational:sync:sync_queue_truth_selected:2026-05-21T14:05:00.000Z',
      source: 'operational',
      category: 'sync',
      severity: 'info',
      status: 'recovered',
      operation: 'sync_queue_truth_selected',
      module: 'Censo diario',
      action: 'Verdad clinica aceptada',
      route: '/censo',
      telemetryStatus: 'success',
      runtimeState: 'recoverable',
      contextSummary: [
        'fecha clinica: 2026-05-21',
        'cama: Cama R1',
        'module: Censo diario',
        'action: Verdad clinica aceptada',
      ],
    });
    expect(JSON.stringify(events)).not.toContain('Paciente no debe exponerse');
    expect(JSON.stringify(events)).not.toContain('11111111-1');
  });

  it('infers actionable local error origin from route when module is missing', () => {
    const events = buildRecentUserHealthEvents({
      localErrors: [
        {
          id: 'err-route',
          timestamp: '2026-05-21T14:02:00.000Z',
          message: 'Error al guardar cama',
          severity: 'high',
          userId: 'u1',
          userEmail: 'user@example.com',
          url: 'https://hhr.local/censo?debug=true',
          context: {
            operation: 'daily_record_bed_patch_failed',
            button: 'Guardar diagnostico',
            clinicalDate: '2026-05-21',
            bedLabel: 'Cama R1',
            fieldLabel: 'Diagnostico',
            patientName: 'No debe exponerse',
          },
        },
      ],
      operationalEvents: [],
    });

    expect(events[0]).toMatchObject({
      id: 'local_error:err-route',
      source: 'local_error',
      category: 'local_error',
      severity: 'critical',
      module: 'Censo diario',
      operation: 'daily_record_bed_patch_failed',
      action: 'Guardar diagnostico',
      route: '/censo',
      contextSummary: [
        'fecha clinica: 2026-05-21',
        'cama: Cama R1',
        'campo: Diagnostico',
        'button: Guardar diagnostico',
      ],
    });
    expect(JSON.stringify(events)).not.toContain('No debe exponerse');
  });

  it('keeps a broader default operational window for actionable health triage', () => {
    const events = buildRecentUserHealthEvents({
      localErrors: [],
      operationalEvents: Array.from({ length: 12 }, (_, index) => ({
        category: 'sync' as const,
        status: 'failed' as const,
        runtimeState: 'blocked' as const,
        operation: `daily_record_write_${index}`,
        timestamp: new Date(Date.parse('2026-05-21T14:00:00.000Z') + index * 1000).toISOString(),
        issues: [`permission-denied-${index}`],
        context: {
          module: 'Censo diario',
          action: 'Guardar dato',
          route: '/censo',
        },
      })),
    });

    expect(events).toHaveLength(12);
    expect(events[0]).toMatchObject({
      operation: 'daily_record_write_11',
      module: 'Censo diario',
      action: 'Guardar dato',
      route: '/censo',
    });
  });

  it('keeps non-sensitive clinical context for admin health triage', () => {
    const events = buildRecentUserHealthEvents({
      localErrors: [],
      operationalEvents: [
        {
          category: 'daily_record',
          status: 'failed',
          runtimeState: 'blocked',
          operation: 'daily_record_bed_patch_failed',
          timestamp: '2026-05-21T14:03:00.000Z',
          issues: ['Missing or insufficient permissions'],
          context: {
            module: 'Censo diario',
            action: 'Guardar diagnostico',
            route: '/censo',
            clinicalDate: '2026-05-21',
            bedId: 'R1',
            bedLabel: 'Cama R1',
            fieldKey: 'pathology',
            fieldLabel: 'Diagnostico',
            patchType: 'UPDATE_PATIENT',
            diagnosis: 'Neumonia no debe exponerse',
            patientName: 'Paciente no debe exponerse',
            rut: '11111111-1',
          },
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      source: 'operational',
      category: 'daily_record',
      severity: 'critical',
      status: 'open',
      operation: 'daily_record_bed_patch_failed',
      module: 'Censo diario',
      action: 'Guardar diagnostico',
      route: '/censo',
      contextSummary: [
        'fecha clinica: 2026-05-21',
        'cama: Cama R1',
        'campo: Diagnostico',
        'tipo: UPDATE_PATIENT',
      ],
    });
    expect(JSON.stringify(events)).not.toContain('Neumonia no debe exponerse');
    expect(JSON.stringify(events)).not.toContain('Paciente no debe exponerse');
    expect(JSON.stringify(events)).not.toContain('11111111-1');
  });

  it('adds actionable sync queue operations to recent health events', () => {
    const events = buildRecentUserHealthEvents({
      localErrors: [],
      operationalEvents: [],
      recentSyncOperations: [
        {
          id: 22,
          type: 'UPDATE_DAILY_RECORD',
          status: 'FAILED',
          retryCount: 0,
          timestamp: Date.parse('2026-05-21T14:01:00.000Z'),
          key: 'daily:2026-05-21',
          contexts: ['clinical', 'handoff'],
          origin: 'partial_update_retry',
          recoveryPolicy: 'mixed_clinical_priority',
          syncContract: {
            changedPaths: ['beds.R1.pathology'],
          },
          lastErrorCode: 'permission-denied',
          lastErrorCategory: 'authorization',
          lastErrorSeverity: 'high',
          lastErrorAction: 'Revisar permisos/reglas y sesión del usuario.',
          lastErrorAt: Date.parse('2026-05-21T14:04:00.000Z'),
          error: '[authorization/permission-denied] Missing or insufficient permissions',
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'sync_queue:22',
      source: 'operational',
      category: 'sync',
      severity: 'critical',
      status: 'open',
      timestamp: '2026-05-21T14:04:00.000Z',
      message: 'UPDATE_DAILY_RECORD fallida en cola local',
      operation: 'partial_update_retry',
      module: 'Censo diario / Entrega turno',
      action: 'Revisar permisos/reglas y sesión del usuario.',
      route: 'daily:2026-05-21',
      issues: ['authorization: permission-denied'],
      contextSummary: [
        'fecha clinica: 2026-05-21',
        'cama: Cama R1',
        'campo: Diagnostico',
        'tipo: UPDATE_DAILY_RECORD',
      ],
    });
    expect(JSON.stringify(events)).not.toContain('Diagnostico Firebase vigente');
    expect(JSON.stringify(events)).not.toContain('Paciente');
  });

  it('keeps generic sync queue context when no clinical patch path is available', () => {
    const events = buildRecentUserHealthEvents({
      localErrors: [],
      operationalEvents: [],
      recentSyncOperations: [
        {
          id: 23,
          type: 'UPDATE_DAILY_RECORD',
          status: 'FAILED',
          retryCount: 0,
          timestamp: Date.parse('2026-05-21T14:01:00.000Z'),
          key: 'daily:2026-05-21',
          contexts: ['clinical', 'handoff'],
          origin: 'partial_update_retry',
          recoveryPolicy: 'mixed_clinical_priority',
          lastErrorCode: 'permission-denied',
          lastErrorCategory: 'authorization',
          lastErrorSeverity: 'high',
          lastErrorAction: 'Revisar permisos/reglas y sesión del usuario.',
          lastErrorAt: Date.parse('2026-05-21T14:04:00.000Z'),
          error: '[authorization/permission-denied] Missing or insufficient permissions',
        },
      ],
    });

    expect(events[0]).toMatchObject({
      contextSummary: [
        'estado: FAILED',
        'reintentos: 0',
        'politica: mixed_clinical_priority',
        'contextos: clinical, handoff',
      ],
    });
  });
});
