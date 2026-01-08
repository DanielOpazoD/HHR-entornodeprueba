import { describe, it, expect } from 'vitest';
import {
    getResponse,
    formatDate,
    calculateAge
} from '@/services/transfers/documentGeneratorUtils';
import { QuestionnaireResponse } from '@/types/transferDocuments';

describe('documentGeneratorUtils', () => {

    describe('getResponse', () => {
        const mockResponses: QuestionnaireResponse = {
            responses: [
                { questionId: 'q1', value: 'Value 1' },
                { questionId: 'q2', value: true },
                { questionId: 'q3', value: false },
                { questionId: 'q4', value: ['A', 'B'] },
                { questionId: 'q5', value: 123 }
            ]
        } as QuestionnaireResponse;

        it('should return string value directly', () => {
            expect(getResponse(mockResponses, 'q1')).toBe('Value 1');
        });

        it('should return SÍ/NO for boolean values', () => {
            expect(getResponse(mockResponses, 'q2')).toBe('SÍ');
            expect(getResponse(mockResponses, 'q3')).toBe('NO');
        });

        it('should join array values with comma', () => {
            expect(getResponse(mockResponses, 'q4')).toBe('A, B');
        });

        it('should convert numbers to string', () => {
            expect(getResponse(mockResponses, 'q5')).toBe('123');
        });

        it('should return empty string for missing question', () => {
            expect(getResponse(mockResponses, 'missing')).toBe('');
        });
    });

    describe('formatDate', () => {
        it('should format valid date string', () => {
            // We use a time-safe string (noon) to avoid timezone/UTC midnight shifts in test runner
            const result = formatDate('2024-01-31T12:00:00');

            // Check for key components rather than exact format to be robust in CI
            expect(result).toContain('2024');
            expect(result).toContain('31');
        });

        it('should return empty string for falsy input', () => {
            expect(formatDate(undefined)).toBe('');
            expect(formatDate('')).toBe('');
        });
    });

    describe('calculateAge', () => {
        it('should calculate age correctly', () => {
            // Use a fixed date for "today" by overriding strict logic or doing relative math
            // For simplicity, we assume the function is correct relative to current system time.
            const today = new Date();
            const year = today.getFullYear();

            // Birthday passed this year
            const dob = `${year - 30}-01-01`;
            expect(calculateAge(dob)).toBe(30);
        });

        it('should calculate age correctly if birthday has not passed yet', () => {
            const today = new Date();
            const year = today.getFullYear();

            // Birthday is Dec 31
            const dob = `${year - 30}-12-31`;
            // If today is not Dec 31, they are 29
            // If today IS Dec 31, they are 30.
            // We can safely assume usually it's not Dec 31 for this test run context,
            // or we accept specific logic check.

            // Better: Manual check
            const birth = new Date(dob);
            let expected = year - birth.getFullYear();
            const m = today.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
                expected--;
            }

            expect(calculateAge(dob)).toBe(expected);
        });

        it('should return "No especificada" for missing date', () => {
            expect(calculateAge(undefined)).toBe('No especificada');
        });
    });

});
