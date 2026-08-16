import { describe, expect, it, vi } from 'vitest';
import {
  preloadAuthenticatedShellChunk,
  preloadDefaultPostLoginRoute,
  preloadAuthenticatedRouteChunk,
  shouldPreloadAuthenticatedShellForPathname,
} from '@/app-shell/bootstrap/authenticatedRoutePreloadController';

describe('authenticatedRoutePreloadController', () => {
  it('preloads the authenticated shell when requested by startup chrome', async () => {
    const loadAuthenticatedShell = vi.fn().mockResolvedValue({});

    await preloadAuthenticatedShellChunk({ loadAuthenticatedShell });

    expect(loadAuthenticatedShell).toHaveBeenCalledTimes(1);
  });

  it('preloads the census entrypoint once for root and census refreshes', async () => {
    const loadCensusComponents = vi.fn().mockResolvedValue({});
    const loadCensusRegisterContent = vi.fn().mockResolvedValue({});

    await preloadAuthenticatedRouteChunk({
      pathname: '/',
      loadCensusComponents,
      loadCensusRegisterContent,
    });
    await preloadAuthenticatedRouteChunk({
      pathname: '/census',
      loadCensusComponents,
      loadCensusRegisterContent,
    });
    await preloadAuthenticatedRouteChunk({
      pathname: '/censo',
      loadCensusComponents,
      loadCensusRegisterContent,
    });

    expect(loadCensusComponents).toHaveBeenCalledTimes(3);
    expect(loadCensusRegisterContent).not.toHaveBeenCalled();
  });

  it('does not preload census for non-census module refreshes', async () => {
    const loadCensusComponents = vi.fn().mockResolvedValue({});
    const loadCensusRegisterContent = vi.fn().mockResolvedValue({});

    await preloadAuthenticatedRouteChunk({
      pathname: '/nursing-handoff',
      loadCensusComponents,
      loadCensusRegisterContent,
    });

    expect(loadCensusComponents).not.toHaveBeenCalled();
    expect(loadCensusRegisterContent).not.toHaveBeenCalled();
  });

  it('preloads the authenticated shell for known module deep links without pulling it into login', () => {
    expect(shouldPreloadAuthenticatedShellForPathname('/censo')).toBe(true);
    expect(shouldPreloadAuthenticatedShellForPathname('/census')).toBe(true);
    expect(shouldPreloadAuthenticatedShellForPathname('/medical-handoff')).toBe(true);
    expect(shouldPreloadAuthenticatedShellForPathname('/transfer-management')).toBe(false);
    expect(shouldPreloadAuthenticatedShellForPathname('/')).toBe(false);
    expect(shouldPreloadAuthenticatedShellForPathname('/login')).toBe(false);
    expect(shouldPreloadAuthenticatedShellForPathname('/unknown-route')).toBe(false);
  });

  it('preloads the authenticated shell and default census entrypoint from the login screen', async () => {
    const loadAuthenticatedShell = vi.fn().mockResolvedValue({});
    const loadCensusComponents = vi.fn().mockResolvedValue({});
    const loadCensusRegisterContent = vi.fn().mockResolvedValue({});

    await preloadDefaultPostLoginRoute({
      loadAuthenticatedShell,
      loadCensusComponents,
      loadCensusRegisterContent,
    });

    expect(loadAuthenticatedShell).toHaveBeenCalledTimes(1);
    expect(loadCensusComponents).toHaveBeenCalledTimes(1);
    expect(loadCensusRegisterContent).not.toHaveBeenCalled();
  });
});
