/**
 * Advanced Service Worker for HHR Hospital Tracker
 * This file is processed by VitePWA using the 'injectManifest' strategy.
 */

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, setCatchHandler } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst, NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

// Define proper types for Service Worker variables and events
interface WBManifestEntry {
    url: string;
    revision: string | null;
}

interface ExtendableEvent extends Event {
    waitUntil(fn: Promise<any>): void;
}

interface FetchEvent extends ExtendableEvent {
    request: Request;
    respondWith(response: Promise<Response> | Response): void;
    preloadResponse: Promise<any>;
}

interface ExtendableMessageEvent extends ExtendableEvent {
    data: any;
    source: Client | ServiceWorker | MessagePort | null;
    ports: readonly MessagePort[];
}

interface Client {
    url: string;
    type: ClientType;
    id: string;
    postMessage(message: any, transfer?: Transferable[]): void;
}

type ClientType = "window" | "worker" | "sharedworker" | "all";

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
    skipWaiting(): void;
}

// Use a typed constant for self to avoid redeclaration conflicts
const sw = self as unknown as ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<WBManifestEntry> };

// ============================================
// PRECHACING & CLEANUP
// ============================================

// VitePWA will inject the manifest here - MUST use self.__WB_MANIFEST literal
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const manifest = (self as any).__WB_MANIFEST;
precacheAndRoute(manifest);
cleanupOutdatedCaches();

const CACHE_VERSION = 'v2.2.0';
const OFFLINE_PAGE = '/offline.html';

// ============================================
// CACHING STRATEGIES
// ============================================

// Static assets (JS, CSS) - Stale While Revalidate
registerRoute(
    ({ request }) => request.destination === 'script' || request.destination === 'style',
    new StaleWhileRevalidate({
        cacheName: `static-${CACHE_VERSION}`,
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 24 * 60 * 60 }),
        ],
    })
);

// Google Fonts - Cache First
registerRoute(
    ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
    new CacheFirst({
        cacheName: `fonts-${CACHE_VERSION}`,
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
        ],
    })
);

// Images - Cache First
registerRoute(
    ({ request }) => request.destination === 'image',
    new CacheFirst({
        cacheName: `images-${CACHE_VERSION}`,
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 }),
        ],
    })
);

// Firebase/Firestore - Network First with cache fallback
registerRoute(
    ({ url }) => url.origin.includes('firebaseio.com') || url.origin.includes('googleapis.com'),
    new NetworkFirst({
        cacheName: `firebase-${CACHE_VERSION}`,
        networkTimeoutSeconds: 10,
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 }),
        ],
    })
);

// API calls with background sync for POST
let bgSyncPlugin: BackgroundSyncPlugin | undefined;
try {
    bgSyncPlugin = new BackgroundSyncPlugin('patientSyncQueue', {
        maxRetentionTime: 24 * 60, // Retry for up to 24 hours
    });
} catch (error) {
    console.error('[SW] Failed to initialize BackgroundSyncPlugin:', error);
}

registerRoute(
    ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'POST',
    new NetworkOnly({
        plugins: bgSyncPlugin ? [bgSyncPlugin] : [],
    }),
    'POST'
);

// Pages/Navigation - Network First
registerRoute(
    ({ request }) => request.mode === 'navigate',
    new NetworkFirst({
        cacheName: `pages-${CACHE_VERSION}`,
        networkTimeoutSeconds: 5,
        plugins: [
            new CacheableResponsePlugin({ statuses: [0, 200] }),
            new ExpirationPlugin({ maxEntries: 50 }),
        ],
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

sw.addEventListener('install', (event: Event) => {
    const extendableEvent = event as ExtendableEvent;
    extendableEvent.waitUntil(
        caches.open(`offline-${CACHE_VERSION}`).then((cache) => cache.add(OFFLINE_PAGE))
    );
    sw.skipWaiting();
});

sw.addEventListener('activate', (event: Event) => {
    const extendableEvent = event as ExtendableEvent;
    extendableEvent.waitUntil(sw.clients.claim());
});

sw.addEventListener('message', (event: Event) => {
    const messageEvent = event as ExtendableMessageEvent;
    if (messageEvent.data && messageEvent.data.type === 'SKIP_WAITING') {
        sw.skipWaiting();
    }
});
