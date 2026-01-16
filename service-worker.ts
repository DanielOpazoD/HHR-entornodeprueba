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

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

// ============================================
// PRECHACING & CLEANUP
// ============================================

// VitePWA will inject the manifest here
precacheAndRoute(self.__WB_MANIFEST);
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
setCatchHandler(async ({ event }: any) => {
    if (event.request.mode === 'navigate') {
        const cache = await caches.open(`offline-${CACHE_VERSION}`);
        return (await cache.match(OFFLINE_PAGE)) || Response.error();
    }
    return Response.error();
});

// ============================================
// EVENT LISTENERS
// ============================================

const sw = (self as any);

sw.addEventListener('install', (event: any) => {
    event.waitUntil(
        caches.open(`offline-${CACHE_VERSION}`).then((cache) => cache.add(OFFLINE_PAGE))
    );
    sw.skipWaiting();
});

sw.addEventListener('activate', (event: any) => {
    event.waitUntil(sw.clients.claim());
});

sw.addEventListener('message', (event: any) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        sw.skipWaiting();
    }
});
