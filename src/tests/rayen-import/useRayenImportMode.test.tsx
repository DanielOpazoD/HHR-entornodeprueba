import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenImportMode } from '@/features/rayen-import/hooks/useRayenImportMode';
import type { RayenImportPolicySubscription } from '@/features/rayen-import/settings/rayenImportPolicyService';

const policyService = vi.hoisted(() => ({
  handlers: null as RayenImportPolicySubscription | null,
  subscribe: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@/features/rayen-import/settings/rayenImportPolicyService', () => ({
  subscribeToRayenImportPolicy: (handlers: RayenImportPolicySubscription) => {
    policyService.handlers = handlers;
    return policyService.subscribe(handlers);
  },
  saveRayenImportPolicy: policyService.save,
}));

describe('useRayenImportMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyService.handlers = null;
    policyService.subscribe.mockReturnValue(vi.fn());
    policyService.save.mockResolvedValue({ mode: 'preview', revision: 2 });
  });

  it('activates auto only from a server-confirmed policy', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', revision: 7 },
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({
        mode: 'auto',
        policy: { mode: 'auto', revision: 7 },
        status: 'ready',
        error: null,
      })
    );
  });

  it('fails closed when an auto policy is only available from cache', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', revision: 7 },
        exists: true,
        fromCache: true,
        hasPendingWrites: false,
      });
    });
    expect(result.current.mode).toBe('preview');
    expect(result.current.policy.revision).toBe(0);
    expect(result.current.status).toBe('fallback');
  });

  it('does not trust an unacknowledged local auto write', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', revision: 8 },
        exists: true,
        fromCache: false,
        hasPendingWrites: true,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({ mode: 'preview', status: 'fallback' })
    );
  });

  it('uses preview as the ready default when no global document exists', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: null,
        exists: false,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({ mode: 'preview', status: 'ready', error: null })
    );
  });

  it('fails closed on malformed data or subscription errors', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: null,
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({ mode: 'preview', status: 'fallback' })
    );
    act(() => policyService.handlers?.onError(new Error('offline')));
    expect(result.current).toEqual(
      expect.objectContaining({ mode: 'preview', status: 'fallback' })
    );
  });

  it('saves through the global service using the authenticated administrator', async () => {
    const { result } = renderHook(() => useRayenImportMode('admin-1'));
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: null,
        exists: false,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    await act(() => result.current.setMode('auto'));
    expect(policyService.save).toHaveBeenCalledWith({ mode: 'auto', updatedByUid: 'admin-1' });
    expect(result.current.isSaving).toBe(false);
  });
});
