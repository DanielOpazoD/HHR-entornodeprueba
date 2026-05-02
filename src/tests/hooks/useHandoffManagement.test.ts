import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';

const mockNotifySuccess = vi.fn();
const mockNotifyError = vi.fn();
const auditContextMocks = vi.hoisted(() => ({
  logDebouncedEvent: vi.fn(),
  logEvent: vi.fn(),
  logHandoffNovedadesModified: vi.fn(),
}));
const mockAuthContext = {
  currentUser: {
    uid: 'admin-1',
    email: 'admin@hospitalhangaroa.cl',
    displayName: 'Admin Test',
    role: 'admin',
  },
  role: 'admin',
};

// Mock dependencies before importing the hook
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({
    success: mockNotifySuccess,
    error: mockNotifyError,
  }),
}));

vi.mock('@/context/AuditContext', () => ({
  useAuditContext: () => ({
    logEvent: auditContextMocks.logEvent,
    logDebouncedEvent: auditContextMocks.logDebouncedEvent,
    logHandoffNovedadesModified: auditContextMocks.logHandoffNovedadesModified,
    userId: 'test-user',
  }),
}));

vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
  formatHandoffMessage: vi.fn().mockReturnValue('Test message'),
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/services/admin/attributionService', () => ({
  getAttributedAuthors: vi.fn().mockReturnValue(''),
}));

vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalOutcome: vi.fn(),
}));

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

vi.mock('@/context', () => ({
  useAuth: () => mockAuthContext,
}));

import { useHandoffManagement } from '@/hooks/useHandoffManagement';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';

