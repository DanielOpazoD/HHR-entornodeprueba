import { act, renderHook, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { executeFetchAuditLogs } from '@/application/audit/fetchAuditLogsUseCase';
import { useAuditData } from '@/hooks/useAuditData';
import { useAuditWorker } from '@/hooks/useAuditWorker';
import * as auditWorkerLogic from '@/services/admin/auditWorkerLogic';
import type { AuditLogEntry, WorkerFilterParams } from '@/types/auditLogTypes';

vi.mock('@/application/audit/fetchAuditLogsUseCase', () => ({
  executeFetchAuditLogs: vi.fn(),
}));

vi.mock('@/services/admin/auditConstants', () => ({
  AUDIT_ACTION_LABELS: {
    CONFLICT_AUTO_MERGED: 'Conflicto Auto-Resuelto',
    PATIENT_DIAGNOSIS_CHANGED: 'Cambio de Diagnóstico',
    VIEW_PATIENT: 'Visualización de Ficha',
  },
  CRITICAL_ACTIONS: ['PATIENT_DIAGNOSIS_CHANGED'],
  IMPORTANT_ACTIONS: [],
}));

vi.mock('@/hooks/useAuditWorker', () => ({
  useAuditWorker: vi.fn(),
}));

const baseLog = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
  id: 'audit-1',
  action: 'PATIENT_DIAGNOSIS_CHANGED',
  userId: 'user@hospitalhangaroa.cl',
  userDisplayName: 'Usuario Clinico',
  userUid: 'uid-1',
  timestamp: '2025-01-01T11:00:00Z',
  recordDate: '2025-01-01',
  entityType: 'patient',
  entityId: 'R1',
  patientIdentifier: '12.345.678-9',
  details: {
    patientName: 'Paciente Editado',
    rut: '12.345.678-9',
    bedId: 'R1',
  },
  ...overrides,
});

describe('useAuditData patient package intent filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(useAuditWorker).mockImplementation(() => {
      const [results, setResults] = useState({
        filteredLogs: [] as AuditLogEntry[],
        displayLogs: [] as AuditLogEntry[],
        stats: auditWorkerLogic.calculateAuditStats([], []),
      });

      const processData = useCallback((logs: AuditLogEntry[], params: WorkerFilterParams) => {
        const filtered = auditWorkerLogic.filterLogs(logs, params);
        setResults({
          filteredLogs: filtered,
          displayLogs: filtered,
          stats: auditWorkerLogic.calculateAuditStats(filtered, []),
        });
      }, []);

      return { results, isProcessing: false, processData };
    });
  });

  it('defaults patient packages to clinical operations and separates view/system tabs', async () => {
    vi.mocked(executeFetchAuditLogs).mockResolvedValue({
      status: 'success',
      issues: [],
      data: [
        baseLog({
          id: 'clinical-edit',
          details: {
            patientName: 'Paciente Editado',
            rut: '12.345.678-9',
            bedId: 'R1',
            changes: { diagnosis: { old: '', new: 'ICC' } },
          },
        }),
        baseLog({
          id: 'view-only',
          action: 'VIEW_PATIENT',
          timestamp: '2025-01-01T11:10:00Z',
          patientIdentifier: '44.444.444-4',
          details: {
            patientName: 'Paciente Visualizado',
            rut: '44.444.444-4',
            bedId: 'R2',
          },
        }),
        baseLog({
          id: 'conflict-only',
          action: 'CONFLICT_AUTO_MERGED',
          timestamp: '2025-01-01T11:20:00Z',
          patientIdentifier: '55.555.555-5',
          entityType: 'dailyRecord',
          entityId: '2025-01-01',
          details: {
            patientName: 'Paciente Conflicto',
            rut: '55.555.555-5',
            bedId: 'R3',
          },
        }),
      ],
    });

    const { result } = renderHook(() => useAuditData());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.filters.activePatientPackageIntent).toBe('CLINICAL_OPERATIONS');
    expect(result.current.patientPackageIntentOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'CLINICAL_OPERATIONS', count: 1 }),
        expect.objectContaining({ id: 'VIEW_ACTIVITY', count: 1 }),
        expect.objectContaining({ id: 'SYSTEM_SYNC', count: 1 }),
      ])
    );
    expect(result.current.patientPackages.map(pkg => pkg.patientName)).toEqual([
      'Paciente Editado',
    ]);

    act(() => result.current.setActivePatientPackageIntent('VIEW_ACTIVITY'));
    expect(result.current.patientPackages.map(pkg => pkg.patientName)).toEqual([
      'Paciente Visualizado',
    ]);

    act(() => result.current.setActivePatientPackageIntent('SYSTEM_SYNC'));
    expect(result.current.patientPackages.map(pkg => pkg.patientName)).toEqual([
      'Paciente Conflicto',
    ]);
  });
});
