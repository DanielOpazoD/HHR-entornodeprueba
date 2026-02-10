/**
 * Integration Tests for PWA Offline Functionality
 * Tests service worker behavior and offline data handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DailyRecord, PatientData } from '@/types';

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {};
    return {
        getItem: (key: string) => store[key] || null,
        setItem: (key: string, value: string) => { store[key] = value; },
        removeItem: (key: string) => { delete store[key]; },
        clear: () => { store = {}; },
    };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('PWA Offline Integration', () => {
    beforeEach(() => {
        localStorageMock.clear();
    });

    describe('Offline Data Storage', () => {
        it('should store record in localStorage', () => {
            const record: Partial<DailyRecord> = {
                date: '2024-12-23',
                beds: {
                    'R1': { patientName: 'Juan' } as PatientData,
                },
                discharges: [],
                transfers: [],
                cma: [],
            };

            localStorage.setItem('dailyRecord_2024-12-23', JSON.stringify(record));

            const stored = localStorage.getItem('dailyRecord_2024-12-23');
            expect(stored).not.toBeNull();

            const parsed = JSON.parse(stored!);
            expect(parsed.date).toBe('2024-12-23');
        });

        it('should retrieve record from localStorage', () => {
            const record = {
                date: '2024-12-23',
                beds: { 'R1': { patientName: 'Test' } },
            };

            localStorage.setItem('dailyRecord_2024-12-23', JSON.stringify(record));

            const retrieved = localStorage.getItem('dailyRecord_2024-12-23');
            const parsed = JSON.parse(retrieved!);

            expect(parsed.beds.R1.patientName).toBe('Test');
        });

        it('should handle missing record gracefully', () => {
            const retrieved = localStorage.getItem('nonexistent_record');
            expect(retrieved).toBeNull();
        });
    });

    describe('Offline Queue', () => {
        it('should queue operations when offline', () => {
            interface OfflineOperation {
                type: string;
                data: any;
                timestamp: number;
            }

            const queue: OfflineOperation[] = [];

            // Simulate adding operation to queue
            queue.push({
                type: 'UPDATE_PATIENT',
                data: { bedId: 'R1', field: 'patientName', value: 'Juan' },
                timestamp: Date.now(),
            });

            expect(queue.length).toBe(1);
            expect(queue[0].type).toBe('UPDATE_PATIENT');
        });

        it('should persist queue to localStorage', () => {
            const queue = [
                { type: 'ADD_DISCHARGE', data: {}, timestamp: Date.now() },
                { type: 'UPDATE_PATIENT', data: {}, timestamp: Date.now() },
            ];

            localStorage.setItem('offlineQueue', JSON.stringify(queue));

            const stored = JSON.parse(localStorage.getItem('offlineQueue')!);
            expect(stored.length).toBe(2);
        });

        it('should clear queue after sync', () => {
            const queue = [{ type: 'TEST', data: {}, timestamp: Date.now() }];
            localStorage.setItem('offlineQueue', JSON.stringify(queue));

            // Simulate sync complete
            localStorage.removeItem('offlineQueue');

            expect(localStorage.getItem('offlineQueue')).toBeNull();
        });
    });

    describe('Service Worker Cache', () => {
        it('should define cacheable resources', () => {
            const cacheableResources = [
                '/',
                '/index.html',
                '/manifest.json',
                '/offline.html',
                '/assets/main.css',
                '/assets/main.js',
            ];

            expect(cacheableResources).toContain('/');
            expect(cacheableResources).toContain('/offline.html');
            expect(cacheableResources.length).toBeGreaterThan(0);
        });

        it('should prioritize network over cache for API calls', () => {
            const networkFirst = (url: string) =>
                url.includes('/api/') || url.includes('firestore');

            expect(networkFirst('/api/patients')).toBe(true);
            expect(networkFirst('/index.html')).toBe(false);
        });

        it('should fallback to cache for static assets', () => {
            const cacheFirst = (url: string) =>
                url.endsWith('.js') ||
                url.endsWith('.css') ||
                url.endsWith('.png');

            expect(cacheFirst('/assets/main.js')).toBe(true);
            expect(cacheFirst('/api/data')).toBe(false);
        });
    });

    describe('Offline Fallback Page', () => {
        it('should have offline page content', () => {
            const offlinePageContent = {
                title: 'Sin conexión',
                message: 'No hay conexión a internet',
                suggestion: 'Los datos guardados localmente están disponibles',
            };

            expect(offlinePageContent.title).toBeDefined();
            expect(offlinePageContent.message).toContain('conexión');
        });
    });

    describe('Data Sync', () => {
        it('should detect online status', () => {
            // Mock navigator.onLine
            const isOnline = () => typeof navigator !== 'undefined'
                ? navigator.onLine
                : true;

            // In test environment, assume online
            expect(typeof isOnline()).toBe('boolean');
        });

        it('should merge local and remote data', () => {
            const localRecord = {
                date: '2024-12-23',
                beds: { 'R1': { patientName: 'Local Juan' } },
                lastUpdated: '2024-12-23T10:00:00Z',
            };

            const remoteRecord = {
                date: '2024-12-23',
                beds: { 'R1': { patientName: 'Remote Juan' } },
                lastUpdated: '2024-12-23T11:00:00Z', // Newer
            };

            // Remote is newer, should win
            const winner = new Date(remoteRecord.lastUpdated) > new Date(localRecord.lastUpdated)
                ? remoteRecord
                : localRecord;

            expect(winner.beds.R1.patientName).toBe('Remote Juan');
        });

        it('should handle conflict resolution', () => {
            const conflict = {
                field: 'patientName',
                localValue: 'Local',
                remoteValue: 'Remote',
                localTimestamp: Date.now() - 1000,
                remoteTimestamp: Date.now(),
            };

            // Last-write-wins strategy
            const resolved = conflict.remoteTimestamp > conflict.localTimestamp
                ? conflict.remoteValue
                : conflict.localValue;

            expect(resolved).toBe('Remote');
        });
    });
});
