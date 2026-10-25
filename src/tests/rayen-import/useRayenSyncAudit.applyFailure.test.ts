import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdmissionDatePolicyViolationError } from '@/application/patient-flow/admissionDatePolicy';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { buildRayenSyncDiagnosticReport } from '@/features/rayen-import/domain/rayenSyncDiagnosticReport';
import { RayenSyncEventSchema } from '@/schemas/zod/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('failed structural synchronization diagnostics', () => {
  const persistFailure = async (error: unknown) => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = {
      current: DataFactory.createMockDailyRecord('2026-10-21'),
    };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador sintético',
        createId: () => 'run-failure',
      })
    );
    act(() => {
      result.current.startRun();
    });
    await act(async () => {
      await result.current.failRun('apply_failed', 'run-failure', error);
    });
    const patch = patchDailyRecord.mock.calls.at(-1)?.[0]?.partial;
    return buildRayenSyncDiagnosticReport([RayenSyncEventSchema.parse(patch.rayenSyncHistory[0])]);
  };

  it('preserves the rejected case and both dates through persistence, schema and copied report', async () => {
    const report = await persistFailure(
      new AdmissionDatePolicyViolationError('RAW_SECRET', [
        {
          path: 'beds.R2.clinicalCrib',
          patientName: 'Paciente sintético del intento',
          rut: 'TEST-DOCUMENT',
          message: 'RAW_SECRET',
          currentAdmissionDate: '2026-10-07',
          attemptedAdmissionDate: '2026-10-08',
          firstSeenDate: '2026-10-07',
        },
      ])
    );
    expect(report.attempts[0]).toMatchObject({
      status: 'failed',
      structureConfirmed: false,
      changes: null,
      clinicalCoverage: null,
    });
    expect(report.attempts[0].issues[0]).toMatchObject({
      code: 'HHR-SYNC-1/census/admission-date-policy',
      bedId: 'C-R2',
      patientName: 'Paciente sintético del intento',
      document: 'TEST-DOCUMENT',
      censusDate: '2026-10-21',
      source: 'hhr/admission-date-policy',
    });
    expect(report.attempts[0].issues[0].detail).toContain('Fecha guardada: 2026-10-07');
    expect(report.attempts[0].issues[0].detail).toContain('Fecha propuesta: 2026-10-08');
    expect(JSON.stringify(report)).not.toContain('RAW_SECRET');
  });

  it('records the failed stage without persisting an arbitrary server exception', async () => {
    const report = await persistFailure(new Error('permission-denied SECRET_URL_BEARER'));
    expect(report.attempts[0].issues[0]).toMatchObject({
      code: 'HHR-SYNC-1/census/structural-write-rejected',
      patientName: null,
      document: null,
      source: 'hhr/structural-persistence',
    });
    expect(report.attempts[0].issues[0].detail).toContain('permission_denied');
    expect(JSON.stringify(report)).not.toContain('SECRET_URL_BEARER');
  });
});
