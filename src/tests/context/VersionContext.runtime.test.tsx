import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_SCHEMA_VERSION, LEGACY_SCHEMA_VERSION } from '@/constants/version';
import {
  BACKEND_RUNTIME_CONTRACT_VERSION,
  CLIENT_RUNTIME_CONTRACT_VERSION,
} from '@/constants/runtimeContracts';
import type { RemoteRuntimeContract } from '@/services/config/runtimeContractClient';

vi.unmock('@/context/VersionContext');
const fetchContract = vi.hoisted(() => vi.fn());
vi.mock('@/services/config/runtimeContractClient', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/config/runtimeContractClient')>()),
  fetchRemoteRuntimeContract: fetchContract,
}));
import { VersionProvider, useVersion } from '@/context/VersionContext';

const compatible: RemoteRuntimeContract = {
  backendRuntimeContractVersion: BACKEND_RUNTIME_CONTRACT_VERSION,
  minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION,
  supportedSchemaVersion: CURRENT_SCHEMA_VERSION,
  legacySchemaFloorVersion: LEGACY_SCHEMA_VERSION,
};
const deferredContract = () => {
  let resolve!: (value: RemoteRuntimeContract | null) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RemoteRuntimeContract | null>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  fetchContract.mockReset().mockResolvedValue(compatible);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('runtime contract provider lifecycle', () => {
  it('shares an in-flight check across mount, focus, visibility and manual triggers', async () => {
    const first = deferredContract();
    fetchContract.mockReturnValueOnce(first.promise);
    const view = renderHook(() => useVersion(), { wrapper: VersionProvider });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      void view.result.current.checkRuntimeContract();
    });
    expect(fetchContract).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(compatible));
    expect(view.result.current.runtimeContract).toEqual(compatible);
    await act(async () => view.result.current.checkRuntimeContract());
    expect(fetchContract).toHaveBeenCalledTimes(2);
  });

  it('does not clear a newer schema observation when an older compatible response arrives', async () => {
    const first = deferredContract();
    fetchContract.mockReturnValueOnce(first.promise);
    const view = renderHook(() => useVersion(), { wrapper: VersionProvider });
    act(() => view.result.current.checkVersion(CURRENT_SCHEMA_VERSION + 1));
    await act(async () => first.resolve(compatible));
    expect(view.result.current.isOutdated).toBe(true);
    expect(view.result.current.updateReason).toBe('schema_ahead_of_client');
    expect(view.result.current.remoteVersion).toBe(CURRENT_SCHEMA_VERSION + 1);
    expect(fetchContract).toHaveBeenCalledTimes(1);
  });

  it('publishes the in-flight check before request initiation can re-enter it', async () => {
    const view = renderHook(() => useVersion(), { wrapper: VersionProvider });
    await act(async () => undefined);
    const pending = deferredContract();
    fetchContract.mockImplementationOnce(() => {
      window.dispatchEvent(new Event('focus'));
      return pending.promise;
    });
    await act(async () => {
      void view.result.current.checkRuntimeContract();
    });
    expect(fetchContract).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(compatible));
  });

  it('recovers after a rejected check without suppressing the next explicit check', async () => {
    const first = deferredContract();
    fetchContract.mockReturnValueOnce(first.promise);
    const view = renderHook(() => useVersion(), { wrapper: VersionProvider });
    await act(async () => first.reject(new Error('synthetic offline')));
    expect(view.result.current.runtimeContract).toBeNull();
    await act(async () => view.result.current.checkRuntimeContract());
    expect(view.result.current.runtimeContract).toEqual(compatible);
    expect(fetchContract).toHaveBeenCalledTimes(2);
  });

  it('shows a runtime incompatibility then clears it after an explicit compatible check', async () => {
    fetchContract.mockResolvedValue({
      ...compatible,
      minSupportedClientRuntimeContractVersion: CLIENT_RUNTIME_CONTRACT_VERSION + 1,
    });
    const view = renderHook(() => useVersion(), { wrapper: VersionProvider });
    await act(async () => undefined);
    expect(view.result.current.isOutdated).toBe(true);
    expect(view.result.current.updateReason).toBe('runtime_contract_mismatch');
    fetchContract.mockResolvedValue(compatible);
    await act(async () => view.result.current.checkRuntimeContract());
    expect(view.result.current.isOutdated).toBe(false);
    expect(view.result.current.updateReason).toBe('current');
    expect(fetchContract).toHaveBeenCalledTimes(2);
  });

  it('does not start a check from an old callback after unmount', async () => {
    const view = renderHook(() => useVersion(), { wrapper: VersionProvider });
    await act(async () => undefined);
    const check = view.result.current.checkRuntimeContract;
    view.unmount();
    await act(async () => {
      await check();
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(fetchContract).toHaveBeenCalledTimes(1);
  });
});
