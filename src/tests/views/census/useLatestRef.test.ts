import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLatestRef } from '@/hooks/useLatestRef';

describe('useLatestRef', () => {
  it('always exposes the latest value after rerender', () => {
    const { result, rerender } = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 'A' },
    });

    expect(result.current.current).toBe('A');

    rerender({ value: 'B' });
    expect(result.current.current).toBe('B');
  });
});
