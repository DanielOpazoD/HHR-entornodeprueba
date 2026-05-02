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
});
