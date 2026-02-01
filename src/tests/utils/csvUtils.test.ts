import { describe, it, expect, vi } from 'vitest';
import { escapeCsvValue, arrayToCsv, downloadCsv } from '@/utils/csvUtils';

describe('csvUtils', () => {
    describe('escapeCsvValue', () => {
        it('should handle simple values', () => {
            expect(escapeCsvValue('hello')).toBe('hello');
            expect(escapeCsvValue(123)).toBe('123');
            expect(escapeCsvValue(true)).toBe('true');
        });

        it('should handle null and undefined', () => {
            expect(escapeCsvValue(null)).toBe('');
            expect(escapeCsvValue(undefined)).toBe('');
        });

        it('should escape commas', () => {
            expect(escapeCsvValue('hello,world')).toBe('"hello,world"');
        });

        it('should escape quotes', () => {
            expect(escapeCsvValue('hello "world"')).toBe('"hello ""world"""');
        });

        it('should escape newlines', () => {
            expect(escapeCsvValue('hello\nworld')).toBe('"hello\nworld"');
        });
    });

    describe('arrayToCsv', () => {
        it('should convert array of objects to CSV string', () => {
            const data = [
                { name: 'John', age: 30 },
                { name: 'Jane, Doe', age: 25 }
            ];
            const headers = [
                { key: 'name' as const, label: 'Name' },
                { key: 'age' as const, label: 'Age' }
            ];
            const csv = arrayToCsv(data, headers);
            expect(csv).toBe('Name,Age\nJohn,30\n"Jane, Doe",25');
        });
    });

    describe('downloadCsv', () => {
        it('should attempt to trigger download', () => {
            // Mocking DOM elements is tricky but we can check if it calls createObjectURL
            const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:url');
            const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });

            // Mock document.createElement
            const link = {
                href: '',
                download: '',
                click: vi.fn()
            };
            vi.spyOn(document, 'createElement').mockReturnValue(link as any);

            downloadCsv('content', 'test.csv');

            expect(createObjectURLSpy).toHaveBeenCalled();
            expect(link.download).toBe('test.csv');
            expect(link.click).toHaveBeenCalled();
            expect(revokeObjectURLSpy).toHaveBeenCalled();

            vi.restoreAllMocks();
        });
    });
});
