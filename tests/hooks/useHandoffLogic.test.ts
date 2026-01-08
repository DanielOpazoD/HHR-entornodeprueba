import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHandoffLogic } from '@/hooks/useHandoffLogic';
import { DailyRecord, Specialty, PatientStatus } from '@/types';
import * as dateUtils from '@/utils/dateUtils';
import * as whatsappService from '@/services/integrations/whatsapp/whatsappService';
import * as auditService from '@/services/admin/auditService';

// Mock dependencies
vi.mock('@/utils/dateUtils');
vi.mock('@/services/integrations/whatsapp/whatsappService');
vi.mock('@/services/admin/auditService');

describe('useHandoffLogic', () => {
    const mockUpdatePatient = vi.fn();
    const mockUpdatePatientMultiple = vi.fn();
    const mockUpdateClinicalCrib = vi.fn();
    const mockUpdateClinicalCribMultiple = vi.fn();
    const mockSendMedicalHandoff = vi.fn();
    const mockOnSuccess = vi.fn();

    const mockRecord: DailyRecord = {
        date: '2025-01-01',
        beds: {
            R1: {
                bedId: 'R1',
                patientName: 'Test Patient',
                rut: '1-1',
                age: '40',
                pathology: 'Test',
                specialty: Specialty.MEDICINA,
                status: PatientStatus.ESTABLE,
                admissionDate: '2025-01-01',
                isBlocked: false,
                bedMode: 'Cama',
                hasCompanionCrib: false,
                devices: [],
                hasWristband: true,
                surgicalComplication: false,
                isUPC: false
            }
        },
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString(),
        nurses: ['Nurse 1'],
        nursesDayShift: ['Day Nurse'],
        nursesNightShift: ['Night Nurse'],
        tensDayShift: ['Day Tens'],
        tensNightShift: ['Night Tens'],
        activeExtraBeds: []
    };

    const defaultParams = {
        record: mockRecord,
        type: 'nursing' as const,
        selectedShift: 'day' as const,
        setSelectedShift: vi.fn(),
        updatePatient: mockUpdatePatient,
        updatePatientMultiple: mockUpdatePatientMultiple,
        updateClinicalCrib: mockUpdateClinicalCrib,
        updateClinicalCribMultiple: mockUpdateClinicalCribMultiple,
        sendMedicalHandoff: mockSendMedicalHandoff,
        onSuccess: mockOnSuccess,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(dateUtils.getShiftSchedule).mockReturnValue({
            dayStart: '08:00', dayEnd: '20:00', nightStart: '20:00', nightEnd: '08:00', description: 'Test Schedule'
        });
        vi.mocked(dateUtils.isAdmittedDuringShift).mockReturnValue(true);

        // Mock clipboard and window.open
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined),
            },
        });
        vi.spyOn(window, 'open').mockImplementation(() => null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('derives staff lists correctly for day shift', () => {
        const { result } = renderHook(() => useHandoffLogic(defaultParams));

        expect(result.current.deliversList).toEqual(['Day Nurse']);
        expect(result.current.receivesList).toEqual(['Night Nurse']);
        expect(result.current.tensList).toEqual(['Day Tens']);
    });

    it('derives staff lists correctly for night shift', () => {
        const { result } = renderHook(() => useHandoffLogic({ ...defaultParams, selectedShift: 'night' }));

        expect(result.current.deliversList).toEqual(['Night Nurse']);
        expect(result.current.tensList).toEqual(['Night Tens']);
    });

    describe('handleNursingNoteChange', () => {
        it('updates multiple fields for day shift nursing', async () => {
            const { result } = renderHook(() => useHandoffLogic(defaultParams));

            await act(async () => {
                await result.current.handleNursingNoteChange('R1', 'New note');
            });

            expect(mockUpdatePatientMultiple).toHaveBeenCalledWith('R1', {
                handoffNoteDayShift: 'New note',
                handoffNoteNightShift: 'New note'
            });
            expect(auditService.logNurseHandoffModified).toHaveBeenCalled();
        });

        it('updates single field for night shift nursing', async () => {
            const { result } = renderHook(() => useHandoffLogic({ ...defaultParams, selectedShift: 'night' }));

            await act(async () => {
                await result.current.handleNursingNoteChange('R1', 'New night note');
            });

            expect(mockUpdatePatient).toHaveBeenCalledWith('R1', 'handoffNoteNightShift', 'New night note');
        });

        it('updates medical handoff note', async () => {
            const { result } = renderHook(() => useHandoffLogic({ ...defaultParams, type: 'medical' }));

            await act(async () => {
                await result.current.handleNursingNoteChange('R1', 'Medical note');
            });

            expect(mockUpdatePatient).toHaveBeenCalledWith('R1', 'medicalHandoffNote', 'Medical note');
            expect(auditService.logMedicalHandoffModified).toHaveBeenCalled();
        });
    });

    it('handles clipboard sharing of the link', () => {
        const { result } = renderHook(() => useHandoffLogic(defaultParams));

        act(() => {
            result.current.handleShareLink();
        });

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('mode=signature'));
        expect(mockOnSuccess).toHaveBeenCalledWith('Enlace copiado', expect.any(String));
    });

    describe('WhatsApp integration', () => {
        beforeEach(() => {
            vi.mocked(whatsappService.getWhatsAppConfig).mockResolvedValue({
                handoffNotifications: { targetGroupId: 'group1' }
            } as any);
            vi.mocked(whatsappService.getMessageTemplates).mockResolvedValue([
                { type: 'handoff', content: 'Template Content' }
            ] as any);
        });

        it('sends automatic WhatsApp message', async () => {
            const { result } = renderHook(() => useHandoffLogic(defaultParams));

            await act(async () => {
                await result.current.handleSendWhatsApp();
            });

            expect(mockSendMedicalHandoff).toHaveBeenCalledWith('Template Content', 'group1');
            expect(result.current.whatsappSent).toBe(true);
        });

        it('opens WhatsApp manual interface', async () => {
            const { result } = renderHook(() => useHandoffLogic(defaultParams));

            await act(async () => {
                await result.current.handleSendWhatsAppManual();
            });

            expect(window.open).toHaveBeenCalledWith(expect.stringContaining('api.whatsapp.com/send'), '_blank');
        });
    });
});
