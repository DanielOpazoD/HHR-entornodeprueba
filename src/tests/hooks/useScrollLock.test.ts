import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScrollLock } from '@/hooks/useScrollLock';

describe('useScrollLock', () => {
    beforeEach(() => {
        // Reset body style
        document.body.style.overflow = '';
    });

    afterEach(() => {
        document.body.style.overflow = '';
    });

    it('should lock scroll when isActive is true', () => {
        renderHook(() => useScrollLock(true));
        expect(document.body.style.overflow).toBe('hidden');
    });

    it('should not lock scroll when isActive is false', () => {
        renderHook(() => useScrollLock(false));
        expect(document.body.style.overflow).toBe('');
    });

    it('should keep scroll locked if at least one hook is active', () => {
        const { unmount: unmount1 } = renderHook(() => useScrollLock(true));
        const { unmount: unmount2 } = renderHook(() => useScrollLock(true));

        expect(document.body.style.overflow).toBe('hidden');

        unmount1();
        expect(document.body.style.overflow).toBe('hidden');

        unmount2();
        expect(document.body.style.overflow).toBe('');
    });

    it('should unlock scroll when all hooks are unmounted', () => {
        const { unmount: unmount1 } = renderHook(() => useScrollLock(true));
        const { unmount: unmount2 } = renderHook(() => useScrollLock(true));

        unmount1();
        unmount2();

        expect(document.body.style.overflow).toBe('');
    });

    it('should update scroll state when isActive changes', () => {
        const { rerender } = renderHook(({ active }) => useScrollLock(active), {
            initialProps: { active: false }
        });

        expect(document.body.style.overflow).toBe('');

        rerender({ active: true });
        expect(document.body.style.overflow).toBe('hidden');

        rerender({ active: false });
        expect(document.body.style.overflow).toBe('');
    });
});
