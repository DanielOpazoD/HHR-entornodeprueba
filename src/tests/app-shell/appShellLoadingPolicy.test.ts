import { describe, expect, it } from 'vitest';
import {
  resolvePreMountLoadingScreenDecision,
  resolveRuntimeLoadingScreenMode,
} from '@/app-shell/bootstrap/appShellLoadingPolicy';
import type { AppBootstrapState } from '@/app-shell/bootstrap/useAppBootstrapState';

const createLoadingBootstrapState = (phase: 'bootstrapping' | 'rehydrating') =>
  ({
    status: 'loading',
    phase,
    auth: {
      sessionState: {
        status: 'unauthenticated',
        user: null,
      },
    },
  }) as unknown as Extract<AppBootstrapState, { status: 'loading' }>;

const createAuthorizedLoadingBootstrapState = (phase: 'bootstrapping' | 'rehydrating') =>
  ({
    status: 'loading',
    phase,
    auth: {
      sessionState: {
        status: 'authorized',
        user: { uid: 'user-1' },
      },
    },
  }) as unknown as Extract<AppBootstrapState, { status: 'loading' }>;

describe('appShellLoadingPolicy', () => {
  it('renders the bootstrap route chrome on the census route when auth hints exist', () => {
    expect(
      resolvePreMountLoadingScreenDecision({
        pathname: '/census',
        hasRecentAuthenticatedSessionHint: true,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toEqual({
      shouldRender: false,
      preferLoginShell: false,
      renderBootstrapRouteChrome: true,
    });
  });

  it('renders the bootstrap route chrome on the root route when auth hints exist', () => {
    expect(
      resolvePreMountLoadingScreenDecision({
        pathname: '/',
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: true,
        hasActiveFirebaseSession: false,
      })
    ).toEqual({
      shouldRender: false,
      preferLoginShell: false,
      renderBootstrapRouteChrome: true,
    });
  });

  it('renders the bootstrap route chrome on other authenticated module routes too', () => {
    expect(
      resolvePreMountLoadingScreenDecision({
        pathname: '/nursing-handoff',
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: true,
        hasActiveFirebaseSession: false,
      })
    ).toEqual({
      shouldRender: false,
      preferLoginShell: false,
      renderBootstrapRouteChrome: true,
    });
  });

  it('keeps the login shell pre-mount when stale hints survive a recent manual logout', () => {
    expect(
      resolvePreMountLoadingScreenDecision({
        pathname: '/census',
        hasRecentAuthenticatedSessionHint: true,
        hasPersistedFirebaseAuthHint: true,
        hasActiveFirebaseSession: false,
        hasRecentManualLogout: true,
      })
    ).toEqual({
      shouldRender: true,
      preferLoginShell: true,
      renderBootstrapRouteChrome: false,
    });
  });

  it('lets an active Firebase session win over the manual logout marker pre-mount', () => {
    expect(
      resolvePreMountLoadingScreenDecision({
        pathname: '/census',
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: true,
        hasRecentManualLogout: true,
      })
    ).toEqual({
      shouldRender: false,
      preferLoginShell: false,
      renderBootstrapRouteChrome: true,
    });
  });

  it('skips the route chrome at runtime when stale hints survive a recent manual logout', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/census',
        bootstrapState: createLoadingBootstrapState('rehydrating'),
        hasRecentAuthenticatedSessionHint: true,
        hasPersistedFirebaseAuthHint: true,
        hasActiveFirebaseSession: false,
        hasRecentManualLogout: true,
      })
    ).toBe('default');
  });

  it('renders the login shell pre-mount when no auth hints exist', () => {
    expect(
      resolvePreMountLoadingScreenDecision({
        pathname: '/',
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toEqual({
      shouldRender: true,
      preferLoginShell: true,
      renderBootstrapRouteChrome: false,
    });
  });

  it('keeps runtime loading silent on census even while auth is still loading', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/census',
        bootstrapState: createLoadingBootstrapState('rehydrating'),
        hasRecentAuthenticatedSessionHint: true,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('bootstrap-route-chrome');
  });

  it('shows the neutral loader instead of protected chrome during a clean incognito-style bootstrap', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/census',
        bootstrapState: createLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('default');
  });

  it('keeps the login shell visible while the root route bootstraps without hints', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/',
        bootstrapState: createLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('login-shell');

    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/',
        bootstrapState: createLoadingBootstrapState('rehydrating'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: true,
        hasActiveFirebaseSession: false,
      })
    ).toBe('bootstrap-route-chrome');
  });

  it('keeps other authenticated module routes on the route chrome while rehydrating', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/transfer-management',
        bootstrapState: createLoadingBootstrapState('rehydrating'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: true,
        hasActiveFirebaseSession: false,
      })
    ).toBe('bootstrap-route-chrome');
  });

  it('keeps authenticated module routes on the route chrome while bootstrapping too', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/nursing-handoff',
        bootstrapState: createLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: true,
        hasActiveFirebaseSession: false,
      })
    ).toBe('bootstrap-route-chrome');

    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/medical-handoff',
        bootstrapState: createLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: true,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('bootstrap-route-chrome');
  });

  it('keeps the route chrome for an already-authorized session bootstrapping on the root route', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/',
        bootstrapState: createAuthorizedLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('bootstrap-route-chrome');
  });
});
