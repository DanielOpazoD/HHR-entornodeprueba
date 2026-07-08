import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetLocalStorageItem, mockSetLocalStorageItem, mockReload } = vi.hoisted(() => ({
  mockGetLocalStorageItem: vi.fn(),
  mockSetLocalStorageItem: vi.fn(),
  mockReload: vi.fn(),
}));

vi.mock('@/shared/runtime/browserWindowRuntimeCore', async () => {
  const { createMockBrowserWindowRuntime } = await import('@/tests/utils/browserWindowRuntimeMock');

  return {
    defaultBrowserWindowRuntime: createMockBrowserWindowRuntime({
      getLocalStorageItem: mockGetLocalStorageItem,
      setLocalStorageItem: mockSetLocalStorageItem,
      reload: mockReload,
    }),
  };
});

import {
  getClientBootstrapRecoveryConstants,
  prepareClientBootstrap,
} from '@/services/config/clientBootstrapRecovery';

type ServiceWorkerRegistrationStub = {
  unregister: ReturnType<typeof vi.fn>;
  active?: { scriptURL?: string } | null;
  waiting?: { scriptURL?: string } | null;
  installing?: { scriptURL?: string } | null;
};

const createRegistration = (scriptURL: string): ServiceWorkerRegistrationStub => ({
  unregister: vi.fn().mockResolvedValue(true),
  active: { scriptURL },
  waiting: null,
  installing: null,
});

describe('prepareClientBootstrap', () => {
  let mockCachesDelete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    mockGetLocalStorageItem.mockReset();
    mockSetLocalStorageItem.mockReset();
    mockReload.mockReset();

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        hostname: 'app.example.com',
      },
    });

    mockCachesDelete = vi.fn().mockResolvedValue(true);

    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      value: {
        keys: vi.fn().mockResolvedValue(['static-v1']),
        delete: mockCachesDelete,
      },
    });

    Object.defineProperty(globalThis.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistrations: vi.fn().mockResolvedValue([]),
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: () => 'application/json; charset=utf-8',
        },
        json: vi.fn().mockResolvedValue({
          version: 'deploy-002',
          buildDate: '2026-04-03T00:00:00.000Z',
        }),
      })
    );
  });

  it('stores the current version on first bootstrap visit', async () => {
    mockGetLocalStorageItem.mockReturnValue(null);

    const result = await prepareClientBootstrap();

    expect(result).toEqual({ status: 'continue', reason: null });
    expect(mockSetLocalStorageItem).toHaveBeenCalledWith('hhr_app_version', 'deploy-002');
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('does not block local preview startup while cleaning service workers', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        hostname: '127.0.0.1',
      },
    });
    let resolveRegistrations!: (value: ServiceWorkerRegistrationStub[]) => void;
    const registrationsPromise = new Promise<ServiceWorkerRegistrationStub[]>(resolve => {
      resolveRegistrations = resolve;
    });
    (navigator.serviceWorker.getRegistrations as ReturnType<typeof vi.fn>).mockReturnValue(
      registrationsPromise
    );

    const resultPromise = prepareClientBootstrap();
    let result: Awaited<ReturnType<typeof prepareClientBootstrap>> | null = null;
    resultPromise.then(value => {
      result = value;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toEqual({ status: 'continue', reason: 'local-dev' });
    expect(navigator.serviceWorker.getRegistrations).toHaveBeenCalledTimes(1);
    expect(mockReload).not.toHaveBeenCalled();

    resolveRegistrations([]);
    await registrationsPromise;
  });

  it('reloads once when a legacy /sw.js registration is detected', async () => {
    const legacyRegistration = createRegistration('https://app.example.com/sw.js');
    (navigator.serviceWorker.getRegistrations as ReturnType<typeof vi.fn>).mockResolvedValue([
      legacyRegistration,
    ]);
    mockGetLocalStorageItem.mockReturnValue('deploy-002');

    const { firebaseConfigCacheKey, bootstrapRecoveryKey } = getClientBootstrapRecoveryConstants();
    localStorage.setItem(firebaseConfigCacheKey, JSON.stringify({ apiKey: 'stale' }));

    const result = await prepareClientBootstrap();

    expect(result).toEqual({ status: 'reload', reason: 'legacy-sw' });
    expect(legacyRegistration.unregister).toHaveBeenCalledTimes(2);
    expect(mockCachesDelete).toHaveBeenCalledWith('static-v1');
    expect(localStorage.getItem(firebaseConfigCacheKey)).toBeNull();
    expect(sessionStorage.getItem(bootstrapRecoveryKey)).toBe('legacy-sw');
    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it('reloads once when the deployed version changes', async () => {
    mockGetLocalStorageItem.mockReturnValue('deploy-001');

    const { firebaseConfigCacheKey, bootstrapRecoveryKey, postDeployRecentRecordRefreshKey } =
      getClientBootstrapRecoveryConstants();
    localStorage.setItem(firebaseConfigCacheKey, JSON.stringify({ apiKey: 'stale' }));

    const result = await prepareClientBootstrap();

    expect(result).toEqual({ status: 'reload', reason: 'version-change' });
    expect(mockSetLocalStorageItem).toHaveBeenCalledWith('hhr_app_version', 'deploy-002');
    expect(mockCachesDelete).toHaveBeenCalledWith('static-v1');
    expect(localStorage.getItem(firebaseConfigCacheKey)).toBeNull();
    expect(sessionStorage.getItem(bootstrapRecoveryKey)).toBe('version-change');
    expect(
      JSON.parse(localStorage.getItem(postDeployRecentRecordRefreshKey) || '{}')
    ).toMatchObject({
      reason: 'version-change',
      fromVersion: 'deploy-001',
      toVersion: 'deploy-002',
    });
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});
