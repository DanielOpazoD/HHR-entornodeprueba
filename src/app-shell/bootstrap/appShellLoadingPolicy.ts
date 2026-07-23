import type { AppBootstrapState } from '@/app-shell/bootstrap/useAppBootstrapState';
import { resolveInitialLoadingScreenVariant } from '@/components/ui/InitialLoadingScreen';
import { hasActiveFirebaseSession } from '@/services/auth/authFallback';
import { hasRecentManualLogout } from '@/services/auth/authLogoutState';
import {
  hasPersistedFirebaseAuthHint,
  hasRecentAuthenticatedSessionHint,
} from '@/services/auth/authStorageHints';
import { resolveModuleFromPathname } from '@/hooks/controllers/appStateNavigationController';

export type AppShellLoadingScreenMode = 'default' | 'login-shell' | 'bootstrap-route-chrome';

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
  hasRecentManualLogout: providedRecentManualLogout,
}: {
  pathname: string | undefined;
  hasRecentAuthenticatedSessionHint?: boolean;
  hasPersistedFirebaseAuthHint?: boolean;
  hasActiveFirebaseSession?: boolean;
  hasRecentManualLogout?: boolean;
}): PreMountLoadingScreenDecision => {
  const recentAuthenticatedSessionHint =
    providedRecentAuthenticatedSessionHint ?? hasRecentAuthenticatedSessionHint();
  const persistedFirebaseAuthHint =
    providedPersistedFirebaseAuthHint ?? hasPersistedFirebaseAuthHint();
  const activeFirebaseSession = providedActiveFirebaseSession ?? hasActiveFirebaseSession();
  const recentManualLogout = providedRecentManualLogout ?? hasRecentManualLogout();
  // A recent manual logout overrides stale storage hints: the user chose to
  // leave, so refreshes must land on the login shell, never the app chrome.
  // An active Firebase session (a completed re-login) always wins over it.
  const hasAuthenticatedSessionHint =
    activeFirebaseSession ||
    ((recentAuthenticatedSessionHint || persistedFirebaseAuthHint) && !recentManualLogout);

  const renderBootstrapRouteChrome =
    resolveModuleFromPathname(pathname) !== null && hasAuthenticatedSessionHint;

  // F5 must keep the screen the user refreshed from: authenticated module
  // refreshes keep their route chrome; every other load renders the pre-auth
  // shell (login-styled on the root/login route) instead of a blank wallpaper.
  return {
    shouldRender: !renderBootstrapRouteChrome,
    preferLoginShell: !renderBootstrapRouteChrome,
    renderBootstrapRouteChrome,
  };
};

export const resolveRuntimeLoadingScreenMode = ({
  pathname,
  bootstrapState,
  hasRecentAuthenticatedSessionHint: providedRecentAuthenticatedSessionHint,
  hasPersistedFirebaseAuthHint: providedPersistedFirebaseAuthHint,
  hasActiveFirebaseSession: providedActiveFirebaseSession,
  hasRecentManualLogout: providedRecentManualLogout,
}: {
  pathname: string | undefined;
  bootstrapState: Extract<AppBootstrapState, { status: 'loading' }>;
  hasRecentAuthenticatedSessionHint?: boolean;
  hasPersistedFirebaseAuthHint?: boolean;
  hasActiveFirebaseSession?: boolean;
  hasRecentManualLogout?: boolean;
}): AppShellLoadingScreenMode => {
  const normalizedPath = (pathname ?? '/').replace(/^\/+|\/+$/g, '');
  const routeModule = resolveModuleFromPathname(pathname);
  const recentAuthenticatedSessionHint =
    providedRecentAuthenticatedSessionHint ?? hasRecentAuthenticatedSessionHint();
  const persistedFirebaseAuthHint =
    providedPersistedFirebaseAuthHint ?? hasPersistedFirebaseAuthHint();
  const activeFirebaseSession = providedActiveFirebaseSession ?? hasActiveFirebaseSession();
  const recentManualLogout = providedRecentManualLogout ?? hasRecentManualLogout();
  const rehydratingAuthenticatedSession =
    bootstrapState.auth.sessionState.status === 'authenticating';
  // Storage-only hints are ignored right after a manual logout (stale copies);
  // live auth signals (active session, authenticated state) always win.
  const hasAuthenticatedSessionHint =
    activeFirebaseSession ||
    rehydratingAuthenticatedSession ||
    bootstrapState.auth.isAuthenticated ||
    Boolean(bootstrapState.auth.currentUser) ||
    ((recentAuthenticatedSessionHint || persistedFirebaseAuthHint) && !recentManualLogout);

  const hasAuthorizedSession = bootstrapState.auth.sessionState.status === 'authorized';
  if (
    routeModule !== null &&
    (hasAuthenticatedSessionHint || hasAuthorizedSession) &&
    (bootstrapState.phase === 'rehydrating' || normalizedPath.length > 0 || hasAuthorizedSession)
  ) {
    return 'bootstrap-route-chrome';
  }

  // Loading without an authenticated route chrome keeps the screen the user
  // refreshed from: the login shell on the root/login route, a neutral loader
  // elsewhere — never a blank page.
  return resolveInitialLoadingScreenVariant(pathname) === 'login-shell' ? 'login-shell' : 'default';
};