describe('useHandoffManagement', () => {
  let mockRecord: DailyRecord;
  let mockSaveAndUpdate: (updatedRecord: DailyRecord) => Promise<void>;
  let mockPatchRecord: (partial: DailyRecordPatch) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthContext.currentUser = {
      uid: 'admin-1',
      email: 'admin@hospitalhangaroa.cl',
      displayName: 'Admin Test',
      role: 'admin',
    };
    mockAuthContext.role = 'admin';
    mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined);
    mockPatchRecord = vi.fn().mockResolvedValue(undefined);
    mockRecord = {
      date: '2024-12-28',
      beds: { R1: { patientName: 'Test' } },
      handoffDayChecklist: {},
      handoffNightChecklist: {},
      handoffNovedadesDayShift: '',
      handoffNovedadesNightShift: '',
      medicalHandoffNovedades: '',
    } as unknown as DailyRecord;
  });

  it('should return all management functions', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    expect(typeof result.current.updateHandoffChecklist).toBe('function');
    expect(typeof result.current.updateHandoffNovedades).toBe('function');
    expect(typeof result.current.updateMedicalSpecialtyNote).toBe('function');
    expect(typeof result.current.confirmMedicalSpecialtyNoChanges).toBe('function');
    expect(typeof result.current.updateHandoffStaff).toBe('function');
    expect(typeof result.current.updateMedicalSignature).toBe('function');
    expect(typeof result.current.updateMedicalHandoffDoctor).toBe('function');
    expect(typeof result.current.markMedicalHandoffAsSent).toBe('function');
    expect(typeof result.current.ensureMedicalHandoffSignatureLink).toBe('function');
    expect(typeof result.current.sendMedicalHandoff).toBe('function');
  });

  it('should not update checklist when record is null', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(null, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffChecklist('day', 'checked', true);
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
  });

  it('should update day checklist', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffChecklist('day', 'checked', true);
    });

    expect(mockPatchRecord).toHaveBeenCalled();
  });

  it('should update night checklist', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffChecklist('night', 'checked', true);
    });

    expect(mockPatchRecord).toHaveBeenCalled();
  });

  it('should update novedades for day shift', async () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      result.current.updateHandoffNovedades('day', 'Test novedades');
    });

    expect(mockPatchRecord).toHaveBeenCalled();
    await waitFor(() => {
      expect(auditContextMocks.logHandoffNovedadesModified).toHaveBeenCalledWith(
        'day',
        'Test novedades',
        '',
        '2024-12-28',
        ''
      );
    });
    expect(auditContextMocks.logDebouncedEvent).not.toHaveBeenCalledWith(
      'HANDOFF_NOVEDADES_MODIFIED',
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it('should update specialty medical handoff and refresh legacy summary', async () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.updateMedicalSpecialtyNote('cirugia', 'Paciente estable', {
        uid: 'doctor-1',
        displayName: 'Dr. Cirugía',
        email: 'cirugia@hospitalhangaroa.cl',
        role: 'doctor_urgency',
      });
    });

    // Implementation now uses patchRecord instead of saveAndUpdate
    expect(mockPatchRecord).toHaveBeenCalled();
  });

  it('blocks specialist edits for previous-day medical handoff records', async () => {
    mockAuthContext.currentUser = {
      uid: 'specialist-1',
      email: 'specialist@hospitalhangaroa.cl',
      displayName: 'Especialista',
      role: 'doctor_specialist',
    };
    mockAuthContext.role = 'doctor_specialist';
    mockRecord.date = '2024-12-27';

    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.updateMedicalSpecialtyNote('cirugia', 'No debería guardar', {
        uid: 'specialist-1',
        displayName: 'Especialista',
        email: 'specialist@hospitalhangaroa.cl',
        role: 'doctor_specialist',
      });
    });

    expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    expect(mockNotifyError).toHaveBeenCalledWith(
      'Edición no permitida',
      'El médico especialista solo puede editar la entrega médica del día actual.'
    );
  });

  it('should confirm no changes for a specialty when no update was made today', async () => {
    mockRecord.medicalHandoffBySpecialty = {
      pediatria: {
        note: 'Sin requerimientos nuevos',
        createdAt: '2024-12-20T10:00:00.000Z',
        updatedAt: '2024-12-27T10:00:00.000Z',
        author: {
          uid: 'ped-1',
          displayName: 'Dra. Pediatría',
          email: 'pediatria@hospitalhangaroa.cl',
          specialty: 'pediatria',
        },
        version: 2,
      },
    };

    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.confirmMedicalSpecialtyNoChanges({
        specialty: 'pediatria',
        actor: {
          uid: 'admin-1',
          displayName: 'Admin',
          email: 'admin@hospitalhangaroa.cl',
          role: 'admin',
        },
        comment: 'Condición actual sin cambios',
      });
    });

    // Implementation now uses patchRecord instead of saveAndUpdate
    expect(mockPatchRecord).toHaveBeenCalled();
  });

  it('should update staff list', () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    act(() => {
      result.current.updateHandoffStaff('day', 'delivers', ['Nurse 1', 'Nurse 2']);
    });

    // Implementation now uses patchRecord instead of saveAndUpdate
    expect(mockPatchRecord).toHaveBeenCalled();
  });

  it('should mark medical handoff as sent', async () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.markMedicalHandoffAsSent('Dr. Test');
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        medicalHandoffDoctor: 'Dr. Test',
        medicalHandoffSentAt: expect.any(String),
        medicalHandoffSentAtByScope: expect.objectContaining({
          all: expect.any(String),
        }),
      })
    );
  });

  it('should scope sent timestamp when sending filtered medical handoff', async () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.markMedicalHandoffAsSent('Dr. UPC', 'upc');
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        medicalHandoffDoctor: 'Dr. UPC',
        medicalHandoffSentAtByScope: expect.objectContaining({
          upc: expect.any(String),
        }),
      })
    );
  });

  it('should create and persist a signature token before returning the share link', async () => {
    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    let link = '';
    await act(async () => {
      const outcome = await result.current.ensureMedicalHandoffSignatureLink('upc');
      link = outcome.data?.handoffUrl || '';
    });

    expect(mockPatchRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        medicalSignatureLinkTokenByScope: expect.objectContaining({
          upc: expect.any(String),
        }),
      })
    );
    expect(link).toContain('mode=signature');
    expect(link).toContain('scope=upc');
    expect(link).toContain('token=');
  });

  it('returns a failed outcome when specialist tries to generate signature link for previous day', async () => {
    mockAuthContext.currentUser = {
      uid: 'specialist-1',
      email: 'specialist@hospitalhangaroa.cl',
      displayName: 'Especialista',
      role: 'doctor_specialist',
    };
    mockAuthContext.role = 'doctor_specialist';
    mockRecord.date = '2024-12-27';

    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    let outcome: ApplicationOutcome<{ handoffUrl: string } | null> | undefined;
    await act(async () => {
      outcome = await result.current.ensureMedicalHandoffSignatureLink('all');
    });

    expect(outcome?.status).toBe('failed');
    expect(outcome?.issues[0]?.kind).toBe('permission');
    expect(mockPatchRecord).not.toHaveBeenCalled();
  });

  it('does not mark the handoff as sent when WhatsApp delivery fails', async () => {
    mockRecord.medicalHandoffDoctor = 'Dr. Error';
    vi.mocked(whatsappService.sendWhatsAppMessage).mockResolvedValueOnce({
      success: false,
      error: 'Falla remota',
    });

    const { result } = renderHook(() =>
      useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.sendMedicalHandoff('Template content', 'group-xyz');
    });

    expect(mockPatchRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({
        medicalHandoffSentAt: expect.any(String),
      })
    );
    expect(recordOperationalOutcome).toHaveBeenCalledWith(
      'handoff',
      'send_medical_handoff',
      expect.objectContaining({ status: 'failed' }),
      expect.objectContaining({
        date: mockRecord.date,
        context: expect.objectContaining({ targetGroupId: 'group-xyz' }),
      })
    );
    expect(mockNotifyError).toHaveBeenCalledWith('Error al enviar', 'Falla remota');
  });

  it('reports an error when attempting to send without an active record', async () => {
    const { result } = renderHook(() =>
      useHandoffManagement(null, mockSaveAndUpdate, mockPatchRecord)
    );

    await act(async () => {
      await result.current.sendMedicalHandoff('Template content', 'group-xyz');
    });

    expect(mockNotifyError).toHaveBeenCalledWith(
      'Error al enviar',
      'No hay entrega médica disponible para enviar.'
    );
    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'handoff',
        status: 'failed',
        operation: 'send_medical_handoff',
      })
    );
  });
});
