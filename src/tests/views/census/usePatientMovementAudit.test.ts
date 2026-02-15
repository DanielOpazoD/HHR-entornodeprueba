import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePatientMovementAudit } from '@/features/census/hooks/usePatientMovementAudit';
import * as auditService from '@/services/admin/auditService';

vi.mock('@/services/admin/auditService', () => ({
  logPatientDischarge: vi.fn(),
  logPatientTransfer: vi.fn(),
}));

describe('usePatientMovementAudit', () => {
  it('logs all discharge audit entries', () => {
    const { result } = renderHook(() => usePatientMovementAudit());

    result.current.logDischargeEntries(
      [
        { bedId: 'R1', patientName: 'A', rut: '1-9', status: 'Vivo' },
        { bedId: 'R2', patientName: 'B', rut: '2-7', status: 'Fallecido' },
      ],
      '2025-01-01'
    );

    expect(auditService.logPatientDischarge).toHaveBeenCalledTimes(2);
    expect(auditService.logPatientDischarge).toHaveBeenNthCalledWith(
      1,
      'R1',
      'A',
      '1-9',
      'Vivo',
      '2025-01-01'
    );
    expect(auditService.logPatientDischarge).toHaveBeenNthCalledWith(
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

    expect(auditService.logPatientTransfer).toHaveBeenCalledTimes(1);
    expect(auditService.logPatientTransfer).toHaveBeenCalledWith(
      'R3',
      'Paciente T',
      '3-5',
      'Hospital Base',
      '2025-01-02'
    );
  });
});
