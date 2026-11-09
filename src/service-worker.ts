/**
 * Advanced Service Worker for HHR Hospital Tracker
 * This file is processed by VitePWA using the 'injectManifest' strategy.
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { createScopedLogger } from '@/services/utils/loggerScope';
import {
  isPrivateStorageObjectUrl,
  purgePrivateStorageObjectsFromCaches,
} from '@/services/pwa/privateStorageObjectCache';

// Define proper types for Service Worker variables and events
interface WBManifestEntry {
  url: string;
  revision: string | null;
}

interface ExtendableEvent extends Event {
  waitUntil(fn: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
  preloadResponse: Promise<Response | undefined>;
}

interface ExtendableMessageEvent extends ExtendableEvent {
  data: unknown;
  source: Client | ServiceWorker | MessagePort | null;
  ports: readonly MessagePort[];
}

interface Client {
  url: string;
  type: ClientType;
  id: string;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

type ClientType = 'window' | 'worker' | 'sharedworker' | 'all';

interface Clients {
  get(id: string): Promise<Client | undefined>;
  matchAll(options?: ClientMatchAllOptions): Promise<Client[]>;
  openWindow(url: string): Promise<Client | null>;
  claim(): Promise<void>;
}

interface ClientMatchAllOptions {
  includeUncontrolled?: boolean;
  type?: ClientType;
}

interface ServiceWorkerGlobalScope extends EventTarget {
  readonly clients: Clients;
  readonly location: { origin: string };
  skipWaiting(): void;
}

// Declare self for injection point
declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<WBManifestEntry>;
};

// VitePWA will inject the manifest here - MUST use self.__WB_MANIFEST literal
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const CACHE_VERSION = 'v2.4.0';
const OFFLINE_PAGE = '/offline.html';
const serviceWorkerLogger = createScopedLogger('ServiceWorker');

const isClientsClaimRaceError = (error: unknown): boolean => {
  const message = String(error);
  return (
    message.includes('Only the active worker can claim clients') ||
    message.includes('InvalidStateError')
  );
};

// ============================================
// CACHING STRATEGIES
// ============================================

// Hashed JS/CSS assets are already served by precacheAndRoute above.
// A separate StaleWhileRevalidate route was removed because it created a
// shadow cache that could serve stale versioned files after a new deploy,
// causing load-order crashes (e.g. vendor-react missing → createContext error).

// Google Fonts - Cache First
registerRoute(
  ({ url }) =>
    url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({
    cacheName: `fonts-${CACHE_VERSION}`,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  })
);

// Images - Cache First
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && request.destination === 'image',
  new CacheFirst({
    cacheName: `images-${CACHE_VERSION}`,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  })
);

// Firebase/Firestore - Network First with cache fallback
// Restrict to Firebase data endpoints and exclude Auth endpoints to avoid login flow interference.
registerRoute(
  ({ url }) => {
    const isFirebaseDataOrigin =
      url.origin.includes('firebaseio.com') ||
      url.origin.includes('firebasestorage.googleapis.com') ||
      url.origin.includes('firebasestorage.app');
    const isAuthOrigin =
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('apis.google.com') ||
      url.hostname.includes('accounts.google.com');

    // Owner-only objects (a personal signature) go straight to the network, never to a cache.
    return isFirebaseDataOrigin && !isAuthOrigin && !isPrivateStorageObjectUrl(url);
  },
  new NetworkFirst({
    cacheName: `firebase-${CACHE_VERSION}`,
    networkTimeoutSeconds: 10,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  })
);

registerRoute(
  ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'POST',
  new NetworkOnly(),
  'POST'
);

// Pages/Navigation - Network First
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: `pages-${CACHE_VERSION}`,
    networkTimeoutSeconds: 5,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })],
  })
);

// Fallback for navigation failures
setCatchHandler(async ({ event }) => {
  const fetchEvent = event as FetchEvent;
  if (fetchEvent.request.mode === 'navigate') {
    const cache = await caches.open(`offline-${CACHE_VERSION}`);
    return (await cache.match(OFFLINE_PAGE)) || Response.error();
  }
  return Response.error();
});

// ============================================
// EVENT LISTENERS
// ============================================

self.addEventListener('install', (event: Event) => {
  const extendableEvent = event as ExtendableEvent;
  extendableEvent.waitUntil(
    caches.open(`offline-${CACHE_VERSION}`).then(cache => cache.add(OFFLINE_PAGE))
  );
  // Force immediate activation to replace stale cached chunks.
  // This ensures users get the latest build without waiting for all tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event: Event) => {
  const extendableEvent = event as ExtendableEvent;
  extendableEvent.waitUntil(
    Promise.all([
      self.clients.claim().catch(error => {
        // During aggressive worker replacement, claim can race before the worker becomes active.
        if (isClientsClaimRaceError(error)) {
          serviceWorkerLogger.info('clients.claim deferred until active worker takes control');
          return;
        }
        serviceWorkerLogger.warn('clients.claim skipped', error);
      }),
      // Earlier workers cached owner-only objects; drop those copies.
      purgePrivateStorageObjectsFromCaches(caches).catch(error => {
        serviceWorkerLogger.warn('private storage cache purge skipped', error);
      }),
    ])
  );
});

self.addEventListener('message', (event: Event) => {
  const messageEvent = event as ExtendableMessageEvent;
  if (
    messageEvent.data &&
    typeof messageEvent.data === 'object' &&
    'type' in messageEvent.data &&
    messageEvent.data.type === 'SKIP_WAITING'
  ) {
    self.skipWaiting();
  }
});
