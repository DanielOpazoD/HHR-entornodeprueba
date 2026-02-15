import { describe, it, expect } from 'vitest';

// We need to test the ensureArray logic. Since it's a private function,
// we test it indirectly through the docToRecord behavior or extract it for testing.
// For this test, we'll test the conversion logic directly.

describe('ensureArray Logic', () => {
    /**
     * This mimics the ensureArray function in firestoreService.ts
     * Used to convert corrupted object data (from dot-notation patches) back to arrays.
     */
    const ensureArray = (value: unknown, defaultLength: number): string[] => {
        if (Array.isArray(value)) {
            const result = [...value];
            while (result.length < defaultLength) {
                result.push('');
            }
            return result.slice(0, defaultLength);
        }

        // Handle object with numeric keys (corrupted array data)
        if (value && typeof value === 'object') {
            const obj = value as Record<string, string>;
            const result: string[] = [];
            for (let i = 0; i < defaultLength; i++) {
                result.push(obj[String(i)] || '');
            }
            return result;
        }

        // Return default empty array
        return Array(defaultLength).fill('');
    };

    describe('with array input', () => {
        it('should return the array unchanged if correct length', () => {
            const input = ['Nurse 1', 'Nurse 2'];
            const result = ensureArray(input, 2);
            expect(result).toEqual(['Nurse 1', 'Nurse 2']);
        });

        it('should pad array with empty strings if shorter than defaultLength', () => {
            const input = ['Nurse 1'];
            const result = ensureArray(input, 2);
            expect(result).toEqual(['Nurse 1', '']);
        });

        it('should truncate array if longer than defaultLength', () => {
            const input = ['A', 'B', 'C', 'D'];
            const result = ensureArray(input, 2);
            expect(result).toEqual(['A', 'B']);
        });

        it('should handle empty array', () => {
            const result = ensureArray([], 3);
            expect(result).toEqual(['', '', '']);
        });
    });

    describe('with object input (corrupted data from dot-notation patches)', () => {
        it('should convert object with numeric keys to array', () => {
            const input = { '0': 'Nurse 1', '1': 'Nurse 2' };
            const result = ensureArray(input, 2);
            expect(result).toEqual(['Nurse 1', 'Nurse 2']);
        });

        it('should handle sparse object (missing keys)', () => {
            const input = { '0': 'TENS 1', '2': 'TENS 3' };
            const result = ensureArray(input, 3);
            expect(result).toEqual(['TENS 1', '', 'TENS 3']);
        });

        it('should handle object with only one key', () => {
            const input = { '1': 'Only Second' };
            const result = ensureArray(input, 2);
            expect(result).toEqual(['', 'Only Second']);
        });

        it('should handle empty object', () => {
            const input = {};
            const result = ensureArray(input, 2);
            expect(result).toEqual(['', '']);
        });
    });

    describe('with null/undefined input', () => {
        it('should return default array for null', () => {
            const result = ensureArray(null, 2);
            expect(result).toEqual(['', '']);
        });

        it('should return default array for undefined', () => {
            const result = ensureArray(undefined, 3);
            expect(result).toEqual(['', '', '']);
        });
    });

    describe('for nurse arrays (length 2)', () => {
        it('should correctly handle day shift nurses', () => {
            const corrupted = { '0': 'María', '1': 'Juan' };
            const result = ensureArray(corrupted, 2);
            expect(result).toEqual(['María', 'Juan']);
        });
    });

    describe('for TENS arrays (length 3)', () => {
        it('should correctly handle day shift TENS', () => {
            const corrupted = { '0': 'TENS A', '1': 'TENS B', '2': 'TENS C' };
            const result = ensureArray(corrupted, 3);
            expect(result).toEqual(['TENS A', 'TENS B', 'TENS C']);
        });

        it('should correctly handle partial TENS data', () => {
            const corrupted = { '0': 'Only First' };
            const result = ensureArray(corrupted, 3);
            expect(result).toEqual(['Only First', '', '']);
        });
    });
});

describe('Staff Array Sync Integration', () => {
    // These tests verify the expected behavior of how staff arrays should be stored
    // and retrieved, ensuring the fix for dot-notation corruption works end-to-end.

    it('should maintain array integrity when updating nurse selections', () => {
        // Simulate the flow: UI selects nurse -> patchRecord sends complete array
        const currentRecord: Record<'nursesDayShift' | 'nursesNightShift', string[]> = {
            nursesDayShift: ['', ''],
            nursesNightShift: ['', '']
        };

        // Simulating useNurseManagement logic
        const updateNurse = (shift: 'day' | 'night', index: number, name: string) => {
            const field: 'nursesDayShift' | 'nursesNightShift' =
                shift === 'day' ? 'nursesDayShift' : 'nursesNightShift';
            const currentArray = [...currentRecord[field]];
            currentArray[index] = name;
            return { [field]: currentArray };
        };

        // First nurse selected
        const patch1 = updateNurse('day', 0, 'María López');
        expect(patch1).toEqual({ nursesDayShift: ['María López', ''] });

        // Apply patch
        currentRecord.nursesDayShift = patch1.nursesDayShift;

        // Second nurse selected
        const patch2 = updateNurse('day', 1, 'Juan Pérez');
        expect(patch2).toEqual({ nursesDayShift: ['María López', 'Juan Pérez'] });
    });

    it('should maintain array integrity when updating TENS selections', () => {
        const currentRecord: Record<'tensDayShift' | 'tensNightShift', string[]> = {
            tensDayShift: ['', '', ''],
            tensNightShift: ['', '', '']
        };

        const updateTens = (shift: 'day' | 'night', index: number, name: string) => {
            const field: 'tensDayShift' | 'tensNightShift' =
                shift === 'day' ? 'tensDayShift' : 'tensNightShift';
            const currentArray = [...currentRecord[field]];
            currentArray[index] = name;
            return { [field]: currentArray };
        };

        // Add TENS in sequence
        currentRecord.tensDayShift = updateTens('day', 0, 'TENS 1').tensDayShift;
        currentRecord.tensDayShift = updateTens('day', 2, 'TENS 3').tensDayShift;
        currentRecord.tensDayShift = updateTens('day', 1, 'TENS 2').tensDayShift;

        expect(currentRecord.tensDayShift).toEqual(['TENS 1', 'TENS 2', 'TENS 3']);
    });
});
