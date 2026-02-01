import { describe, it, expect } from 'vitest';
import { capitalizeWords, normalizeName, truncate, isEmpty, removeAccents, searchMatch } from '@/utils/stringUtils';

describe('stringUtils', () => {
    describe('capitalizeWords', () => {
        it('should capitalize first letter of each word', () => {
            expect(capitalizeWords('juan perez')).toBe('Juan Perez');
            expect(capitalizeWords('JUAN PEREZ')).toBe('Juan Perez');
            expect(capitalizeWords('jUaN pErEz')).toBe('Juan Perez');
        });

        it('should return empty string for empty input', () => {
            expect(capitalizeWords('')).toBe('');
        });
    });

    describe('normalizeName', () => {
        it('should trim and normalize spaces and capitalization', () => {
            expect(normalizeName('  juan   perez  ')).toBe('Juan Perez');
        });

        it('should return empty string for empty input', () => {
            expect(normalizeName('')).toBe('');
        });
    });

    describe('truncate', () => {
        it('should truncate and add ellipsis', () => {
            expect(truncate('Hello World', 8)).toBe('Hello...');
        });

        it('should not truncate if shorter than max', () => {
            expect(truncate('Hello', 10)).toBe('Hello');
        });

        it('should handle empty string', () => {
            expect(truncate('', 5)).toBe('');
        });
    });

    describe('isEmpty', () => {
        it('should return true for null, undefined, or whitespace', () => {
            expect(isEmpty(null)).toBe(true);
            expect(isEmpty(undefined)).toBe(true);
            expect(isEmpty('')).toBe(true);
            expect(isEmpty('   ')).toBe(true);
        });

        it('should return false for non-empty string', () => {
            expect(isEmpty('hello')).toBe(false);
        });
    });

    describe('removeAccents', () => {
        it('should remove diacritics', () => {
            expect(removeAccents('áéíóúñ')).toBe('aeioun');
            expect(removeAccents('ÁÉÍÓÚÑ')).toBe('AEIOUN');
        });
    });

    describe('searchMatch', () => {
        it('should match ignoring case and accents', () => {
            expect(searchMatch('Juan Pérez', 'perez')).toBe(true);
            expect(searchMatch('Juan Pérez', 'JUAN')).toBe(true);
            expect(searchMatch('Juan Pérez', 'xyz')).toBe(false);
            expect(searchMatch('Juan Pérez', 'é')).toBe(true);
        });
    });
});
