import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePatientMovementAudit } from '@/features/census/hooks/usePatientMovementAudit';
import { useAuditContext } from '@/context/AuditContext';

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: vi.fn(),
}));

describe('usePatientMovementAudit', () => {
  const mockLogEvent = vi.fn();
  const mockLogPatientDischarge = vi.fn();
  const mockLogPatientTransfer = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuditContext).mockReturnValue({
      logEvent: mockLogEvent,
      logPatientDischarge: mockLogPatientDischarge,
      logPatientTransfer: mockLogPatientTransfer,
      userId: 'auditor@hospital.cl',
    } as unknown as ReturnType<typeof useAuditContext>);
  });

  it('logs all discharge audit entries', () => {
    const { result } = renderHook(() => usePatientMovementAudit());

    result.current.logDischargeEntries(
      [
        { bedId: 'R1', patientName: 'A', rut: '1-9', status: 'Vivo' },
        { bedId: 'R2', patientName: 'B', rut: '2-7', status: 'Fallecido' },
      ],
      '2025-01-01'
    );

    expect(mockLogPatientDischarge).toHaveBeenCalledTimes(2);
    expect(mockLogPatientDischarge).toHaveBeenNthCalledWith(
      1,
      'R1',
      'A',
      '1-9',
      'Vivo',
      '2025-01-01'
    );
    expect(mockLogPatientDischarge).toHaveBeenNthCalledWith(
      2,
      'R2',
      'B',
      '2-7',
      'Fallecido',
      '2025-01-01'
    );
  });

  it('logs transfer audit entry', () => {
    const { result } = renderHook(() => usePatientMovementAudit());

    result.current.logTransferEntry(
      {
        bedId: 'R3',
        patientName: 'Paciente T',
        rut: '3-5',
        receivingCenter: 'Hospital Base',
      },
      '2025-01-02'
    );

    expect(mockLogPatientTransfer).toHaveBeenCalledTimes(1);
    expect(mockLogPatientTransfer).toHaveBeenCalledWith(
      'R3',
      'Paciente T',
      '3-5',
      'Hospital Base',
      '2025-01-02'
    );
  });

  it('logs discharge undo as an explicit patient modification audit entry', () => {
    const { result } = renderHook(() => usePatientMovementAudit());

    result.current.logDischargeUndoEntry(
      {
        dischargeId: 'd-1',
        bedId: 'R1',
        patientName: 'Paciente Reingresado',
        rut: '4-3',
      },
      '2025-01-03'
    );

    expect(mockLogEvent).toHaveBeenCalledWith(
      'PATIENT_MODIFIED',
      'patient',
      'R1',
      expect.objectContaining({
        clinicalEvent: 'Reversión de alta',
        movementKind: 'undo_discharge',
        dischargeId: 'd-1',
        restoredBed: 'R1',
        patientName: 'Paciente Reingresado',
      }),
      '4-3',
      '2025-01-03'
    );
  });

  it('logs discharge diagnosis changes as a legal clinical event', () => {
    const { result } = renderHook(() => usePatientMovementAudit());

    result.current.logDischargeDiagnosisChange(
      {
        movementId: 'd-1',
        entityType: 'discharge',
        patientName: 'Paciente Egreso',
        rut: '5-1',
        movementLabel: 'Alta',
        previousDiagnosis: 'Diagnostico inicial',
        nextDiagnosis: 'Diagnostico final',
        clinicalEpisodeId: 'episode-1',
      },
      '2025-01-04'
    );

    expect(mockLogEvent).toHaveBeenCalledWith(
      'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED',
      'discharge',
      'd-1',
      expect.objectContaining({
        clinicalEvent: 'Actualización de diagnóstico de egreso',
        patientName: 'Paciente Egreso',
        movementId: 'd-1',
        movementLabel: 'Alta',
        clinicalEpisodeId: 'episode-1',
        changes: {
          diagnosis: {
            old: 'Diagnostico inicial',
            new: 'Diagnostico final',
          },
        },
      }),
      '5-1',
      '2025-01-04'
    );
  });

  it('logs an attributable egreso reclassification with its lineage', () => {
    const { result } = renderHook(() => usePatientMovementAudit());

    result.current.logDischargeReclassification(
      {
        movementId: 'reclassified:d-1:transfer',
        previousMovementId: 'd-1',
        patientName: 'Paciente Egreso',
        rut: '5-1',
        from: 'Alta domicilio',
        to: 'Traslado',
        lineageId: 'd-1',
        clinicalEpisodeId: 'episode-1',
      },
      '2025-01-04'
    );

    expect(mockLogEvent).toHaveBeenCalledWith(
      'PATIENT_DISCHARGE_RECLASSIFIED',
      'patient',
      'reclassified:d-1:transfer',
      expect.objectContaining({
        clinicalEvent: 'Reclasificación de egreso',
        previousMovementId: 'd-1',
        from: 'Alta domicilio',
        to: 'Traslado',
        lineageId: 'd-1',
      }),
      '5-1',
      '2025-01-04'
    );
    expect(result.current.actor).toBe('auditor@hospital.cl');
  });
});
