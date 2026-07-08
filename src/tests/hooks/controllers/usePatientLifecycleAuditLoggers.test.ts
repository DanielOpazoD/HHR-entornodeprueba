import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { usePatientLifecycleAuditLoggers } from '@/hooks/controllers/usePatientLifecycleAuditLoggers';

const renderLoggers = () => {
  const logEvent = vi.fn();
  const { result } = renderHook(() => usePatientLifecycleAuditLoggers(logEvent));
  return { logEvent, loggers: result.current };
};

describe('usePatientLifecycleAuditLoggers', () => {
  it('logPatientAdmission emits PATIENT_ADMITTED with the bed-scoped details', () => {
    const { logEvent, loggers } = renderLoggers();
    loggers.logPatientAdmission('H5C1', 'Paciente Demo', '11.111.111-1', '2026-05-03');

    expect(logEvent).toHaveBeenCalledWith(
      'PATIENT_ADMITTED',
      'patient',
      'H5C1',
      { patientName: 'Paciente Demo', bedId: 'H5C1' },
      '11.111.111-1',
      '2026-05-03'
    );
  });

  it('logPatientDischarge emits PATIENT_DISCHARGED with status and rut details', () => {
    const { logEvent, loggers } = renderLoggers();
    loggers.logPatientDischarge('H5C2', 'Paciente A', '22.222.222-2', 'alta', '2026-05-03');

    expect(logEvent).toHaveBeenCalledWith(
      'PATIENT_DISCHARGED',
      'discharge',
      'H5C2',
      { patientName: 'Paciente A', status: 'alta', bedId: 'H5C2', rut: '22.222.222-2' },
      '22.222.222-2',
      '2026-05-03'
    );
  });

  it('logPatientTransfer emits PATIENT_TRANSFERRED with destination details', () => {
    const { logEvent, loggers } = renderLoggers();
    loggers.logPatientTransfer('H5C3', 'Paciente T', '33.333.333-3', 'HSV', '2026-05-03');

    expect(logEvent).toHaveBeenCalledWith(
      'PATIENT_TRANSFERRED',
      'transfer',
      'H5C3',
      { patientName: 'Paciente T', destination: 'HSV', bedId: 'H5C3', rut: '33.333.333-3' },
      '33.333.333-3',
      '2026-05-03'
    );
  });

  it('logPatientCleared emits PATIENT_CLEARED', () => {
    const { logEvent, loggers } = renderLoggers();
    loggers.logPatientCleared('H5C1', 'Paciente C', '44.444.444-4', '2026-05-03');

    expect(logEvent).toHaveBeenCalledWith(
      'PATIENT_CLEARED',
      'patient',
      'H5C1',
      { patientName: 'Paciente C', bedId: 'H5C1' },
      '44.444.444-4',
      '2026-05-03'
    );
  });

  it('logDailyRecordDeleted emits DAILY_RECORD_DELETED with date', () => {
    const { logEvent, loggers } = renderLoggers();
    loggers.logDailyRecordDeleted('2026-05-03');

    expect(logEvent).toHaveBeenCalledWith(
      'DAILY_RECORD_DELETED',
      'dailyRecord',
      '2026-05-03',
      { date: '2026-05-03' },
      undefined,
      '2026-05-03'
    );
  });

  it('logDailyRecordCreated emits DAILY_RECORD_CREATED including copiedFrom when present', () => {
    const { logEvent, loggers } = renderLoggers();
    loggers.logDailyRecordCreated('2026-05-03', '2026-05-02');

    expect(logEvent).toHaveBeenCalledWith(
      'DAILY_RECORD_CREATED',
      'dailyRecord',
      '2026-05-03',
      { date: '2026-05-03', copiedFrom: '2026-05-02' },
      undefined,
      '2026-05-03'
    );
  });

  it('logDailyRecordCreated leaves copiedFrom undefined when omitted', () => {
    const { logEvent, loggers } = renderLoggers();
    loggers.logDailyRecordCreated('2026-05-03');

    expect(logEvent).toHaveBeenCalledWith(
      'DAILY_RECORD_CREATED',
      'dailyRecord',
      '2026-05-03',
      { date: '2026-05-03', copiedFrom: undefined },
      undefined,
      '2026-05-03'
    );
  });
});
