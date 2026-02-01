import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBedOperations } from '@/hooks/useBedOperations';
import { DailyRecord, PatientData, Specialty, PatientStatus } from '@/types';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { logPatientCleared } from '@/services/admin/auditService';

// Mock patientFactory
vi.mock('@/services/factories/patientFactory', () => ({
    createEmptyPatient: vi.fn((bedId: string) => ({
        bedId,
        patientName: '',
        location: 'Mock Location',
        isBlocked: false,
        bedMode: 'Cama'
    }))
}));

// Mock auditService
const { mockLogPatientCleared } = vi.hoisted(() => ({
    mockLogPatientCleared: vi.fn()
}));

vi.mock('@/services/admin/auditService', () => ({
    logPatientCleared: mockLogPatientCleared,
    logAuditEvent: vi.fn()
}));

// Mock AuditContext to provide the same mock function
vi.mock('@/context/AuditContext', () => ({
    useAuditContext: () => ({
        logPatientCleared: mockLogPatientCleared,
        logEvent: vi.fn(),
        logDebouncedEvent: vi.fn(),
        userId: 'test-user-123'
    })
}));

// Mock constants
vi.mock('@/constants', () => ({
    BEDS: [
        { id: 'B1', name: 'Bed 1', type: 'MEDIA' },
        { id: 'B2', name: 'Bed 2', type: 'MEDIA' }
    ]
}));

describe('useBedOperations', () => {
    const mockPatchRecord = vi.fn().mockResolvedValue(undefined);

    const createMockPatient = (bedId: string, name = 'Test Patient'): PatientData => ({
        bedId,
        patientName: name,
        rut: '12.345.678-9',
        location: 'Mock Location',
        isBlocked: false,
        bedMode: 'Cama'
    } as PatientData);

    const createMockRecord = (beds: Record<string, PatientData> = {}): DailyRecord => ({
        date: '2025-01-01',
        beds,
        activeExtraBeds: [],
        discharges: [],
        transfers: []
    } as any);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('moveOrCopyPatient', () => {
        it('should move patient from source to target and clear source', async () => {
            const sourcePatient = createMockPatient('B1', 'Mover');
            const targetEmpty = createMockPatient('B2', '');
            const record = createMockRecord({ B1: sourcePatient, B2: targetEmpty });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.moveOrCopyPatient('move', 'B1', 'B2');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.B2': expect.objectContaining({ patientName: 'Mover', bedId: 'B2' }),
                'beds.B1': expect.objectContaining({ patientName: '' })
            });
        });

        it('should copy patient to target without clearing source', async () => {
            const sourcePatient = createMockPatient('B1', 'Copier');
            const targetEmpty = createMockPatient('B2', '');
            const record = createMockRecord({ B1: sourcePatient, B2: targetEmpty });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.moveOrCopyPatient('copy', 'B1', 'B2');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.B2': expect.objectContaining({ patientName: 'Copier', bedId: 'B2' })
            });
            expect(mockPatchRecord).not.toHaveBeenCalledWith(expect.objectContaining({ 'beds.B1': expect.anything() }));
        });

        it('should not move/copy if source patient name is empty', () => {
            const sourceEmpty = createMockPatient('B1', '');
            const record = createMockRecord({ B1: sourceEmpty });
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.moveOrCopyPatient('move', 'B1', 'B2');
            });

            expect(mockPatchRecord).not.toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot move empty patient'));
        });
    });

    describe('clearAllBeds', () => {
        it('should clear all beds and reset metadata', () => {
            const record = createMockRecord({
                B1: createMockPatient('B1', 'P1'),
                B2: createMockPatient('B2', 'P2')
            });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.clearAllBeds();
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                beds: {
                    B1: expect.objectContaining({ patientName: '' }),
                    B2: expect.objectContaining({ patientName: '' })
                },
                discharges: [],
                transfers: []
            });
        });
    });

    describe('toggleExtraBed', () => {
        it('should add bed to activeExtraBeds if not present', () => {
            const record = createMockRecord();
            record.activeExtraBeds = ['E1'];

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.toggleExtraBed('E2');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                activeExtraBeds: ['E1', 'E2']
            });
        });

        it('should remove bed from activeExtraBeds if already present', () => {
            const record = createMockRecord();
            record.activeExtraBeds = ['E1', 'E2'];

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.toggleExtraBed('E1');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                activeExtraBeds: ['E2']
            });
        });
    });

    describe('clearPatient', () => {
        it('should clear patient and call logPatientCleared if patientName exists', () => {
            const patient = createMockPatient('B1', 'To Clear');
            const record = createMockRecord({ B1: patient });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.clearPatient('B1');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.B1': expect.objectContaining({ patientName: '' })
            });
            expect(logPatientCleared).toHaveBeenCalledWith('B1', 'To Clear', patient.rut, record.date);
        });
    });

    describe('toggleBlockBed', () => {
        it('should block an unblocked bed with a reason', () => {
            const patient = createMockPatient('B1', '');
            patient.isBlocked = false;
            const record = createMockRecord({ B1: patient });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.toggleBlockBed('B1', 'Broken');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.B1.isBlocked': true,
                'beds.B1.blockedReason': 'Broken'
            });
        });

        it('should unblock a blocked bed', () => {
            const patient = createMockPatient('B1', '');
            patient.isBlocked = true;
            patient.blockedReason = 'Broken';
            const record = createMockRecord({ B1: patient });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.toggleBlockBed('B1');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.B1.isBlocked': false,
                'beds.B1.blockedReason': ''
            });
        });

        it('should update blocked reason for a blocked bed', () => {
            const patient = createMockPatient('B1', '');
            patient.isBlocked = true;
            patient.blockedReason = 'Old Reason';
            const record = createMockRecord({ B1: patient });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.updateBlockedReason('B1', 'New Reason');
            });

            expect(mockPatchRecord).toHaveBeenCalledWith({
                'beds.B1.blockedReason': 'New Reason'
            });
        });

        it('should NOT update blocked reason for an unblocked bed', () => {
            const patient = createMockPatient('B1', '');
            patient.isBlocked = false;
            const record = createMockRecord({ B1: patient });

            const { result } = renderHook(() => useBedOperations(record, mockPatchRecord));

            act(() => {
                result.current.updateBlockedReason('B1', 'New Reason');
            });

            expect(mockPatchRecord).not.toHaveBeenCalled();
        });
    });
});
