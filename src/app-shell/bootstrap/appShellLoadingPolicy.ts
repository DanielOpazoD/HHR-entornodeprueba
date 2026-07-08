import type { AppBootstrapState } from '@/app-shell/bootstrap/useAppBootstrapState';
import { shouldRenderInitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';
import { hasActiveFirebaseSession } from '@/services/auth/authFallback';
import {
  hasPersistedFirebaseAuthHint,
  hasRecentAuthenticatedSessionHint,
} from '@/services/auth/authStorageHints';
import { resolveModuleFromPathname } from '@/hooks/controllers/appStateNavigationController';

export type AppShellLoadingScreenMode =
  | 'silent'
  | 'default'
  | 'login-shell'
  | 'bootstrap-route-chrome';

export interface PreMountLoadingScreenDecision {
  shouldRender: boolean;
  preferLoginShell: boolean;
  renderBootstrapRouteChrome: boolean;
}

export const resolvePreMountLoadingScreenDecision = ({
  pathname,
  hasRecentAuthenticatedSessionHint: providedRecentAuthenticatedSessionHint,
  hasPersistedFirebaseAuthHint: providedPersistedFirebaseAuthHint,
  hasActiveFirebaseSession: providedActiveFirebaseSession,
}: {
  pathname: string | undefined;
  hasRecentAuthenticatedSessionHint?: boolean;
  hasPersistedFirebaseAuthHint?: boolean;
  hasActiveFirebaseSession?: boolean;
}): PreMountLoadingScreenDecision => {
  const recentAuthenticatedSessionHint =
    providedRecentAuthenticatedSessionHint ?? hasRecentAuthenticatedSessionHint();
  const persistedFirebaseAuthHint =
    providedPersistedFirebaseAuthHint ?? hasPersistedFirebaseAuthHint();
  const activeFirebaseSession = providedActiveFirebaseSession ?? hasActiveFirebaseSession();
  const hasAuthenticatedSessionHint =
    recentAuthenticatedSessionHint || persistedFirebaseAuthHint || activeFirebaseSession;

  return {
    shouldRender: false,
    preferLoginShell: false,
    renderBootstrapRouteChrome:
      resolveModuleFromPathname(pathname) !== null && hasAuthenticatedSessionHint,
  };
};

export const resolveRuntimeLoadingScreenMode = ({
  pathname,
  bootstrapState,
  hasRecentAuthenticatedSessionHint: providedRecentAuthenticatedSessionHint,
  hasPersistedFirebaseAuthHint: providedPersistedFirebaseAuthHint,
  hasActiveFirebaseSession: providedActiveFirebaseSession,
}: {
  pathname: string | undefined;
  bootstrapState: Extract<AppBootstrapState, { status: 'loading' }>;
  hasRecentAuthenticatedSessionHint?: boolean;
  hasPersistedFirebaseAuthHint?: boolean;
  hasActiveFirebaseSession?: boolean;
}): AppShellLoadingScreenMode => {
  const normalizedPath = (pathname ?? '/').replace(/^\/+|\/+$/g, '');
  const routeModule = resolveModuleFromPathname(pathname);
  const recentAuthenticatedSessionHint =
    providedRecentAuthenticatedSessionHint ?? hasRecentAuthenticatedSessionHint();
  const persistedFirebaseAuthHint =
    providedPersistedFirebaseAuthHint ?? hasPersistedFirebaseAuthHint();
  const activeFirebaseSession = providedActiveFirebaseSession ?? hasActiveFirebaseSession();
  const rehydratingAuthenticatedSession =
    bootstrapState.auth.sessionState.status === 'authenticating';
  const hasAuthenticatedSessionHint =
    recentAuthenticatedSessionHint ||
    persistedFirebaseAuthHint ||
    activeFirebaseSession ||
    rehydratingAuthenticatedSession ||
    bootstrapState.auth.isAuthenticated ||
    Boolean(bootstrapState.auth.currentUser);

  if (
    routeModule !== null &&
    hasAuthenticatedSessionHint &&
    (bootstrapState.phase === 'rehydrating' || normalizedPath.length > 0)
  ) {
    return 'bootstrap-route-chrome';
  }

  if (!shouldRenderInitialLoadingScreen(pathname)) {
    return 'silent';
  }

  return 'silent';
};
