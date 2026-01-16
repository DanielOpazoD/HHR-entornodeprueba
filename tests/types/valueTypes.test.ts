import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '@/types/valueTypes';

describe('valueTypes', () => {
    describe('getErrorMessage', () => {
        it('should return message from Error instance', () => {
            const error = new Error('Test error message');
            expect(getErrorMessage(error)).toBe('Test error message');
        });

        it('should return string directly if error is a string', () => {
            expect(getErrorMessage('String error')).toBe('String error');
        });

        it('should return message from object with message property', () => {
            const errorObj = { message: 'Object error message' };
            expect(getErrorMessage(errorObj)).toBe('Object error message');
        });

        it('should return default message for null', () => {
            expect(getErrorMessage(null)).toBe('An unknown error occurred');
        });

        it('should return default message for undefined', () => {
            expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
        });

        it('should return default message for number', () => {
            expect(getErrorMessage(123)).toBe('An unknown error occurred');
        });

        it('should return default message for empty object', () => {
            expect(getErrorMessage({})).toBe('An unknown error occurred');
        });

        it('should handle object with non-string message', () => {
            const errorObj = { message: 12345 };
            expect(getErrorMessage(errorObj)).toBe('12345');
        });
    });
});
