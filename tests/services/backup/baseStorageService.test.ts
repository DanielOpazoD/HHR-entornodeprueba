/**
 * Tests for baseStorageService
 * Tests shared utilities and constants
 */

import { describe, it, expect, vi } from 'vitest';
import * as BaseStorage from '@/services/backup/baseStorageService';


describe('baseStorageService', () => {
    const { MONTH_NAMES, formatFileSize } = BaseStorage;

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

    describe('Factory Functions', () => {
        it('createListYears returns years correctly', async () => {
            const listYears = BaseStorage.createListYears('test-root');
            // Mock listAll to return some prefixes
            const { listAll } = await import('firebase/storage');
            vi.mocked(listAll).mockResolvedValueOnce({
                prefixes: [{ name: '2025' }, { name: '2024' }],
                items: []
            } as any);

            const years = await listYears();
            expect(years).toEqual(['2025', '2024']);
        });

        it('createListMonths returns months correctly', async () => {
            const listMonths = BaseStorage.createListMonths('test-root');
            const { listAll } = await import('firebase/storage');
            vi.mocked(listAll).mockResolvedValueOnce({
                prefixes: [{ name: '01' }, { name: '02' }],
                items: []
            } as any);

            const months = await listMonths('2025');
            expect(months).toEqual([
                { number: '02', name: 'Febrero' },
                { number: '01', name: 'Enero' }
            ]);
        });

        it('createListFilesInMonth returns files correctly', async () => {
            const config = {
                storageRoot: 'test-root',
                parseFilePath: (path: string) => ({ date: '2025-01-01' }),
                mapToFile: (item: any, meta: any, url: string, parsed: any) => ({
                    name: item.name,
                    fullPath: item.fullPath,
                    downloadUrl: url,
                    date: parsed.date,
                    createdAt: meta.timeCreated,
                    size: meta.size
                })
            } as any;
            const listFiles = BaseStorage.createListFilesInMonth(config);

            const { listAll, getMetadata, getDownloadURL } = await import('firebase/storage');
            vi.mocked(listAll).mockResolvedValueOnce({
                prefixes: [],
                items: [{ name: 'file1.json', fullPath: 'root/2025/01/file1.json' }]
            } as any);
            vi.mocked(getMetadata).mockResolvedValueOnce({ size: 100, timeCreated: '2025-01-01T00:00:00Z' } as any);
            vi.mocked(getDownloadURL).mockResolvedValueOnce('http://download.com/file1');

            const files = await listFiles('2025', '01');
            expect(files).toHaveLength(1);
            expect(files[0].name).toBe('file1.json');
        });

        it('createListFilesInMonth returns empty if no items found', async () => {
            const config = { storageRoot: 'test-root', parseFilePath: vi.fn(), mapToFile: vi.fn() } as any;
            const listFiles = BaseStorage.createListFilesInMonth(config);
            const { listAll } = await import('firebase/storage');
            vi.mocked(listAll).mockResolvedValueOnce({ prefixes: [], items: [] } as any);

            const files = await listFiles('2025', '01');
            expect(files).toEqual([]);
        });

        it('createListFilesInMonth skips files that fail parsing', async () => {
            const config = {
                storageRoot: 'test-root',
                parseFilePath: vi.fn().mockReturnValue(null), // Fail parsing
                mapToFile: vi.fn()
            } as any;
            const listFiles = BaseStorage.createListFilesInMonth(config);
            const { listAll } = await import('firebase/storage');
            vi.mocked(listAll).mockResolvedValueOnce({
                prefixes: [],
                items: [{ name: 'invalid.json', fullPath: 'path' }]
            } as any);

            const files = await listFiles('2025', '01');
            expect(files).toEqual([]);
        });

        it('createListFilesInMonth handles individual file info errors', async () => {
            const config = {
                storageRoot: 'test-root',
                parseFilePath: vi.fn().mockReturnValue({ date: '2025-01-01' }),
                mapToFile: vi.fn()
            } as any;
            const listFiles = BaseStorage.createListFilesInMonth(config);
            const { listAll, getMetadata } = await import('firebase/storage');
            vi.mocked(listAll).mockResolvedValueOnce({
                prefixes: [],
                items: [{ name: 'error.json', fullPath: 'path' }]
            } as any);
            vi.mocked(getMetadata).mockRejectedValueOnce(new Error('Metadata error'));

            const files = await listFiles('2025', '01');
            expect(files).toEqual([]);
        });
    });
});
