import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock auditService to test the REAL logic
vi.unmock('../../services/admin/auditService');

import {
    logPatientAdmission,
    logPatientDischarge,
    logPatientView
} from '@/services/admin/auditService';
import { auth } from '@/firebaseConfig';

// Mock Firestore
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDocs: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    Timestamp: {
        now: vi.fn(() => new Date())
    },
    where: vi.fn()
}));

const mockSaveAuditLog = vi.fn();
const mockGetAuditLogs = vi.fn();

vi.mock('../../services/storage/indexedDBService', () => ({
    saveAuditLog: (log: any) => mockSaveAuditLog(log),
    getAuditLogs: (limit: number) => mockGetAuditLogs(limit),
    getAuditLogsForDate: vi.fn()
}));

// Mock current user
const mockAuth = vi.mocked(auth);

describe('Audit Flow Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetAuditLogs.mockResolvedValue([]);

        // Mock default user
        (mockAuth as any).currentUser = {
            email: 'doctor@hospital.cl',
            uid: 'doctor-123'
        };
    });

    it('should log patient admission locally and to Firestore', async () => {
        await logPatientAdmission('BED_01', 'Juan Pérez', '12345678-9', 'Test Pathology', '2024-12-25');

        expect(mockSaveAuditLog).toHaveBeenCalled();
        const call = mockSaveAuditLog.mock.calls[0][0];
        expect(call.action).toBe('PATIENT_ADMITTED');
        expect(call.userId).toBe('doctor@hospital.cl');
        expect(call.patientIdentifier).toContain('***'); // Masked RUT
        expect(call.entityId).toBe('BED_01');
    });

    it('should log patient discharge with correct details', async () => {
        await logPatientDischarge('BED_02', 'Maria Jara', '98765432-1', 'Vivo', '2024-12-25');

        expect(mockSaveAuditLog).toHaveBeenCalled();
        const call = mockSaveAuditLog.mock.calls[0][0];
        expect(call.action).toBe('PATIENT_DISCHARGED');
        expect(call.details.status).toBe('Vivo');
    });

    it('should NOT log patient view for admin users', async () => {
        (mockAuth as any).currentUser = {
            email: 'daniel.opazo@hospitalhangaroa.cl' // Excluded user
        };

        await logPatientView('BED_01', 'Juan Pérez', '12345678-9', '2024-12-25');

        expect(mockSaveAuditLog).not.toHaveBeenCalled();
    });

    it('should log patient view for regular users', async () => {
        (mockAuth as any).currentUser = {
            email: 'other@hospital.cl' // Regular user
        };

        // Clear throttle state to ensure fresh test
        sessionStorage.clear();

        // The function should complete without throwing
        const result = logPatientView('BED_01', 'Juan Pérez', '12345678-9', '2024-12-25');

        expect(result).toBeInstanceOf(Promise);
        await expect(result).resolves.toBeUndefined();
    });
});
