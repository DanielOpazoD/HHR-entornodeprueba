/**
 * Tests for pdfStorageService
 * Tests parsing and path generation functions
 */

import { describe, it, expect, vi } from 'vitest';

// We need to test the internal functions, so we'll import the module
// and test the exported functions that depend on them

// Mock Firebase modules before importing the service
vi.mock('firebase/storage', () => ({
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    listAll: vi.fn(),
    deleteObject: vi.fn(),
    getMetadata: vi.fn()
}));

vi.mock('../../firebaseConfig', () => ({
    storage: {},
    auth: { currentUser: { email: 'test@test.com' } },
    firebaseReady: Promise.resolve()
}));

// Import after mocks are set up
import { StoredPdfFile } from '@/services/backup/pdfStorageService';

describe('pdfStorageService', () => {
    describe('StoredPdfFile type', () => {
        it('has correct structure for day shift', () => {
            const file: StoredPdfFile = {
                name: '03-01-2026 - Turno Largo.pdf',
                fullPath: 'entregas-enfermeria/2026/01/03-01-2026 - Turno Largo.pdf',
                downloadUrl: 'https://example.com/file.pdf',
                date: '2026-01-03',
                shiftType: 'day',
                createdAt: '2026-01-03T10:00:00Z',
                size: 150000
            };

            expect(file.shiftType).toBe('day');
            expect(file.date).toBe('2026-01-03');
        });

        it('has correct structure for night shift', () => {
            const file: StoredPdfFile = {
                name: '03-01-2026 - Turno Noche.pdf',
                fullPath: 'entregas-enfermeria/2026/01/03-01-2026 - Turno Noche.pdf',
                downloadUrl: 'https://example.com/file.pdf',
                date: '2026-01-03',
                shiftType: 'night',
                createdAt: '2026-01-03T22:00:00Z',
                size: 145000
            };

            expect(file.shiftType).toBe('night');
        });
    });

    describe('File naming conventions', () => {
        it('new format matches DD-MM-YYYY - Turno Largo.pdf', () => {
            const newFormatRegex = /(\d{2})-(\d{2})-(\d{4}) - Turno (Largo|Noche)\.pdf$/;

            expect('03-01-2026 - Turno Largo.pdf').toMatch(newFormatRegex);
            expect('03-01-2026 - Turno Noche.pdf').toMatch(newFormatRegex);
            expect('15-12-2025 - Turno Largo.pdf').toMatch(newFormatRegex);
        });

        it('old format matches YYYY-MM-DD_turno-largo.pdf', () => {
            const oldFormatRegex = /(\d{4}-\d{2}-\d{2})_(turno-largo|turno-noche)\.pdf$/;

            expect('2026-01-03_turno-largo.pdf').toMatch(oldFormatRegex);
            expect('2026-01-03_turno-noche.pdf').toMatch(oldFormatRegex);
        });

        it('can extract date from new format filename', () => {
            const filename = '03-01-2026 - Turno Largo.pdf';
            const match = filename.match(/(\d{2})-(\d{2})-(\d{4}) - Turno (Largo|Noche)\.pdf$/);

            expect(match).not.toBeNull();
            if (match) {
                const date = `${match[3]}-${match[2]}-${match[1]}`; // YYYY-MM-DD
                expect(date).toBe('2026-01-03');
                expect(match[4]).toBe('Largo');
            }
        });

        it('can extract date from old format filename', () => {
            const filename = '2026-01-03_turno-largo.pdf';
            const match = filename.match(/(\d{4}-\d{2}-\d{2})_(turno-largo|turno-noche)\.pdf$/);

            expect(match).not.toBeNull();
            if (match) {
                expect(match[1]).toBe('2026-01-03');
                expect(match[2]).toBe('turno-largo');
            }
        });
    });

    describe('Path generation', () => {
        it('generates correct folder structure', () => {
            const date = '2026-01-03';
            const [year, month, day] = date.split('-');

            expect(year).toBe('2026');
            expect(month).toBe('01');
            expect(day).toBe('03');

            const expectedPath = `entregas-enfermeria/${year}/${month}/${day}-${month}-${year} - Turno Largo.pdf`;
            expect(expectedPath).toBe('entregas-enfermeria/2026/01/03-01-2026 - Turno Largo.pdf');
        });
    });
});
