import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenImportMode } from '@/features/rayen-import/hooks/useRayenImportMode';
import type { RayenImportPolicySubscription } from '@/features/rayen-import/settings/rayenImportPolicyService';

const policyService = vi.hoisted(() => ({
  handlers: null as RayenImportPolicySubscription | null,
  subscribe: vi.fn(),
  initialize: vi.fn(),
  migrate: vi.fn(),
  save: vi.fn(),
  saveClinical: vi.fn(),
}));

vi.mock('@/features/rayen-import/settings/rayenImportPolicyService', () => ({
  subscribeToRayenImportPolicy: (handlers: RayenImportPolicySubscription) => {
    policyService.handlers = handlers;
    return policyService.subscribe(handlers);
  },
  initializeRayenImportPolicy: policyService.initialize,
  migrateRayenImportPolicy: policyService.migrate,
  saveRayenImportPolicy: policyService.save,
  saveRayenClinicalBatchMode: policyService.saveClinical,
}));

describe('useRayenImportMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policyService.handlers = null;
    policyService.subscribe.mockReturnValue(vi.fn());
    policyService.initialize.mockResolvedValue({
      mode: 'preview',
      clinicalBatchMode: 'off',
      revision: 1,
    });
    policyService.migrate.mockResolvedValue({
      mode: 'auto',
      clinicalBatchMode: 'off',
      revision: 5,
    });
    policyService.save.mockResolvedValue({
      mode: 'preview',
      clinicalBatchMode: 'off',
      revision: 2,
    });
    policyService.saveClinical.mockResolvedValue({
      mode: 'preview',
      clinicalBatchMode: 'enforced',
      revision: 3,
    });
  });

  it('activates auto only from a server-confirmed policy', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', clinicalBatchMode: 'enforced', revision: 7 },
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({
        mode: 'auto',
        clinicalBatchMode: 'enforced',
        policy: { mode: 'auto', clinicalBatchMode: 'enforced', revision: 7 },
        status: 'ready',
        error: null,
      })
    );
  });

  it('fails closed when an auto policy is only available from cache', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', clinicalBatchMode: 'enforced', revision: 7 },
        exists: true,
        fromCache: true,
        hasPendingWrites: false,
      });
    });
    expect(result.current.mode).toBe('preview');
    expect(result.current.clinicalBatchMode).toBe('off');
    expect(result.current.policy.revision).toBe(0);
    expect(result.current.status).toBe('fallback');
  });

  it('applies the server-confirmed off mode as the explicit clinical rollback', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', clinicalBatchMode: 'off', revision: 9 },
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    expect(result.current).toEqual(
      expect.objectContaining({
        mode: 'auto',
        clinicalBatchMode: 'off',
        status: 'ready',
      })
    );
  });

  it('does not trust an unacknowledged local auto write', () => {
    const { result } = renderHook(() => useRayenImportMode());
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', clinicalBatchMode: 'enforced', revision: 8 },
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
      expect.objectContaining({ mode: 'preview', clinicalBatchMode: 'off', status: 'unconfigured' })
    );
  });

  it('blocks a confirmed v1 policy until an administrator migrates it atomically', async () => {
    const { result } = renderHook(() => useRayenImportMode('admin-1'));
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'auto', clinicalBatchMode: 'off', revision: 4 },
        exists: true,
        requiresMigration: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });

    expect(result.current).toEqual(
      expect.objectContaining({
        mode: 'auto',
        clinicalBatchMode: 'off',
        status: 'migration-required',
      })
    );
    await expect(result.current.setMode('preview')).rejects.toThrow('no está disponible');
    await act(() => result.current.migrateLegacyPolicy());
    expect(policyService.migrate).toHaveBeenCalledWith({ updatedByUid: 'admin-1' });
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
        policy: { mode: 'preview', clinicalBatchMode: 'off', revision: 1 },
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    await act(() => result.current.setMode('auto'));
    expect(policyService.save).toHaveBeenCalledWith({ mode: 'auto', updatedByUid: 'admin-1' });
    expect(result.current.isSaving).toBe(false);
  });

  it('allows an administrator to initialize the safe policy when the document is absent', async () => {
    const { result } = renderHook(() => useRayenImportMode('admin-1'));
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: null,
        exists: false,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    await act(() => result.current.initializeSafePolicy());
    expect(policyService.initialize).toHaveBeenCalledWith({ updatedByUid: 'admin-1' });
    expect(policyService.save).not.toHaveBeenCalled();
    expect(policyService.saveClinical).not.toHaveBeenCalled();
  });

  it('does not allow an unconfigured policy to skip safe initialization', async () => {
    const { result } = renderHook(() => useRayenImportMode('admin-1'));
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: null,
        exists: false,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    await expect(result.current.setMode('auto')).rejects.toThrow(
      'La política global aún no está disponible para edición.'
    );
    await expect(result.current.setClinicalBatchMode('enforced')).rejects.toThrow(
      'La política global aún no está disponible para edición.'
    );
    expect(policyService.save).not.toHaveBeenCalled();
    expect(policyService.saveClinical).not.toHaveBeenCalled();
  });

  it('updates the clinical mode through the same confirmed global policy', async () => {
    const { result } = renderHook(() => useRayenImportMode('admin-1'));
    act(() => {
      policyService.handlers?.onSnapshot({
        policy: { mode: 'preview', clinicalBatchMode: 'shadow', revision: 2 },
        exists: true,
        fromCache: false,
        hasPendingWrites: false,
      });
    });
    await act(() => result.current.setClinicalBatchMode('enforced'));
    expect(policyService.saveClinical).toHaveBeenCalledWith({
      clinicalBatchMode: 'enforced',
      updatedByUid: 'admin-1',
    });
  });
});
