import type { ViteDevServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import {
  serializeVersionInfo,
  versionRuntimePlugin,
} from '../../../../scripts/config/versionRuntimePlugin';

const versionInfo = {
  version: 'deploy-2026-09-21',
  buildDate: '2026-09-21T23:00:00.000Z',
};

describe('versionRuntimePlugin', () => {
  it('serves the current build identity without browser caching in development', () => {
    const use = vi.fn();
    const server = { middlewares: { use } } as unknown as ViteDevServer;
    const plugin = versionRuntimePlugin(versionInfo);

    expect(typeof plugin.configureServer).toBe('function');
    (plugin.configureServer as (server: ViteDevServer) => void)(server);

    expect(use).toHaveBeenCalledWith('/version.json', expect.any(Function));

    const middleware = use.mock.calls[0]?.[1] as (
      request: unknown,
      response: { setHeader: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
    ) => void;
    const response = { setHeader: vi.fn(), end: vi.fn() };

    middleware({}, response);

    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/json; charset=utf-8'
    );
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.end).toHaveBeenCalledWith(serializeVersionInfo(versionInfo));
  });
});
