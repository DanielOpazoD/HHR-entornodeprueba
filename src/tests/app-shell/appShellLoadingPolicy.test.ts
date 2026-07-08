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

  it('stays silent on pre-mount when no auth hints exist', () => {
    expect(
      resolvePreMountLoadingScreenDecision({
        pathname: '/',
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toEqual({
      shouldRender: false,
      preferLoginShell: false,
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

  it('does not render protected route chrome during a clean incognito-style bootstrap', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/census',
        bootstrapState: createLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('silent');
  });

  it('keeps root-route bootstrapping visually silent', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/',
        bootstrapState: createLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('silent');

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

  it('keeps authenticated root-route bootstrapping silent', () => {
    expect(
      resolveRuntimeLoadingScreenMode({
        pathname: '/',
        bootstrapState: createAuthorizedLoadingBootstrapState('bootstrapping'),
        hasRecentAuthenticatedSessionHint: false,
        hasPersistedFirebaseAuthHint: false,
        hasActiveFirebaseSession: false,
      })
    ).toBe('silent');
  });
});
