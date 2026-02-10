import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLatest } from '@/hooks/useLatest';

describe('useLatest', () => {
    it('should return a ref with the current value', () => {
        const { result } = renderHook(() => useLatest('initial'));

        expect(result.current.current).toBe('initial');
    });

    it('should update the ref when value changes', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useLatest(value),
            { initialProps: { value: 'first' } }
        );

        expect(result.current.current).toBe('first');

        rerender({ value: 'second' });

        expect(result.current.current).toBe('second');
    });

    it('should work with objects', () => {
        const obj1 = { name: 'test' };
        const obj2 = { name: 'updated' };

        const { result, rerender } = renderHook(
            ({ value }) => useLatest(value),
            { initialProps: { value: obj1 } }
        );

        expect(result.current.current).toBe(obj1);

        rerender({ value: obj2 });

        expect(result.current.current).toBe(obj2);
    });

    it('should work with null and undefined', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useLatest(value),
            { initialProps: { value: null as string | null } }
        );

        expect(result.current.current).toBeNull();

        rerender({ value: 'not null' as string | null });

        expect(result.current.current).toBe('not null');
    });
});
