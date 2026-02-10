import { describe, it, expect } from 'vitest';
import { randomItem, shuffle, groupBy, unique, uniqueBy } from '@/utils/arrayUtils';

describe('arrayUtils', () => {
    describe('randomItem', () => {
        it('should return an item from the array', () => {
            const arr = [1, 2, 3, 4, 5];
            const item = randomItem(arr);
            expect(arr).toContain(item);
        });
    });

    describe('shuffle', () => {
        it('should return an array with the same elements in likely different order', () => {
            const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
            const shuffled = shuffle(arr);
            expect(shuffled).toHaveLength(arr.length);
            expect(shuffled).toEqual(expect.arrayContaining(arr));
            // Note: chance of same order is extremely low but possible
        });

        it('should not mutate the original array', () => {
            const arr = [1, 2, 3];
            shuffle(arr);
            expect(arr).toEqual([1, 2, 3]);
        });
    });

    describe('groupBy', () => {
        it('should group items by key', () => {
            const arr = [
                { id: 1, type: 'A' },
                { id: 2, type: 'B' },
                { id: 3, type: 'A' }
            ];
            const grouped = groupBy(arr, item => item.type);
            expect(grouped).toEqual({
                A: [{ id: 1, type: 'A' }, { id: 3, type: 'A' }],
                B: [{ id: 2, type: 'B' }]
            });
        });
    });

    describe('unique', () => {
        it('should remove duplicates', () => {
            const arr = [1, 2, 2, 3, 1, 4];
            expect(unique(arr)).toEqual([1, 2, 3, 4]);
        });
    });

    describe('uniqueBy', () => {
        it('should remove duplicates by key', () => {
            const arr = [
                { id: 1, name: 'A' },
                { id: 2, name: 'B' },
                { id: 1, name: 'C' }
            ];
            const result = uniqueBy(arr, item => item.id);
            expect(result).toEqual([
                { id: 1, name: 'A' },
                { id: 2, name: 'B' }
            ]);
        });
    });
});
