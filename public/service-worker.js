/**
 * Minimal cache-first Service Worker for Pilot Logbook PWA.
 *
 * Strategy:
 *   - On install: pre-cache the App Shell (root page).
 *   - On fetch: serve from cache → fall back to network → cache the response.
 *
 * This enables fully offline usage after the first successful load —
 * critical for pilots who may need to access the logbook without connectivity.
 *
 * Version the CACHE_NAME to force a cache bust on updates.
 */

const CACHE_NAME = 'pilot-logbook-v2';

// Pre-cache the app shell on install
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(['/']))
    );
    self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys
                    .filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch: cache-first, fallback to network, then cache the response
self.addEventListener('fetch', (event) => {
    // Only handle GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;

            return fetch(event.request).then((response) => {
                // Don't cache non-ok responses or opaque responses
                if (!response || response.status !== 200) {
                    return response;
                }

                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            });
        })
    );
});
