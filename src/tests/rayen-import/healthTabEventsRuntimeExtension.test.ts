// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/health-tab-events-runtime.js';

type UpdatedListener = (
  tabId: number,
  changeInfo: { url?: string; status?: string },
  tab: { url?: string }
) => void;

const runtimeModule = (
  globalThis as unknown as {
    HhrHealthTabEventsRuntime: {
      create: (deps: Record<string, unknown>) => { start: () => boolean };
      patternsFromManifest: (manifest: Record<string, unknown>) => string[];
    };
  }
).HhrHealthTabEventsRuntime;

const createFixture = () => {
  const updated: UpdatedListener[] = [];
  const removed: Array<(tabId: number) => void> = [];
  const activated: Array<(info: { tabId: number }) => void> = [];
  const sources = ['https://fichamedico.rayensalud.cl/*', 'https://hospitalizado.rayensalud.cl/*'];
  const chromeApi = {
    runtime: {
      getManifest: vi.fn(() => ({
        content_scripts: [
          { matches: [sources[0]], js: ['content-fichamedico.js'] },
          { matches: [sources[1]], js: ['content-gestioncamas.js'] },
          { matches: ['http://localhost:3000/*'], js: ['content-hhr.js'] },
        ],
      })),
    },
    tabs: {
      query: vi.fn(async () => [] as Array<{ id: number; url: string }>),
      get: vi.fn(async (_tabId: number) => undefined as { id: number; url: string } | undefined),
      onUpdated: { addListener: vi.fn((listener: UpdatedListener) => updated.push(listener)) },
      onRemoved: {
        addListener: vi.fn((listener: (tabId: number) => void) => removed.push(listener)),
      },
      onActivated: {
        addListener: vi.fn((listener: (info: { tabId: number }) => void) =>
          activated.push(listener)
        ),
      },
    },
  };
  const pushHealth = vi.fn(async () => ({ pushed: 1 }));
  const runtime = runtimeModule.create({
    chromeApi,
    pushHealth,
    eventDebounceMs: 20,
    log: vi.fn(),
  });
  return { runtime, chromeApi, pushHealth, sources, updated, removed, activated };
};

describe('health tab events runtime (extension)', () => {
  it('deriva solo las fuentes Eloísa declaradas en el manifest', () => {
    const fixture = createFixture();
    expect(runtimeModule.patternsFromManifest(fixture.chromeApi.runtime.getManifest())).toEqual(
      fixture.sources
    );
  });

  it('agrupa apertura/completitud y revalida también al cerrar tras despertar el worker', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      expect(fixture.runtime.start()).toBe(true);
      fixture.updated[0]?.(
        7,
        { url: 'https://fichamedico.rayensalud.cl/main', status: 'loading' },
        { url: 'https://fichamedico.rayensalud.cl/main' }
      );
      fixture.updated[0]?.(
        7,
        { status: 'complete' },
        { url: 'https://fichamedico.rayensalud.cl/main' }
      );
      await vi.advanceTimersByTimeAsync(21);
      expect(fixture.pushHealth).toHaveBeenCalledTimes(1);
      expect(fixture.pushHealth).toHaveBeenCalledWith('source-tab-updated');

      // onRemoved no entrega URL y puede despertar un worker sin estado en memoria.
      fixture.removed[0]?.(404);
      await vi.advanceTimersByTimeAsync(21);
      expect(fixture.pushHealth).toHaveBeenLastCalledWith('source-tab-removed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('revalida al activar una fuente e ignora la activación de pestañas ajenas', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      fixture.chromeApi.tabs.query.mockResolvedValue([
        { id: 12, url: 'https://hospitalizado.rayensalud.cl/#/bed' },
      ]);
      fixture.chromeApi.tabs.get.mockResolvedValue({ id: 99, url: 'https://example.com/' });
      fixture.runtime.start();
      await Promise.resolve();

      fixture.activated[0]?.({ tabId: 99 });
      await vi.advanceTimersByTimeAsync(21);
      expect(fixture.pushHealth).not.toHaveBeenCalled();

      fixture.activated[0]?.({ tabId: 12 });
      await vi.advanceTimersByTimeAsync(21);
      expect(fixture.pushHealth).toHaveBeenCalledWith('source-tab-activated');
    } finally {
      vi.useRealTimers();
    }
  });
});
