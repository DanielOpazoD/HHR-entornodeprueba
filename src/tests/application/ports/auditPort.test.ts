import { beforeEach, describe, expect, it, vi } from 'vitest';

const auditServiceMocks = vi.hoisted(() => ({
  getAuditLogs: vi.fn(),
  logAuditEvent: vi.fn(),
  logThrottledViewEvent: vi.fn(),
  logUserLogin: vi.fn(),
  logUserLogout: vi.fn(),
}));

const auditUtilsMocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(() => 'doctor@hospital.cl'),
}));

vi.mock('@/services/admin/auditService', () => auditServiceMocks);

vi.mock('@/services/admin/utils/auditUtils', () => auditUtilsMocks);

import { defaultAuditPort } from '@/application/ports/auditPort';

describe('defaultAuditPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditServiceMocks.logAuditEvent.mockResolvedValue(undefined);
    auditServiceMocks.logThrottledViewEvent.mockResolvedValue(undefined);
  });

  it('routes patient admission audit through the core event logger with the legacy payload', async () => {
    await defaultAuditPort.logPatientAdmission(
      'R1',
      'Paciente Test',
      '11.111.111-1',
      'Neumonia',
      '2026-05-01'
    );

    expect(auditServiceMocks.logAuditEvent).toHaveBeenCalledWith(
      'doctor@hospital.cl',
      'PATIENT_ADMITTED',
      'patient',
      'R1',
      {
        patientName: 'Paciente Test',
        bedId: 'R1',
        pathology: 'Neumonia',
        rut: '11.111.111-1',
      },
      '11.111.111-1',
      '2026-05-01'
    );
  });

  it('routes patient discharge audit through the core event logger with the legacy payload', async () => {
    await defaultAuditPort.logPatientDischarge(
      'R1',
      'Paciente Test',
      '11.111.111-1',
      'ALTA_DOMICILIO',
      '2026-05-01'
    );

    expect(auditServiceMocks.logAuditEvent).toHaveBeenCalledWith(
      'doctor@hospital.cl',
      'PATIENT_DISCHARGED',
      'discharge',
      'R1',
      {
        patientName: 'Paciente Test',
        status: 'ALTA_DOMICILIO',
        bedId: 'R1',
        rut: '11.111.111-1',
      },
      '11.111.111-1',
      '2026-05-01'
    );
  });

  it('routes patient transfer audit through the core event logger with the legacy payload', async () => {
    await defaultAuditPort.logPatientTransfer(
      'R1',
      'Paciente Test',
      '11.111.111-1',
      'OTRO_HOSPITAL',
      '2026-05-01'
    );

    expect(auditServiceMocks.logAuditEvent).toHaveBeenCalledWith(
      'doctor@hospital.cl',
      'PATIENT_TRANSFERRED',
      'transfer',
      'R1',
      {
        patientName: 'Paciente Test',
        destination: 'OTRO_HOSPITAL',
        bedId: 'R1',
        rut: '11.111.111-1',
      },
      '11.111.111-1',
      '2026-05-01'
    );
  });

  it('routes patient view audit through the throttled core view logger', async () => {
    await defaultAuditPort.logPatientView('R1', 'Paciente Test', '11.111.111-1', '2026-05-01');

    expect(auditServiceMocks.logThrottledViewEvent).toHaveBeenCalledWith(
      'VIEW_PATIENT',
      'R1',
      {
        patientName: 'Paciente Test',
        bedId: 'R1',
        rut: '11.111.111-1',
      },
      '2026-05-01'
    );
  });
});
