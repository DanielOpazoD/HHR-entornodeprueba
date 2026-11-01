import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenImportMode } from '@/features/rayen-import/hooks/useRayenImportMode';
import type { RayenImportPolicySubscription } from '@/features/rayen-import/settings/rayenImportPolicyService';

const policyService = vi.hoisted(() => ({
  handlers: null as RayenImportPolicySubscription | null,
  subscribe: vi.fn(),
}));

vi.mock('@/features/rayen-import/settings/rayenImportPolicyService', () => ({
  subscribeToRayenImportPolicy: (handlers: RayenImportPolicySubscription) => {
    policyService.handlers = handlers;
    return policyService.subscribe(handlers);
  },
}));

describe('useRayenImportMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyService.handlers = null;
    policyService.subscribe.mockReturnValue(vi.fn());
  });

  it('accepts only a server-confirmed policy', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 7 },
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({
        mode: 'preview',
        clinicalBatchMode: 'enforced',
        policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 7 },
        status: 'ready',
        error: null,
      })
    );
  });

  it('fails closed when a policy is only available from cache', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 7 },
        exists: true,
        fromCache: true,
        hasPendingWrites: false,
      });
    });
    expect(result.current.mode).toBe('preview');
    expect(result.current.clinicalBatchMode).toBe('enforced');
    expect(result.current.policy.revision).toBe(0);
    expect(result.current.status).toBe('fallback');
  });

  it('does not trust an unacknowledged local policy write', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 8 },
        exists: true,
        fromCache: false,
        hasPendingWrites: true,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({ mode: 'preview', status: 'fallback' })
    );
  });

  it('blocks new runs until an administrator initializes a missing global document', () => {
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
      expect.objectContaining({
        mode: 'preview',
        clinicalBatchMode: 'enforced',
        status: 'unconfigured',
      })
    );
  });

  it('blocks a confirmed v1 policy requiring migration', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 4 },
        exists: true,
        requiresMigration: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });

    expect(result.current).toEqual(
      expect.objectContaining({
        mode: 'preview',
        clinicalBatchMode: 'enforced',
        status: 'migration-required',
      })
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
});
