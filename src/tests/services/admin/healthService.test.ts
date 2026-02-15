import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    reportUserHealth,
    subscribeToSystemHealth,
    getSystemHealthSnapshot,
    UserHealthStatus
} from '@/services/admin/healthService';

// Mock the db abstraction layer
vi.mock('@/services/infrastructure/db', () => ({
    db: {
        setDoc: vi.fn().mockResolvedValue(undefined),
        getDocs: vi.fn().mockResolvedValue([]),
        subscribeQuery: vi.fn().mockImplementation((_path, _options, _callback) => {
            // Return an unsubscribe function
            return vi.fn();
        }),
    }
}));

// Import the mocked db after mocking
import { db } from '@/services/infrastructure/db';

describe('healthService', () => {
    const mockStatus: UserHealthStatus = {
        uid: 'user123',
        email: 'test@example.com',
        displayName: 'Test User',
        lastSeen: '2025-01-01T10:00:00Z',
        isOnline: true,
        isOutdated: false,
        pendingMutations: 0,
        pendingSyncTasks: 0,
        failedSyncTasks: 0,
        localErrorCount: 0,
        appVersion: '1.0.0',
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0'
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('reportUserHealth', () => {
        it('should call db.setDoc with correct arguments', async () => {
            await reportUserHealth(mockStatus);
            expect(db.setDoc).toHaveBeenCalledWith(
                expect.stringContaining('users'),
                'user123',
                expect.objectContaining({ uid: 'user123', email: 'test@example.com' })
            );
        });

        it('should handle errors gracefully', async () => {
            vi.mocked(db.setDoc).mockRejectedValueOnce(new Error('Firebase Error'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            await reportUserHealth(mockStatus);

            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('getSystemHealthSnapshot', () => {
        it('should fetch user health docs from db', async () => {
            const mockUsers: UserHealthStatus[] = [
                { ...mockStatus, uid: 'user1' },
                { ...mockStatus, uid: 'user2' }
            ];
            vi.mocked(db.getDocs).mockResolvedValueOnce(mockUsers);

            const results = await getSystemHealthSnapshot();
            expect(results).toHaveLength(2);
            expect(results[0].uid).toBe('user1');
        });

        it('should handle fetch errors and return empty array', async () => {
            vi.mocked(db.getDocs).mockRejectedValueOnce(new Error('Fetch Failed'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => { });

            const results = await getSystemHealthSnapshot();
            expect(results).toEqual([]);
            expect(consoleSpy).toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('subscribeToSystemHealth', () => {
        it('should call db.subscribeQuery and return unsubscribe function', () => {
            const onUpdate = vi.fn();
            const unsubscribeMock = vi.fn();
            vi.mocked(db.subscribeQuery).mockReturnValueOnce(unsubscribeMock);

            const result = subscribeToSystemHealth(onUpdate);
            expect(db.subscribeQuery).toHaveBeenCalled();
            expect(result).toBe(unsubscribeMock);
        });

        it('should trigger onUpdate when db provides data', () => {
            const onUpdate = vi.fn();
            let capturedCallback: (data: UserHealthStatus[]) => void;

            vi.mocked(db.subscribeQuery).mockImplementation((path, options, callback) => {
                capturedCallback = callback as (data: UserHealthStatus[]) => void;
                return vi.fn();
            });

            subscribeToSystemHealth(onUpdate);

            // Simulate data update
            const mockData: UserHealthStatus[] = [
                { ...mockStatus, uid: 'u1' }
            ];
            capturedCallback!(mockData);

            expect(onUpdate).toHaveBeenCalledWith(mockData);
        });
    });
});
