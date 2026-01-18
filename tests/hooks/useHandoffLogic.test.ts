
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHandoffLogic } from '@/hooks/useHandoffLogic';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { Specialty, PatientStatus } from '@/types';
import * as dateUtils from '@/utils/dateUtils';

// Mock Audit
const mockLogDebouncedEvent = vi.fn();
vi.mock('@/context/AuditContext', () => ({
    useAuditContext: () => ({
        logDebouncedEvent: mockLogDebouncedEvent,
        logEvent: vi.fn(),
        userId: 'test-user'
    })
}));

vi.mock('@/context/DailyRecordContext', () => ({
    useDailyRecordData: vi.fn(),
    useDailyRecordActions: vi.fn()
}));

vi.mock('@/utils/dateUtils');

describe('useHandoffLogic', () => {
    const mockRecord = {
        date: '2025-01-01',
        beds: {
            R1: {
                bedId: 'R1',
                patientName: 'Test',
                rut: '1-1',
                age: '40',
                pathology: 'Test',
                specialty: Specialty.MEDICINA,
                status: PatientStatus.ESTABLE,
                admissionDate: '2025-01-01',
                isBlocked: false,
                bedMode: 'Cama',
                devices: [],
                surgicalComplication: false,
                isUPC: false,
                hasCompanionCrib: false,
                hasWristband: true
            }
        },
        discharges: [], transfers: [], cma: [], lastUpdated: '', nurses: [], nursesDayShift: [], nursesNightShift: [], tensDayShift: [], tensNightShift: [], activeExtraBeds: []
    } as any;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(dateUtils.getShiftSchedule).mockReturnValue({ dayStart: '08:00', dayEnd: '20:00', nightStart: '20:00', nightEnd: '08:00', description: '' });
        vi.mocked(dateUtils.isAdmittedDuringShift).mockReturnValue(true);

        (useDailyRecordData as any).mockReturnValue({ record: mockRecord });
        (useDailyRecordActions as any).mockReturnValue({});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('handles nursing note changes correctly (Day Shift uses updatePatientMultiple)', async () => {
        const mockUpdateMultiple = vi.fn();
        (useDailyRecordActions as any).mockReturnValue({
            updatePatientMultiple: mockUpdateMultiple,
            updatePatient: vi.fn(),
            updateClinicalCrib: vi.fn(),
            updateClinicalCribMultiple: vi.fn()
        });

        const params = {
            type: 'nursing' as any,
            selectedShift: 'day' as any,
            setSelectedShift: vi.fn(),
            onSuccess: vi.fn(),
        };

        const { result } = renderHook(() => useHandoffLogic(params));

        await act(async () => {
            await result.current.handleNursingNoteChange('R1', 'New Note');
        });

        // El turno largo propaga la nota a ambos turnos usando updatePatientMultiple
        expect(mockUpdateMultiple).toHaveBeenCalledWith('R1', expect.objectContaining({
            handoffNoteDayShift: 'New Note',
            handoffNoteNightShift: 'New Note'
        }));
        expect(mockLogDebouncedEvent).toHaveBeenCalledWith('NURSE_HANDOFF_MODIFIED', 'patient', 'R1', expect.anything(), '1-1', '2025-01-01', undefined, 30000);
    });

    it('adds and deletes clinical events', async () => {
        const mockUpdate = vi.fn();
        (useDailyRecordActions as any).mockReturnValue({
            updatePatient: mockUpdate,
            updatePatientMultiple: vi.fn(),
            updateClinicalCrib: vi.fn(),
            updateClinicalCribMultiple: vi.fn()
        });

        const params = {
            type: 'nursing' as any,
            selectedShift: 'day' as any,
            setSelectedShift: vi.fn(),
            onSuccess: vi.fn(),
        };

        const { result } = renderHook(() => useHandoffLogic(params));

        await act(async () => {
            await result.current.handleClinicalEventAdd('R1', { name: 'Cirugía', date: '2025-01-01', note: '' });
        });

        expect(mockUpdate).toHaveBeenCalledWith('R1', 'clinicalEvents', expect.any(Array));
        expect(mockLogDebouncedEvent).toHaveBeenCalledWith('CLINICAL_EVENT_ADDED', 'patient', 'R1', expect.anything(), 'R1', '2025-01-01', undefined, 10000);

        // Delete
        const recordWithEvent = {
            ...mockRecord,
            beds: {
                R1: {
                    ...mockRecord.beds.R1,
                    clinicalEvents: [{ id: 'evt-1', name: 'Delete', date: '2025-01-01', note: '', createdAt: '' }]
                }
            }
        };

        // Update mock for the second part
        const mockUpdate2 = vi.fn();

        // Need to re-render or create new hook instance with updated context
        // Since renderHook uses current context mock, we update mock before calling renderHook
        (useDailyRecordData as any).mockReturnValue({ record: recordWithEvent });
        (useDailyRecordActions as any).mockReturnValue({ updatePatient: mockUpdate2 });

        const { result: res2 } = renderHook(() => useHandoffLogic(params));

        await act(async () => {
            await res2.current.handleClinicalEventDelete('R1', 'evt-1');
        });

        expect(mockUpdate2).toHaveBeenCalledWith('R1', 'clinicalEvents', []);
        expect(mockLogDebouncedEvent).toHaveBeenCalledWith('CLINICAL_EVENT_DELETED', 'patient', 'R1', expect.anything(), 'R1', '2025-01-01', undefined, 10000);
    });
});
