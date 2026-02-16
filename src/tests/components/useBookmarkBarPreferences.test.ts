import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockSubscribeToBookmarkPreferences = vi.fn();
const mockSaveBookmarkPreferences = vi.fn();

vi.mock('@/services/bookmarks/bookmarkService', () => ({
  subscribeToBookmarkPreferences: (...args: unknown[]) =>
    mockSubscribeToBookmarkPreferences(...args),
  saveBookmarkPreferences: (...args: unknown[]) => mockSaveBookmarkPreferences(...args),
}));

import { useBookmarkBarPreferences } from '@/components/bookmarks/hooks/useBookmarkBarPreferences';

describe('useBookmarkBarPreferences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hydrates preferences from subscription', async () => {
    mockSubscribeToBookmarkPreferences.mockImplementation((onUpdate: (prefs: unknown) => void) => {
      onUpdate({ alignment: 'center', customOffset: 30 });
      return vi.fn();
    });

    const { result } = renderHook(() => useBookmarkBarPreferences());

    await waitFor(() => {
      expect(result.current.alignment).toBe('center');
      expect(result.current.customOffset).toBe(30);
      expect(result.current.alignmentClass).toBe('justify-center');
    });
  });

  it('debounces and saves alignment/offset updates', async () => {
    mockSubscribeToBookmarkPreferences.mockImplementation((onUpdate: (prefs: unknown) => void) => {
      onUpdate({ alignment: 'left', customOffset: 25 });
      return vi.fn();
    });

    const { result } = renderHook(() => useBookmarkBarPreferences());

    await waitFor(() => {
      expect(result.current.alignment).toBe('left');
      expect(result.current.customOffset).toBe(25);
    });

    vi.useFakeTimers();

    act(() => {
      result.current.setAlignmentPreference('right');
      vi.advanceTimersByTime(500);
    });

    expect(mockSaveBookmarkPreferences).toHaveBeenCalledWith({
      alignment: 'right',
      customOffset: 25,
    });

    act(() => {
      result.current.setCustomOffsetPreference(100);
      vi.advanceTimersByTime(500);
    });

    expect(result.current.customOffset).toBe(80);
    expect(mockSaveBookmarkPreferences).toHaveBeenCalledWith({
      alignment: 'right',
      customOffset: 80,
    });
  });
});
