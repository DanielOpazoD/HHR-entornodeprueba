import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Runs the real service worker module with real Workbox routing and strategies over an in-memory
 * Cache Storage, to see what a shared computer keeps after someone views their signature.
 */
type Capture = (options: { url: URL; request: Request; sameOrigin: boolean }) => boolean;
const registered = vi.hoisted(
  () => [] as Array<{ capture: Capture; handler: unknown; method?: string }>
);
vi.mock('workbox-precaching', () => ({
  precacheAndRoute: () => {},
  cleanupOutdatedCaches: () => {},
}));
vi.mock('workbox-routing', async importOriginal => ({
  ...(await importOriginal<typeof import('workbox-routing')>()),
  registerRoute: (capture: Capture, handler: unknown, method?: string) => {
    registered.push({ capture, handler, method });
  },
  setCatchHandler: () => {},
}));

class MemoryCache {
  readonly entries = new Map<string, Response>();
  private key = (request: RequestInfo | URL) =>
    typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;
  async match(request: RequestInfo | URL) {
    return this.entries.get(this.key(request))?.clone();
  }
  async put(request: RequestInfo | URL, response: Response) {
    this.entries.set(this.key(request), response);
  }
  async keys() {
    return [...this.entries.keys()].map(url => new Request(url));
  }
  async delete(request: RequestInfo | URL) {
    return this.entries.delete(this.key(request));
  }
}

class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new MemoryCache());
    return this.caches.get(name)!;
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
  async has(name: string) {
    return this.caches.has(name);
  }
  async match(request: RequestInfo | URL) {
    for (const cache of this.caches.values()) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
  cachedUrls() {
    return [...this.caches.values()].flatMap(cache => [...cache.entries.keys()]);
  }
}

const BUCKET = 'https://firebasestorage.googleapis.com/v0/b/hhr-sintetico.appspot.com/o';
const SIGNATURE_URL = `${BUCKET}/user-signatures%2Fuid-a%2Fsignature?alt=media`;
const EXPORT_URL = `${BUCKET}/censo-diario%2Fexport.pdf?alt=media`;

let cacheStorage: MemoryCacheStorage;
let router: import('workbox-routing').Router;
const scope = self as unknown as Record<string, unknown>;

const fetchThroughWorker = async (url: string) => {
  const request = new Request(url);
  const pending: Promise<unknown>[] = [];
  const event = { request, waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
  const handled = router.handleRequest({
    request,
    event: event as unknown as Parameters<typeof router.handleRequest>[0]['event'],
  });
  // No route: the browser fetches it itself and the worker stores nothing.
  const response = handled ? await handled : await fetch(request);
  await Promise.all(pending);
  return response;
};

describe('service worker and owner-only Storage objects', () => {
  beforeAll(async () => {
    scope.__WB_MANIFEST = [];
    scope.clients = { claim: async () => {} };
    scope.skipWaiting = () => {};
    await import('@/service-worker');
    const { Router, Route } = await import('workbox-routing');
    router = new Router();
    for (const { capture, handler, method } of registered) {
      router.registerRoute(
        new Route(
          capture,
          handler as ConstructorParameters<typeof Route>[1],
          method as ConstructorParameters<typeof Route>[2]
        )
      );
    }
  });

  beforeEach(() => {
    cacheStorage = new MemoryCacheStorage();
    vi.stubGlobal('caches', cacheStorage);
    // Workbox checks for worker event classes that jsdom does not have.
    vi.stubGlobal('FetchEvent', class {});
    vi.stubGlobal('ExtendableEvent', Object);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('bytes', { status: 200, headers: { 'Content-Type': 'image/png' } })
      )
    );
  });

  it('never stores a signature download, while other Storage reads keep their offline copy', async () => {
    expect(await (await fetchThroughWorker(SIGNATURE_URL)).text()).toBe('bytes');
    await fetchThroughWorker(EXPORT_URL);

    expect(cacheStorage.cachedUrls()).toEqual([EXPORT_URL]);
  });

  it('removes signatures an earlier worker cached when it activates', async () => {
    const firebase = await cacheStorage.open('firebase-v2.4.0');
    await firebase.put(SIGNATURE_URL, new Response('old signature'));
    await firebase.put(EXPORT_URL, new Response('export'));
    const images = await cacheStorage.open('images-v2.4.0');
    await images.put(`${BUCKET}/user-signatures%2Fuid-b%2Fsignature?alt=media`, new Response('b'));

    const pending: Promise<unknown>[] = [];
    const activate = Object.assign(new Event('activate'), {
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    self.dispatchEvent(activate);
    await Promise.all(pending);

    expect(cacheStorage.cachedUrls()).toEqual([EXPORT_URL]);
  });
});
