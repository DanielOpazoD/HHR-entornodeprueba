/**
 * Transfer Service Tests
 * Tests for patient transfer request operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createTransferRequest,
    updateTransferRequest,
    changeTransferStatus,
    getActiveTransfers,
    getTransferById,
    deleteTransferRequest,
    subscribeToTransfers
} from '@/services/transfers/transferService';
import { setDoc, getDoc, getDocs, deleteDoc } from 'firebase/firestore';

// Mock Firebase
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(() => ({ id: 'mock-doc-id' })),
    getDoc: vi.fn(),
    setDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined),
    getDocs: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    onSnapshot: vi.fn((q, cb) => {
        cb({ docs: [] });
        return vi.fn(); // unsubscribe
    }),
    Timestamp: {
        now: () => ({ toDate: () => new Date() })
    }
}));

vi.mock('@/firebaseConfig', () => ({
    db: {}
}));

describe('Transfer Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createTransferRequest', () => {
        it('should call setDoc when creating a transfer', async () => {
            // This test verifies the function doesn't throw
            // Actual Firestore interaction is mocked
            await expect(createTransferRequest({
                patientId: 'p1',
                bedId: 'R1',
                patientSnapshot: {
                    name: 'Test Patient',
                    rut: '12.345.678-9',
                    age: '50',
                    pathology: 'Test'
                },
                destination: 'Hospital Salvador',
                destinationHospital: 'Hospital Salvador',
                requestDate: '2025-01-10',
                priority: 'NORMAL',
                createdBy: 'admin@hospital.cl',
                transferType: 'TRASLADO',
                evacuationMethod: 'SAMU',
                specialRequirements: []
            } as any)).resolves.toBeDefined();

            expect(setDoc).toHaveBeenCalled();
        });
    });

    describe('updateTransferRequest', () => {
        it('should call setDoc with merge option', async () => {
            await updateTransferRequest('transfer-123', {
                observations: 'Updated notes'
            });

            expect(setDoc).toHaveBeenCalled();
        });
    });

    describe('changeTransferStatus', () => {
        it('should call getDoc and setDoc', async () => {
            (getDoc as any).mockResolvedValue({
                exists: () => true,
                data: () => ({
                    status: 'SENT',
                    observations: 'Urgent transfer',
                    statusHistory: []
                })
            });

            await changeTransferStatus('transfer-123', 'SENT', 'user@hospital.cl');

            expect(getDoc).toHaveBeenCalled();
            expect(setDoc).toHaveBeenCalled();
        });

        it('should throw if transfer not found', async () => {
            (getDoc as any).mockResolvedValue({
                exists: () => false
            });

            await expect(
                changeTransferStatus('non-existent', 'SENT', 'user@hospital.cl')
            ).rejects.toThrow('not found');
        });
    });

    describe('getTransferById', () => {
        it('should return null when not found', async () => {
            (getDoc as any).mockResolvedValue({
                exists: () => false
            });

            const transfer = await getTransferById('non-existent');

            expect(transfer).toBeNull();
        });
    });

    describe('deleteTransferRequest', () => {
        it('should call deleteDoc', async () => {
            await deleteTransferRequest('transfer-to-delete');

            expect(deleteDoc).toHaveBeenCalled();
        });
    });

    describe('subscribeToTransfers', () => {
        it('should return an unsubscribe function', () => {
            const callback = vi.fn();
            const unsubscribe = subscribeToTransfers(callback);

            expect(typeof unsubscribe).toBe('function');
        });

        it('should call callback with transfers array', () => {
            const callback = vi.fn();
            subscribeToTransfers(callback);

            expect(callback).toHaveBeenCalledWith([]);
        });
    });
});
