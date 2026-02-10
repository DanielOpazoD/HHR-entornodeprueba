import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock dependencies before importing the hook
vi.mock('@/context/UIContext', () => ({
    useNotification: () => ({
        success: vi.fn(),
        error: vi.fn(),
    }),
}));

vi.mock('@/context/AuditContext', () => ({
    useAuditContext: () => ({
        logEvent: vi.fn(),
        logDebouncedEvent: vi.fn(),
        userId: 'test-user',
    }),
}));

vi.mock('@/services/repositories/DailyRecordRepository', () => ({
    getPreviousDay: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/services/integrations/whatsapp/whatsappService', () => ({
    formatHandoffMessage: vi.fn().mockReturnValue('Test message'),
    sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/services/admin/attributionService', () => ({
    getAttributedAuthors: vi.fn().mockReturnValue([]),
}));

import { useHandoffManagement } from '@/hooks/useHandoffManagement';
import { DailyRecord, DailyRecordPatch } from '@/types';

describe('useHandoffManagement', () => {
    let mockRecord: DailyRecord;
    let mockSaveAndUpdate: (updatedRecord: DailyRecord) => Promise<void>;
    let mockPatchRecord: (partial: DailyRecordPatch) => Promise<void>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSaveAndUpdate = vi.fn().mockResolvedValue(undefined);
        mockPatchRecord = vi.fn().mockResolvedValue(undefined);
        mockRecord = {
            date: '2024-12-28',
            beds: { 'R1': { patientName: 'Test' } },
            handoffDayChecklist: {},
            handoffNightChecklist: {},
            handoffNovedadesDayShift: '',
            handoffNovedadesNightShift: '',
        } as unknown as DailyRecord;
    });

    it('should return all management functions', () => {
        const { result } = renderHook(() =>
            useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
        );

        expect(typeof result.current.updateHandoffChecklist).toBe('function');
        expect(typeof result.current.updateHandoffNovedades).toBe('function');
        expect(typeof result.current.updateHandoffStaff).toBe('function');
        expect(typeof result.current.updateMedicalSignature).toBe('function');
        expect(typeof result.current.updateMedicalHandoffDoctor).toBe('function');
        expect(typeof result.current.markMedicalHandoffAsSent).toBe('function');
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

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });

    it('should update night checklist', () => {
        const { result } = renderHook(() =>
            useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
        );

        act(() => {
            result.current.updateHandoffChecklist('night', 'checked', true);
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });

    it('should update novedades for day shift', () => {
        const { result } = renderHook(() =>
            useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
        );

        act(() => {
            result.current.updateHandoffNovedades('day', 'Test novedades');
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });

    it('should update staff list', () => {
        const { result } = renderHook(() =>
            useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
        );

        act(() => {
            result.current.updateHandoffStaff('day', 'delivers', ['Nurse 1', 'Nurse 2']);
        });

        expect(mockSaveAndUpdate).toHaveBeenCalled();
    });

    it('should mark medical handoff as sent', async () => {
        const { result } = renderHook(() =>
            useHandoffManagement(mockRecord, mockSaveAndUpdate, mockPatchRecord)
        );

        await act(async () => {
            await result.current.markMedicalHandoffAsSent('Dr. Test');
        });

        expect(mockPatchRecord).toHaveBeenCalled();
    });
});
