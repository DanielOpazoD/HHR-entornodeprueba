import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVisibleSubscription } from '@/features/admin/components/useVisibleSubscription';

let visibility: DocumentVisibilityState;
const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next;
  act(() => document.dispatchEvent(new Event('visibilitychange')));
};

beforeEach(() => {
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => vi.restoreAllMocks());

describe('dashboard listener while the tab is in the background', () => {
  it('subscribes while visible and releases the listener when hidden', () => {
    const release = vi.fn();
    const subscribe = vi.fn(() => release);
    renderHook(() => useVisibleSubscription(subscribe));
    expect(subscribe).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    expect(release).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes on return so the operator sees the current picture', () => {
    const subscribe = vi.fn(() => vi.fn());
    renderHook(() => useVisibleSubscription(subscribe));
    setVisibility('hidden');
    setVisibility('visible');
    expect(subscribe).toHaveBeenCalledTimes(2);
  });

  it('does not subscribe at all when the tab starts hidden', () => {
    visibility = 'hidden';
    const subscribe = vi.fn(() => vi.fn());
    renderHook(() => useVisibleSubscription(subscribe));
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('releases the listener when the dashboard unmounts', () => {
    const release = vi.fn();
    const { unmount } = renderHook(() => useVisibleSubscription(vi.fn(() => release)));
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does not churn the listener on unrelated re-renders', () => {
    const subscribe = vi.fn(() => vi.fn());
    const { rerender } = renderHook(() => useVisibleSubscription(subscribe));
    rerender();
    rerender();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
