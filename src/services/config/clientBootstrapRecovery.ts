import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { createScopedLogger } from '@/services/utils/loggerScope';
import {
  POST_DEPLOY_RECENT_RECORD_REFRESH_KEY,
  writePostDeployRecentRecordRefreshMarker,
} from '@/services/config/postDeployRecentRecordRefresh';

const VERSION_KEY = 'hhr_app_version';
const FIREBASE_CONFIG_CACHE_KEY = 'hhr_firebase_config';
const BOOTSTRAP_RECOVERY_KEY = 'hhr_bootstrap_recovery_v1';
const VERSION_URL = '/version.json';

export type BootstrapRecoveryReason = 'legacy-sw' | 'version-change' | 'local-dev';
export type ClientBootstrapRecoveryStatus = 'continue' | 'reload';

export interface ClientBootstrapRecoveryResult {
  status: ClientBootstrapRecoveryStatus;
  reason: BootstrapRecoveryReason | null;
}

interface VersionInfo {
  version: string;
  buildDate: string;
}

interface ServiceWorkerRegistrationLike {
  unregister: () => Promise<boolean>;
  active?: { scriptURL?: string } | null;
  waiting?: { scriptURL?: string } | null;
  installing?: { scriptURL?: string } | null;
}

const bootstrapRecoveryLogger = createScopedLogger('BootstrapRecovery');

const canUseBrowser = (): boolean =>
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  typeof localStorage !== 'undefined' &&
  typeof sessionStorage !== 'undefined';

const isLocalHost = (): boolean => {
  if (!canUseBrowser()) {
    return false;
  }

  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(window.location.hostname);
};

const readRecoveryAttempt = (): BootstrapRecoveryReason | null => {
  if (!canUseBrowser()) {
    return null;
  }

  const raw = sessionStorage.getItem(BOOTSTRAP_RECOVERY_KEY);
  return raw === 'legacy-sw' || raw === 'version-change' ? raw : null;
};

const writeRecoveryAttempt = (reason: BootstrapRecoveryReason): void => {
  if (!canUseBrowser()) {
    return;
  }

  sessionStorage.setItem(BOOTSTRAP_RECOVERY_KEY, reason);
};

const clearRecoveryAttempt = (): void => {
  if (!canUseBrowser()) {
    return;
  }

  sessionStorage.removeItem(BOOTSTRAP_RECOVERY_KEY);
};

const isJsonResponse = (contentType: string | null): boolean =>
  typeof contentType === 'string' && contentType.toLowerCase().includes('application/json');

const getRegistrationScriptUrls = (registration: ServiceWorkerRegistrationLike): string[] =>
  [registration.active, registration.waiting, registration.installing]
    .map(worker => String(worker?.scriptURL || ''))
    .filter(Boolean);

const isLegacyServiceWorkerRegistration = (registration: ServiceWorkerRegistrationLike): boolean =>
  getRegistrationScriptUrls(registration).some(scriptUrl => scriptUrl.endsWith('/sw.js'));

const getServiceWorkerRegistrations = async (): Promise<
  readonly ServiceWorkerRegistrationLike[]
> => {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return [];
  }

  return Array.from(await navigator.serviceWorker.getRegistrations());
};

const unregisterServiceWorkers = async (
  predicate: (registration: ServiceWorkerRegistrationLike) => boolean
): Promise<number> => {
  const registrations = await getServiceWorkerRegistrations();
  const targets = registrations.filter(predicate);
  if (targets.length === 0) {
    return 0;
  }

  await Promise.all(targets.map(registration => registration.unregister()));
  return targets.length;
};

const clearBrowserCaches = async (): Promise<void> => {
  if (typeof caches === 'undefined') {
    return;
  }

  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
};

const clearBootstrapRuntimeCache = (): void => {
  if (!canUseBrowser()) {
    return;
  }

  localStorage.removeItem(FIREBASE_CONFIG_CACHE_KEY);
};

