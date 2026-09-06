import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStaffUsage } from '@/hooks/useStaffUsage';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';

const db = vi.hoisted(() => ({ read: vi.fn(), limit: vi.fn() }));
vi.mock('@/services/storage/indexeddb/indexedDbCore', () => ({
  ensureDbReady: vi.fn().mockResolvedValue(undefined),
  hospitalDB: { dailyRecords: { orderBy: () => ({ reverse: () => ({ limit: db.limit }) }) } },
}));

describe('useStaffUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.limit.mockReturnValue({ toArray: db.read });
  });

  it('bounds local reads and reuses them when the identity catalogue changes', async () => {
    db.read.mockResolvedValue([{ nursesDayShift: ['Ana Soto'], tensDayShift: ['Berta Perez'] }]);
    const { wrapper } = createQueryClientTestWrapper();
    const { result, rerender } = renderHook(
      ({ full }: { full: boolean }) =>
        useStaffUsage(
          full
            ? [{ key: 'nurse:a', role: 'nurse', name: 'Ana Soto Diaz', aliases: ['Ana Soto'] }]
            : []
        ),
      { wrapper, initialProps: { full: false } }
    );
    await waitFor(() => expect(result.current.nurse['ana soto']).toBe(1));
    expect(db.limit).toHaveBeenCalledWith(90);
    rerender({ full: true });
    expect(result.current.nurse['ana soto diaz']).toBe(1);
    expect(result.current.tens['berta perez']).toBe(1);
    expect(db.read).toHaveBeenCalledTimes(1);
  });

  it('falls back to no ranking when local history is unavailable', async () => {
    db.read.mockRejectedValue(new Error('offline local storage'));
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useStaffUsage([]), { wrapper });
    await waitFor(() => expect(db.read).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual({ nurse: {}, tens: {} });
  });
});
