import { useEffect, type MutableRefObject } from 'react';
import { describe, expect, it } from 'vitest';
import { render, renderHook } from '@testing-library/react';
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

  it('is already current when the effects of child components run', () => {
    const seen: string[] = [];
    const Child = ({ latest }: { latest: MutableRefObject<string> }) => {
      useEffect(() => {
        seen.push(latest.current);
      });
      return null;
    };
    const Parent = ({ value }: { value: string }) => {
      const latest = useLatestRef(value);
      return <Child latest={latest} />;
    };

    const { rerender } = render(<Parent value="A" />);
    rerender(<Parent value="B" />);

    expect(seen).toEqual(['A', 'B']);
  });
});
