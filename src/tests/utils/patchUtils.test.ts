import { describe, it, expect } from 'vitest';
import { applyPatches } from '@/utils/patchUtils';

describe('patchUtils', () => {
    it('should update a simple top-level property', () => {
        const obj = { name: 'Old', age: 30 };
        const patches = { name: 'New' };
        const result = applyPatches(obj, patches);
        expect(result.name).toBe('New');
        expect(result.age).toBe(30);
    });

    it('should update a nested property using dot notation', () => {
        const obj = { beds: { R1: { name: 'Old' } } };
        const patches = { 'beds.R1.name': 'New' };
        const result = applyPatches(obj, patches);
        expect(result.beds.R1.name).toBe('New');
    });

    it('should auto-vivify missing paths', () => {
        const obj = {};
        const patches = { 'a.b.c': 123 };
        const result: any = applyPatches(obj, patches);
        expect(result.a.b.c).toBe(123);
    });

    it('should preserve other sibling properties during nested update', () => {
        const obj = {
            beds: {
                R1: { name: 'Juan', age: 40 },
                R2: { name: 'Maria' }
            }
        };
        const patches = { 'beds.R1.age': 41 };
        const result = applyPatches(obj, patches);
        expect(result.beds.R1.name).toBe('Juan');
        expect(result.beds.R1.age).toBe(41);
        expect(result.beds.R2.name).toBe('Maria');
    });

    it('should handle array values correctly', () => {
        const obj = { tags: ['old'] };
        const patches = { tags: ['new', 'extra'] };
        const result = applyPatches(obj, patches);
        expect(result.tags).toEqual(['new', 'extra']);
    });
});
