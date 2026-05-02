import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAudit } from '@/hooks/useAudit';
import * as writeAuditUseCase from '@/application/audit/writeAuditEventUseCase';
import * as fetchAuditLogsUseCase from '@/application/audit/fetchAuditLogsUseCase';

vi.mock('@/application/audit/writeAuditEventUseCase', () => ({
  executeWriteAuditEvent: vi.fn().mockResolvedValue({
    status: 'success',
    data: null,
    issues: [],
  }),
}));

vi.mock('@/application/audit/fetchAuditLogsUseCase', () => ({
  executeFetchAuditLogs: vi.fn().mockResolvedValue({
    status: 'success',
    data: [],
    issues: [],
  }),
}));

describe('useAudit', () => {
  const testUserId = 'test-user-123';

  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('should return all audit functions', () => {
    const { result } = renderHook(() => useAudit(testUserId));

    expect(typeof result.current.logPatientAdmission).toBe('function');
    expect(typeof result.current.logPatientDischarge).toBe('function');
    expect(typeof result.current.logPatientTransfer).toBe('function');
    expect(typeof result.current.logPatientCleared).toBe('function');
    expect(typeof result.current.logDailyRecordDeleted).toBe('function');
    expect(typeof result.current.logDailyRecordCreated).toBe('function');
    expect(typeof result.current.logCudyrModified).toBe('function');
    expect(typeof result.current.logHandoffNovedadesModified).toBe('function');
    expect(typeof result.current.logMedicalHandoffModified).toBe('function');
    expect(typeof result.current.logNurseHandoffModified).toBe('function');
    expect(typeof result.current.logPatientView).toBe('function');
    expect(typeof result.current.logClinicalDocumentCreated).toBe('function');
    expect(typeof result.current.logClinicalDocumentEdited).toBe('function');
    expect(typeof result.current.logClinicalDocumentDeleted).toBe('function');
    expect(typeof result.current.logViewEvent).toBe('function');
    expect(typeof result.current.logEvent).toBe('function');
    expect(typeof result.current.logDebouncedEvent).toBe('function');
    expect(typeof result.current.fetchLogs).toBe('function');
    expect(typeof result.current.getActionLabel).toBe('function');
  });

  it('should log patient admission via use case', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logPatientAdmission('R1', 'John Doe', '12345678-9', '2024-12-28');
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'PATIENT_ADMITTED',
          entityType: 'patient',
          entityId: 'R1',
          patientRut: '12345678-9',
          recordDate: '2024-12-28',
        })
      );
    });
  });

  it('logs patient cleared through the write use case with the legacy payload', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logPatientCleared('R1', 'John Doe', '12345678-9', '2024-12-28');
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'PATIENT_CLEARED',
          entityType: 'patient',
          entityId: 'R1',
          details: { patientName: 'John Doe', bedId: 'R1' },
          patientRut: '12345678-9',
          recordDate: '2024-12-28',
        })
      );
    });
  });

  it('logs patient discharge through the write use case with the legacy payload', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logPatientDischarge(
        'R1',
        'John Doe',
        '12345678-9',
        'ALTA_DOMICILIO',
        '2024-12-28'
      );
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'PATIENT_DISCHARGED',
          entityType: 'discharge',
          entityId: 'R1',
          details: {
            patientName: 'John Doe',
            status: 'ALTA_DOMICILIO',
            bedId: 'R1',
            rut: '12345678-9',
          },
          patientRut: '12345678-9',
          recordDate: '2024-12-28',
        })
      );
    });
  });

  it('logs patient transfer through the write use case with the legacy payload', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logPatientTransfer(
        'R1',
        'John Doe',
        '12345678-9',
        'OTRO_HOSPITAL',
        '2024-12-28'
      );
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'PATIENT_TRANSFERRED',
          entityType: 'transfer',
          entityId: 'R1',
          details: {
            patientName: 'John Doe',
            destination: 'OTRO_HOSPITAL',
            bedId: 'R1',
            rut: '12345678-9',
          },
          patientRut: '12345678-9',
          recordDate: '2024-12-28',
        })
      );
    });
  });

  it('should log daily record created via use case', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logDailyRecordCreated('2024-12-28', '2024-12-27');
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'DAILY_RECORD_CREATED',
          entityType: 'dailyRecord',
          entityId: '2024-12-28',
          details: { date: '2024-12-28', copiedFrom: '2024-12-27' },
          patientRut: undefined,
          recordDate: '2024-12-28',
        })
      );
    });
  });

  it('logs daily record deleted through the write use case with the legacy payload', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logDailyRecordDeleted('2024-12-28');
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'DAILY_RECORD_DELETED',
          entityType: 'dailyRecord',
          entityId: '2024-12-28',
          details: { date: '2024-12-28' },
          patientRut: undefined,
          recordDate: '2024-12-28',
        })
      );
    });
  });

  it('logs CUDYR changes through the write use case with the legacy payload', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logCudyrModified(
        'R1',
        'John Doe',
        '12345678-9',
        'mobilization',
        3,
        1,
        '2024-12-28',
        'Author 1'
      );
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'CUDYR_MODIFIED',
          entityType: 'patient',
          entityId: 'R1',
          details: {
            patientName: 'John Doe',
            bedId: 'R1',
            lastField: 'mobilization',
            lastValue: 3,
            changes: {
              mobilization: { old: 1, new: 3 },
            },
          },
          patientRut: '12345678-9',
          recordDate: '2024-12-28',
          authors: 'Author 1',
        })
      );
    });
  });

  it('throttles repeated CUDYR changes for 15 minutes per bed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-12-28T10:00:00.000Z'));
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logCudyrModified(
        'R1',
        'John Doe',
        '12345678-9',
        'mobilization',
        3,
        1,
        '2024-12-28'
      );
    });
    await vi.dynamicImportSettled();

    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledTimes(1);

    act(() => {
      vi.setSystemTime(new Date('2024-12-28T10:14:59.000Z'));
      result.current.logCudyrModified(
        'R1',
        'John Doe',
        '12345678-9',
        'feeding',
        4,
        2,
        '2024-12-28'
      );
    });
    await vi.dynamicImportSettled();

    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledTimes(1);

    act(() => {
      vi.setSystemTime(new Date('2024-12-28T10:15:00.000Z'));
      result.current.logCudyrModified(
        'R1',
        'John Doe',
        '12345678-9',
        'feeding',
        4,
        2,
        '2024-12-28'
      );
    });
    await vi.dynamicImportSettled();

    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledTimes(2);
  });

  it('should fetch logs via use case', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    await act(async () => {
      await result.current.fetchLogs(50);
    });

    expect(fetchAuditLogsUseCase.executeFetchAuditLogs).toHaveBeenCalledWith({ limit: 50 });
  });

  it('logs clinical document creation through the write use case', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logClinicalDocumentCreated(
        'doc-1',
        'epicrisis',
        'Epicrisis',
        '11.111.111-1',
        '2026-05-01'
      );
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'CLINICAL_DOCUMENT_CREATED',
          entityType: 'clinicalDocument',
          entityId: 'doc-1',
          details: {
            documentId: 'doc-1',
            templateId: 'epicrisis',
            documentTitle: 'Epicrisis',
          },
          patientRut: '11.111.111-1',
          recordDate: '2026-05-01',
        })
      );
    });
  });

  it('logs clinical document deletion through the write use case', async () => {
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logClinicalDocumentDeleted(
        'doc-1',
        'epicrisis',
        'Epicrisis',
        '11.111.111-1',
        '2026-05-01'
      );
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          action: 'CLINICAL_DOCUMENT_DELETED',
          entityType: 'clinicalDocument',
          entityId: 'doc-1',
          details: {
            documentId: 'doc-1',
            templateId: 'epicrisis',
            documentTitle: 'Epicrisis',
          },
          patientRut: '11.111.111-1',
          recordDate: '2026-05-01',
        })
      );
    });
  });

  it('logs clinical document edits immediately but throttles repeats for 15 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T10:00:00.000Z'));
    const { result } = renderHook(() => useAudit(testUserId));

    act(() => {
      result.current.logClinicalDocumentEdited(
        'doc-1',
        'epicrisis',
        'Epicrisis',
        '11.111.111-1',
        '2026-05-01'
      );
    });
    await vi.dynamicImportSettled();

    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledTimes(1);
    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: testUserId,
        action: 'CLINICAL_DOCUMENT_EDITED',
        entityType: 'clinicalDocument',
        entityId: 'doc-1',
        details: {
          documentId: 'doc-1',
          templateId: 'epicrisis',
          documentTitle: 'Epicrisis',
        },
        patientRut: '11.111.111-1',
        recordDate: '2026-05-01',
      })
    );

    act(() => {
      vi.setSystemTime(new Date('2026-05-01T10:14:59.000Z'));
      result.current.logClinicalDocumentEdited(
        'doc-1',
        'epicrisis',
        'Epicrisis actualizada',
        '11.111.111-1',
        '2026-05-01'
      );
    });
    await vi.dynamicImportSettled();

    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledTimes(1);

    act(() => {
      vi.setSystemTime(new Date('2026-05-01T10:15:00.000Z'));
      result.current.logClinicalDocumentEdited(
        'doc-1',
        'epicrisis',
        'Epicrisis actualizada',
        '11.111.111-1',
        '2026-05-01'
      );
    });
    await vi.dynamicImportSettled();

    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledTimes(2);
  });

  it('throttles repeated view events before reaching the write use case', async () => {
    const { result } = renderHook(() => useAudit('doctor@hospital.cl'));

    act(() => {
      result.current.logViewEvent(
        'VIEW_CUDYR',
        'dailyRecord',
        '2026-05-01',
        { view: 'cudyr' },
        undefined,
        '2026-05-01'
      );
      result.current.logViewEvent(
        'VIEW_CUDYR',
        'dailyRecord',
        '2026-05-01',
        { view: 'cudyr' },
        undefined,
        '2026-05-01'
      );
    });

    await waitFor(() => {
      expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledTimes(1);
    });
    expect(writeAuditUseCase.executeWriteAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'VIEW_CUDYR',
        entityType: 'dailyRecord',
        entityId: '2026-05-01',
      })
    );
  });
});
