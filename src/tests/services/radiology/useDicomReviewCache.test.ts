import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDicomReviewCache } from '@/components/radiology/useDicomReviewCache';

describe('patient review cache ownership', () => {
  it('retains one cache within a patient review, isolates patient changes and clears on close', async () => {
    const { result, rerender, unmount } = renderHook(
      ({ open, patient }) => useDicomReviewCache(open, patient),
      { initialProps: { open: true, patient: '11.111-1' } }
    );
    await waitFor(() => expect(result.current).toBeDefined());
    const first = result.current!;
    rerender({ open: true, patient: '111111' });
    expect(result.current).toBe(first);
    rerender({ open: true, patient: '222222' });
    expect(first.active()).toBe(false);
    await waitFor(() => expect(result.current?.patient).toBe('222222'));
    const second = result.current!;
    expect(second).not.toBe(first);
    rerender({ open: false, patient: '222222' });
    expect(result.current).toBeUndefined();
    expect(second.active()).toBe(false);
    rerender({ open: true, patient: '222222' });
    await waitFor(() => expect(result.current).toBeDefined());
    const third = result.current!;
    expect(third).not.toBe(second);
    expect(third.active()).toBe(true);
    unmount();
    expect(third.active()).toBe(false);
  });
});
