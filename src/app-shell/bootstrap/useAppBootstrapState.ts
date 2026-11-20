import React from 'react';
import { useDateNavigation } from '@/hooks/useDateNavigation';
import { useVersionCheck } from '@/hooks/useVersionCheck';
import { useStalenessGuard } from '@/hooks/useStalenessGuard';
import type { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { useStorageMigration } from '@/hooks/useStorageMigration';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import { defaultFirebaseConfigRuntimeAdapter } from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';
import { hasRecentAuthenticatedSessionHint } from '@/services/auth/authStorageHints';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { useAuth, type AuthContextType } from '@/context/AuthContext';

export type AppBootstrapState =
  | {
      status: 'loading';
      phase: 'bootstrapping' | 'rehydrating';
      auth: AuthContextType;
      /** The census day selection, kept while a session is admitted so the header shows it. */
      dateNav: UseDateNavigationReturn;
    }
  | {
      status: 'unauthenticated';
      phase: 'unauthenticated' | 'local_only';
      auth: AuthContextType;
    }
  | {
      status: 'authenticated';
      phase: 'authenticated';
      auth: AuthContextType;
      dateNav: UseDateNavigationReturn;
    };

interface BuildAppBootstrapStateParams {
  auth: AuthContextType;
  dateNav: UseDateNavigationReturn;
  hasRecentAuthenticatedSessionHint?: boolean;
}

const isIgnorableWorkerShutdownImportError = (error: unknown): boolean => {
  const message = String(error);
  return message.includes('[vitest-worker]: Closing rpc while "fetch" was pending');
};

const appLogger = createScopedLogger('App');

const FIRESTORE_RUNTIME_POLL_MS = 250;

const resolveAppLoadingPhase = (auth: AuthContextType): 'bootstrapping' | 'rehydrating' => {
  if (
    auth.sessionState.status === 'authenticating' ||
    auth.isFirebaseConnected ||
    auth.remoteSyncState.reason === 'auth_connecting'
  ) {
    return 'rehydrating';
  }

  return 'bootstrapping';
};

const resolveAppUnauthenticatedPhase = (auth: AuthContextType): 'unauthenticated' | 'local_only' =>
  auth.remoteSyncState.mode === 'local_only' ? 'local_only' : 'unauthenticated';

const shouldKeepSameTabRefreshRehydrating = ({
  auth,
  hasRecentAuthenticatedSessionHint,
}: Pick<BuildAppBootstrapStateParams, 'auth' | 'hasRecentAuthenticatedSessionHint'>): boolean =>
  !auth.isLoading &&
  !auth.isAuthenticated &&
  auth.sessionState.status === 'unauthenticated' &&
  Boolean(hasRecentAuthenticatedSessionHint) &&
  auth.authRuntime.bootstrapPending;

const resolveSyncedFirestoreState = (
  remoteSyncState: AuthContextType['remoteSyncState'],
  isFirestoreReady: boolean
): AuthContextType['remoteSyncState'] => {
  if (remoteSyncState.mode !== 'enabled') {
    return remoteSyncState;
  }

  if (isFirestoreReady) {
    return {
      mode: 'enabled',
      reason: 'ready',
    };
  }

  return {
    mode: 'bootstrapping',
    reason: 'auth_connecting',
  };
};

const useSyncFirestoreStatus = (remoteSyncState: AuthContextType['remoteSyncState']) => {
  React.useEffect(() => {
    const syncState = () => {
      try {
        const nextState = resolveSyncedFirestoreState(
          remoteSyncState,
          defaultFirebaseConfigRuntimeAdapter.getOptionalDb() !== null
        );
        setFirestoreSyncState(nextState);
        return nextState.mode === 'enabled';
      } catch (error) {
        if (isIgnorableWorkerShutdownImportError(error)) {
          return true;
        }
        appLogger.error('Failed to sync Firestore status', error);
        return true;
      }
    };

    if (syncState()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (syncState()) {
        window.clearInterval(intervalId);
      }
    }, FIRESTORE_RUNTIME_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [remoteSyncState]);
};

export const buildAppBootstrapState = ({
  auth,
  dateNav,
  hasRecentAuthenticatedSessionHint = false,
}: BuildAppBootstrapStateParams): AppBootstrapState => {
  if (
    auth.isLoading ||
    shouldKeepSameTabRefreshRehydrating({
      auth,
      hasRecentAuthenticatedSessionHint,
    })
  ) {
    return {
      status: 'loading',
      phase: auth.isLoading ? resolveAppLoadingPhase(auth) : 'rehydrating',
      auth,
      dateNav,
    };
  }

  if (!auth.isAuthenticated) {
    return {
      status: 'unauthenticated',
      phase: resolveAppUnauthenticatedPhase(auth),
      auth,
    };
  }

  return {
    status: 'authenticated',
    phase: 'authenticated',
    auth,
    dateNav,
  };
};

export const useAppBootstrapState = (openingDay: string): AppBootstrapState => {
  const auth = useAuth();
  const recentAuthenticatedSessionHint = hasRecentAuthenticatedSessionHint();

  useStorageMigration({ enabled: !auth.isLoading && auth.isAuthenticated });
  useVersionCheck();
  useStalenessGuard();
  useSyncFirestoreStatus(auth.remoteSyncState);

  const dateNav = useDateNavigation(openingDay);

  return React.useMemo<AppBootstrapState>(
    () =>
      buildAppBootstrapState({
        auth,
        dateNav,
        hasRecentAuthenticatedSessionHint: recentAuthenticatedSessionHint,
      }),
    [auth, dateNav, recentAuthenticatedSessionHint]
  );
};
