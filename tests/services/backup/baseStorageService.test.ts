/**
 * Tests for baseStorageService
 * Tests shared utilities and constants
 */

import { describe, it, expect } from 'vitest';
import { MONTH_NAMES, formatFileSize } from '@/services/backup/baseStorageService';


describe('baseStorageService', () => {
    describe('MONTH_NAMES', () => {
        it('contains 12 months', () => {
            expect(MONTH_NAMES).toHaveLength(12);
        });

        it('has correct Spanish month names', () => {
            expect(MONTH_NAMES[0]).toBe('Enero');
            expect(MONTH_NAMES[1]).toBe('Febrero');
            expect(MONTH_NAMES[2]).toBe('Marzo');
            expect(MONTH_NAMES[3]).toBe('Abril');
            expect(MONTH_NAMES[4]).toBe('Mayo');
            expect(MONTH_NAMES[5]).toBe('Junio');
            expect(MONTH_NAMES[6]).toBe('Julio');
            expect(MONTH_NAMES[7]).toBe('Agosto');
            expect(MONTH_NAMES[8]).toBe('Septiembre');
            expect(MONTH_NAMES[9]).toBe('Octubre');
            expect(MONTH_NAMES[10]).toBe('Noviembre');
            expect(MONTH_NAMES[11]).toBe('Diciembre');
        });

        it('maps month numbers correctly', () => {
            // Month "01" should map to January (index 0)
            expect(MONTH_NAMES[parseInt('01') - 1]).toBe('Enero');
            // Month "12" should map to December (index 11)
            expect(MONTH_NAMES[parseInt('12') - 1]).toBe('Diciembre');
        });
    });

    describe('formatFileSize', () => {
        it('formats 0 bytes correctly', () => {
            expect(formatFileSize(0)).toBe('0 B');
        });

        it('formats bytes correctly', () => {
            expect(formatFileSize(500)).toBe('500 B');
            expect(formatFileSize(1000)).toBe('1000 B');
        });

        it('formats kilobytes correctly', () => {
            expect(formatFileSize(1024)).toBe('1 KB');
            expect(formatFileSize(2048)).toBe('2 KB');
            expect(formatFileSize(150000)).toBe('146 KB');
            expect(formatFileSize(200000)).toBe('195 KB');
        });

        it('formats megabytes correctly', () => {
            expect(formatFileSize(1048576)).toBe('1 MB');
            expect(formatFileSize(5242880)).toBe('5 MB');
        });

        it('rounds to nearest integer (no decimals)', () => {
            // 1536 bytes = 1.5 KB, should round to 2 KB
            expect(formatFileSize(1536)).toBe('2 KB');
            // 1280 bytes = 1.25 KB, should round to 1 KB
            expect(formatFileSize(1280)).toBe('1 KB');
        });
    });
});
