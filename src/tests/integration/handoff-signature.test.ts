/**
 * Integration Tests for Handoff → Signature Flow
 * Tests the medical and nursing handoff management, including signature and WhatsApp integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHandoffManagement } from '@/hooks/useHandoffManagement';
import { DailyRecord, Specialty, PatientStatus } from '@/types';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';

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
        userId: 'test-user-123',
    }),
}));

// Mock WhatsApp Service
vi.mock('../../services/integrations/whatsapp/whatsappService', () => ({
    formatHandoffMessage: vi.fn((template, data) => `Formatted: ${data.signedBy}`),
    sendWhatsAppMessage: vi.fn(() => Promise.resolve({ success: true })),
}));

// Mock window.location
const originalLocation = window.location;
delete (window as any).location;
(window as any).location = { ...originalLocation, origin: 'https://test.app' };

import { BEDS } from '@/constants';

// ============================================================================
// Helper Data
// ============================================================================

const createMockRecord = (date: string): DailyRecord => {
    const beds: Record<string, any> = {};

    // Initialize all beds from BEDS constant as empty
    BEDS.forEach(bed => {
        beds[bed.id] = {
            bedId: bed.id,
            patientName: '',
            bedMode: 'Cama',
            isBlocked: false,
        };
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
    };

    return {
        date,
        beds,
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString(),
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
    let mockSaveAndUpdate: any;
    let mockPatchRecord: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRecord = createMockRecord('2024-12-28');
        mockSaveAndUpdate = vi.fn(() => Promise.resolve());
        mockPatchRecord = vi.fn(() => Promise.resolve());
    });

    describe('Nursing Handoff', () => {
        it('should update nursing checklist', async () => {
            const { result } = renderHook(() =>
                useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
            );

            await act(async () => {
                result.current.updateHandoffChecklist('day', 'resumenClinico', true);
            });

            expect(mockSaveAndUpdate).toHaveBeenCalled();
            const updated = mockSaveAndUpdate.mock.calls[0][0];
            expect(updated.handoffDayChecklist.resumenClinico).toBe(true);
        });

        it('should update nursing novedades and audit it', async () => {
            const { result } = renderHook(() =>
                useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
            );

            await act(async () => {
                result.current.updateHandoffNovedades('day', 'Cambio importante en el turno');
            });

            expect(mockSaveAndUpdate).toHaveBeenCalled();
            const updated = mockSaveAndUpdate.mock.calls[0][0];
            expect(updated.handoffNovedadesDayShift).toBe('Cambio importante en el turno');
        });
    });

    describe('Medical Signature & WhatsApp', () => {
        it('should update medical signature with doctor name and timestamp', async () => {
            const { result } = renderHook(() =>
                useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
            );

            await act(async () => {
                result.current.updateMedicalSignature('Dr. House');
            });

            expect(mockSaveAndUpdate).toHaveBeenCalled();
            const updated = mockSaveAndUpdate.mock.calls[0][0];
            expect(updated.medicalSignature.doctorName).toBe('Dr. House');
            expect(updated.medicalSignature.signedAt).toBeDefined();
        });

        it('should send medical handoff via WhatsApp and patch the record', async () => {
            mockRecord.medicalHandoffDoctor = 'Dr. Smith';

            const { result } = renderHook(() =>
                useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
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
            expect(mockPatchRecord).toHaveBeenCalledWith(expect.objectContaining({
                medicalHandoffSentAt: expect.any(String),
                medicalHandoffDoctor: 'Dr. Smith'
            }));
        });

        it('should use signature mode URL in WhatsApp message', async () => {
            const { result } = renderHook(() =>
                useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
            );

            await act(async () => {
                await result.current.sendMedicalHandoff('Content', 'group-1');
            });

            const formatCall = (whatsappService.formatHandoffMessage as any).mock.calls[0][1];
            expect(formatCall.handoffUrl).toContain('mode=signature');
            expect(formatCall.handoffUrl).toContain('date=2024-12-28');
        });
    });

    describe('Edge Cases', () => {
        it('should handle missing record in handoff management', async () => {
            const { result } = renderHook(() =>
                useHandoffManagement(null, mockSaveAndUpdate, mockPatchRecord)
            );

            await act(async () => {
                result.current.updateMedicalSignature('Test');
            });

            expect(mockSaveAndUpdate).not.toHaveBeenCalled();
        });

        it('should fallback to previous day doctor if current is empty when sending', async () => {
            // We need a way to mock getPreviousDay from DailyRecordRepository
            // Since it's an import, we mock the whole module
            vi.mock('../../services/repositories/DailyRecordRepository', async (importOriginal) => {
                const actual: any = await importOriginal();
                return {
                    ...actual,
                    getPreviousDay: vi.fn(() => ({ medicalHandoffDoctor: 'Dr. Previous' }))
                };
            });

            const { result } = renderHook(() =>
                useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
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
