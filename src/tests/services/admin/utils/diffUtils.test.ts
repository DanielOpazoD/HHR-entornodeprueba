import { describe, it, expect } from 'vitest';
import { computeWordDiff } from '@/services/admin/utils/diffUtils';

describe('diffUtils', () => {
    it('should compute diff for additions', () => {
        const result = computeWordDiff('', 'Hello World');
        expect(result).toHaveLength(1);
        expect(result[0].added).toBe(true);
        expect(result[0].value).toBe('Hello World');
    });

    it('should compute diff for removals', () => {
        const result = computeWordDiff('Hello World', '');
        expect(result).toHaveLength(1);
        expect(result[0].removed).toBe(true);
        expect(result[0].value).toBe('Hello World');
    });

    it('should compute diff for mixed changes', () => {
        const result = computeWordDiff('Hello World', 'Hello Brave New World');
        // "Hello " (match), "World" (removed in old position), "Brave New World" (added)
        // Implementation might be simpler: 
        // "Hello" (match), " " (match), "World" (removed), "Brave" (added), " " (added), "New" (added), " " (added), "World" (added)
        expect(result.length).toBeGreaterThan(1);
        expect(result.some(p => p.added)).toBe(true);
    });

    it('should handle small resync window', () => {
        const result = computeWordDiff('A B C D E', 'A X B C D E');
        expect(result.some(p => p.value === 'X' && p.added)).toBe(true);
    });
});
