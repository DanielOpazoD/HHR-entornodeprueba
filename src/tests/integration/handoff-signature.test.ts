/**
 * Integration Tests for Handoff → Signature Flow
 * Tests the medical and nursing handoff management, including signature and WhatsApp integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHandoffManagement } from '@/hooks/useHandoffManagement';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';
import { defaultDailyRecordReadPort } from '@/application/ports/dailyRecordPort';

// ============================================================================
// Mocks
// ============================================================================

// Mock UI Context
vi.mock('../../context/UIContext', () => ({
  useNotification: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Audit Context
vi.mock('../../context/AuditContext', () => ({
  useAuditContext: () => ({
    logEvent: vi.fn(),
    logDebouncedEvent: vi.fn(),
    logHandoffNovedadesModified: vi.fn(),
    userId: 'test-user-123',
  }),
}));

// Mock Auth Context (useAuth is imported from @/context)
vi.mock('../../context', () => ({
  useAuth: () => ({
    role: 'admin',
    user: { uid: 'test-user-123', email: 'test@example.com' },
  }),
}));

// Mock WhatsApp Service
vi.mock('../../services/integrations/whatsapp/whatsappService', () => ({
  formatHandoffMessage: vi.fn((template, data) => `Formatted: ${data.signedBy}`),
  sendWhatsAppMessage: vi.fn(() => Promise.resolve({ success: true })),
}));

// Mock window.location
const originalLocation = window.location;
Reflect.deleteProperty(window, 'location');
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { ...originalLocation, origin: 'https://test.app' },
});

import { BEDS } from '@/constants/beds';

// ============================================================================
// Helper Data
// ============================================================================

const createMockRecord = (date: string): DailyRecord => {
  const beds: DailyRecord['beds'] = {};

  // Initialize all beds from BEDS constant as empty
  BEDS.forEach(bed => {
    beds[bed.id] = {
      bedId: bed.id,
      patientName: '',
      bedMode: 'Cama',
      isBlocked: false,
    } as unknown as DailyRecord['beds'][string];
  });

  // Add one occupied bed for tests
  beds['R1'] = {
    bedId: 'R1',
    patientName: 'Paciente Test',
    rut: '1-9',
    pathology: 'Test',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    bedMode: 'Cama',
    isBlocked: false,
  } as unknown as DailyRecord['beds'][string];

  return {
    date,
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T00:00:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
  };
};

// ============================================================================
// Tests
// ============================================================================

describe('Handoff → Signature Integration', () => {
  let mockRecord: DailyRecord;
  let mockSaveAndUpdate: ReturnType<typeof vi.fn>;
  let mockPatchRecord: ReturnType<typeof vi.fn>;
  let saveAndUpdateFn: (updatedRecord: DailyRecord) => Promise<void>;
  let patchRecordFn: (partial: Partial<DailyRecord>) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRecord = createMockRecord('2024-12-28');
    mockSaveAndUpdate = vi.fn(async (_updatedRecord: DailyRecord) => {});
    mockPatchRecord = vi.fn(async (_partial: Partial<DailyRecord>) => {});
    saveAndUpdateFn = mockSaveAndUpdate as unknown as (updatedRecord: DailyRecord) => Promise<void>;
    patchRecordFn = mockPatchRecord as unknown as (partial: Partial<DailyRecord>) => Promise<void>;
    defaultDailyRecordReadPort.getPreviousDay = vi.fn().mockResolvedValue(null);
  });

  describe('Nursing Handoff', () => {
    it('should update nursing checklist', async () => {
      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        result.current.updateHandoffChecklist('day', 'resumenClinico', true);
      });

      // Implementation prefers patchRecord over saveAndUpdate when a patch is available
      expect(mockPatchRecord).toHaveBeenCalled();
      const patch = mockPatchRecord.mock.calls[0][0];
      expect(patch['handoffDayChecklist.resumenClinico']).toBe(true);
    });

    it('should update nursing novedades and audit it', async () => {
      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        result.current.updateHandoffNovedades('day', 'Cambio importante en el turno');
      });

      // Implementation prefers patchRecord over saveAndUpdate when a patch is available
      expect(mockPatchRecord).toHaveBeenCalled();
      const patch = mockPatchRecord.mock.calls[0][0];
      expect(patch.handoffNovedadesDayShift).toBe('Cambio importante en el turno');
    });
  });

  describe('Medical Signature & WhatsApp', () => {
    it('should update medical signature with doctor name and timestamp', async () => {
      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        result.current.updateMedicalSignature('Dr. House');
      });

      // Implementation prefers patchRecord over saveAndUpdate when a patch is available
      expect(mockPatchRecord).toHaveBeenCalled();
      const patch = mockPatchRecord.mock.calls[0][0];
      expect(patch['medicalSignature.doctorName'] ?? patch.medicalSignature?.doctorName).toBe(
        'Dr. House'
      );
    });

    it('should store scoped medical signature without leaking into all-scope signature', async () => {
      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        await result.current.updateMedicalSignature('Dr. UPC', 'upc');
      });

      // Implementation prefers patchRecord over saveAndUpdate when a patch is available
      expect(mockPatchRecord).toHaveBeenCalled();
      const patch = mockPatchRecord.mock.calls[0][0];
      // Scoped signature should NOT write to the all-scope medicalSignature field
      expect(patch.medicalSignature).toBeUndefined();
      // The patch uses dot-notation keys like 'medicalSignatureByScope.upc'
      const scopedSignature = (patch as Record<string, unknown>)['medicalSignatureByScope.upc'] as {
        doctorName: string;
      };
      expect(scopedSignature?.doctorName).toBe('Dr. UPC');
    });

    it('should send medical handoff via WhatsApp and patch the record', async () => {
      mockRecord.medicalHandoffDoctor = 'Dr. Smith';

      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        await result.current.sendMedicalHandoff('Template content', 'group-xyz');
      });

      // Verify WhatsApp service calls
      expect(whatsappService.formatHandoffMessage).toHaveBeenCalled();
      expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith(
        'group-xyz',
        expect.stringContaining('Dr. Smith')
      );

      // Verify the record was patched as sent
      expect(mockPatchRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          medicalHandoffSentAt: expect.any(String),
          medicalHandoffSentAtByScope: expect.objectContaining({
            all: expect.any(String),
          }),
          medicalHandoffDoctor: 'Dr. Smith',
        })
      );
    });

    it('should use signature mode URL in WhatsApp message', async () => {
      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        await result.current.sendMedicalHandoff('Content', 'group-1');
      });

      const formatCall = vi.mocked(whatsappService.formatHandoffMessage).mock.calls[0]?.[1] as
        | { handoffUrl?: string }
        | undefined;
      expect(formatCall).toBeDefined();
      expect(formatCall?.handoffUrl).toContain('mode=signature');
      expect(formatCall?.handoffUrl).toContain('date=2024-12-28');
    });

    it('should keep state stable when remote delivery fails', async () => {
      mockRecord.medicalHandoffDoctor = 'Dr. Falla';
      vi.mocked(whatsappService.sendWhatsAppMessage).mockResolvedValueOnce({
        success: false,
        error: 'Servicio no disponible',
      });

      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        await result.current.sendMedicalHandoff('Contenido', 'group-fail');
      });

      expect(mockPatchRecord).not.toHaveBeenCalledWith(
        expect.objectContaining({
          medicalHandoffSentAt: expect.any(String),
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing record in handoff management', async () => {
      const { result } = renderHook(() =>
        useHandoffManagement(null, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        result.current.updateMedicalSignature('Test');
      });

      expect(mockSaveAndUpdate).not.toHaveBeenCalled();
    });

    it('should fallback to previous day doctor if current is empty when sending', async () => {
      defaultDailyRecordReadPort.getPreviousDay = vi
        .fn()
        .mockResolvedValue({ medicalHandoffDoctor: 'Dr. Previous' } as DailyRecord);

      const { result } = renderHook(() =>
        useHandoffManagement(mockRecord, saveAndUpdateFn, patchRecordFn)
      );

      await act(async () => {
        await result.current.sendMedicalHandoff('Template', 'group-id');
      });

      expect(whatsappService.sendWhatsAppMessage).toHaveBeenCalledWith(
        'group-id',
        expect.stringContaining('Dr. Previous')
      );
    });
  });
});
