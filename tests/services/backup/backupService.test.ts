import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    saveNursingHandoffBackup,
    checkBackupExists,
    getBackupByDateShift,
    getBackupFile,
    listBackupFiles,
    deleteBackupFile
} from '@/services/backup/backupService';
import {
    doc,
    setDoc,
    getDoc,
    getDocs,
    deleteDoc,
    query
} from 'firebase/firestore';
import { auth } from '@/firebaseConfig';

describe('backupService', () => {
    const mockDate = '2025-01-01';
    const mockShift = 'day';
    const mockContent = { beds: { 'R1': { patientName: 'John Doe' } } };

    beforeEach(() => {
        vi.resetAllMocks();
        // Mock auth user
        (auth as any).currentUser = {
            uid: 'tester',
            email: 'test@example.com',
            displayName: 'Test User'
        };
        // Mock doc return
        vi.mocked(doc).mockReturnValue({ id: 'mock-id' } as any);
    });

    describe('saveNursingHandoffBackup', () => {
        it('should call setDoc with correct arguments', async () => {
            vi.mocked(setDoc).mockResolvedValue(undefined as any);

            const id = await saveNursingHandoffBackup(
                mockDate,
                mockShift,
                'Nurse Delivery',
                'Nurse Receiving',
                mockContent
            );

            expect(id).toBe(`${mockDate}_${mockShift}`);
            expect(setDoc).toHaveBeenCalledWith(
                expect.any(Object),
                expect.objectContaining({
                    type: 'NURSING_HANDOFF',
                    date: mockDate,
                    shiftType: mockShift
                })
            );
        });

        it('should throw error if user not authenticated', async () => {
            (auth as any).currentUser = null;
            await expect(saveNursingHandoffBackup(mockDate, mockShift, 'D', 'R', mockContent))
                .rejects.toThrow('Usuario no autenticado');
        });
    });

    describe('checkBackupExists', () => {
        it('should return true if doc exists', async () => {
            vi.mocked(getDoc).mockResolvedValue({ exists: () => true } as any);
            const exists = await checkBackupExists(mockDate, mockShift);
            expect(exists).toBe(true);
        });

        it('should return false if doc does not exist', async () => {
            vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as any);
            const exists = await checkBackupExists(mockDate, mockShift);
            expect(exists).toBe(false);
        });
    });

    describe('getBackupByDateShift', () => {
        it('should return backup data if exists', async () => {
            const mockData = {
                type: 'NURSING_HANDOFF',
                date: mockDate,
                content: mockContent,
                createdAt: { toDate: () => ({ toISOString: () => '2025-01-01' }) }
            };
            vi.mocked(getDoc).mockResolvedValue({
                exists: () => true,
                data: () => mockData,
                id: '123'
            } as any);

            const result = await getBackupByDateShift(mockDate, mockShift);
            expect(result?.date).toBe(mockDate);
            expect(result?.content).toEqual(mockContent);
        });

        it('should return null if not exists', async () => {
            vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as any);
            const result = await getBackupByDateShift(mockDate, mockShift);
            expect(result).toBeNull();
        });
    });

    describe('getBackupFile', () => {
        it('should return backup by ID', async () => {
            vi.mocked(getDoc).mockResolvedValue({
                exists: () => true,
                data: () => ({ type: 'NURSING_HANDOFF', date: '2025-01-01' }),
                id: 'id1'
            } as any);
            const result = await getBackupFile('id1');
            expect(result?.id).toBe('id1');
        });

        it('should return null if not found', async () => {
            vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as any);
            const result = await getBackupFile('id1');
            expect(result).toBeNull();
        });
    });

    describe('listBackupFiles', () => {
        it('should fetch and format list of backups', async () => {
            const mockSnap = {
                docs: [
                    {
                        id: 'b1',
                        data: () => ({
                            type: 'NURSING_HANDOFF',
                            date: '2025-01-01',
                            title: 'Title',
                            createdAt: { toString: () => 'date' }
                        })
                    }
                ]
            };
            vi.mocked(getDocs).mockResolvedValue(mockSnap as any);

            const list = await listBackupFiles();
            expect(list).toHaveLength(1);
            expect(list[0].id).toBe('b1');
        });

        it('should apply filters and search', async () => {
            const mockSnap = {
                docs: [
                    {
                        id: 'b1',
                        data: () => ({
                            type: 'NURSING_HANDOFF',
                            date: '2025-01-01',
                            title: 'SearchMe',
                            metadata: { deliveryStaff: 'John' }
                        })
                    }
                ]
            };
            vi.mocked(getDocs).mockResolvedValue(mockSnap as any);

            const list = await listBackupFiles({ type: 'NURSING_HANDOFF', shiftType: 'day', searchQuery: 'Search' });
            expect(list).toHaveLength(1);
            expect(query).toHaveBeenCalled();
        });
    });

    describe('deleteBackupFile', () => {
        it('should call deleteDoc', async () => {
            vi.mocked(deleteDoc).mockResolvedValue(undefined as any);
            await deleteBackupFile('b1');
            expect(deleteDoc).toHaveBeenCalled();
        });
    });
});