const fetchVersionInfo = async (): Promise<VersionInfo | null> => {
  if (typeof fetch === 'undefined') {
    return null;
  }

  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    });

    if (!response.ok) {
      bootstrapRecoveryLogger.warn('version.json not available during bootstrap', {
        status: response.status,
      });
      return null;
    }

    if (!isJsonResponse(response.headers.get('content-type'))) {
      return null;
    }

    const versionInfo = (await response.json()) as Partial<VersionInfo>;
    if (!String(versionInfo.version || '').trim()) {
      return null;
    }

    return {
      version: String(versionInfo.version),
      buildDate: String(versionInfo.buildDate || ''),
    };
  } catch (error) {
    bootstrapRecoveryLogger.warn('Failed to fetch version.json during bootstrap', error);
    return null;
  }
};

const getFallbackVersionInfo = (): VersionInfo | null => {
  const buildVersion = String(
    typeof __APP_BUILD_VERSION__ === 'string' ? __APP_BUILD_VERSION__ : ''
  );
  if (!buildVersion.trim()) {
    return null;
  }

  return {
    version: buildVersion,
    buildDate: '',
  };
};

const performRecoveryReload = async (
  reason: BootstrapRecoveryReason
): Promise<ClientBootstrapRecoveryResult> => {
  writeRecoveryAttempt(reason);
  clearBootstrapRuntimeCache();
  await clearBrowserCaches();
  await unregisterServiceWorkers(() => true);
  defaultBrowserWindowRuntime.reload();
  return {
    status: 'reload',
    reason,
  };
};

export const prepareClientBootstrap = async (): Promise<ClientBootstrapRecoveryResult> => {
  if (!canUseBrowser()) {
    return {
      status: 'continue',
      reason: null,
    };
  }

  if (isLocalHost()) {
    void unregisterServiceWorkers(() => true).catch(error => {
      bootstrapRecoveryLogger.warn('Local service worker cleanup failed during bootstrap', error);
    });
    clearRecoveryAttempt();
    return {
      status: 'continue',
      reason: 'local-dev',
    };
  }

  const recoveryAttempt = readRecoveryAttempt();
  const legacyWorkerCount = await unregisterServiceWorkers(isLegacyServiceWorkerRegistration);

  if (legacyWorkerCount > 0) {
    bootstrapRecoveryLogger.warn('Removed legacy service worker registrations', {
      registrations: legacyWorkerCount,
    });

    if (recoveryAttempt !== 'legacy-sw') {
      return performRecoveryReload('legacy-sw');
    }
  }

  const serverVersion = (await fetchVersionInfo()) || getFallbackVersionInfo();
  if (!serverVersion) {
    if (legacyWorkerCount === 0) {
      clearRecoveryAttempt();
    }
    return {
      status: 'continue',
      reason: null,
    };
  }

  const localVersion = defaultBrowserWindowRuntime.getLocalStorageItem(VERSION_KEY);
  if (!localVersion) {
    defaultBrowserWindowRuntime.setLocalStorageItem(VERSION_KEY, serverVersion.version);
    clearRecoveryAttempt();
    return {
      status: 'continue',
      reason: null,
    };
  }

  if (localVersion !== serverVersion.version) {
    bootstrapRecoveryLogger.warn('Detected deploy version mismatch during bootstrap', {
      localVersion,
      serverVersion: serverVersion.version,
    });

    defaultBrowserWindowRuntime.setLocalStorageItem(VERSION_KEY, serverVersion.version);
    writePostDeployRecentRecordRefreshMarker({
      fromVersion: localVersion,
      toVersion: serverVersion.version,
    });
    if (recoveryAttempt !== 'version-change') {
      return performRecoveryReload('version-change');
    }
  }

  clearRecoveryAttempt();
  return {
    status: 'continue',
    reason: null,
  };
};

export const getClientBootstrapRecoveryConstants = () => ({
  bootstrapRecoveryKey: BOOTSTRAP_RECOVERY_KEY,
  firebaseConfigCacheKey: FIREBASE_CONFIG_CACHE_KEY,
  postDeployRecentRecordRefreshKey: POST_DEPLOY_RECENT_RECORD_REFRESH_KEY,
  versionKey: VERSION_KEY,
});
