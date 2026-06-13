// A simple service worker to allow PWA installation
self.addEventListener('install', (event) => {
    console.log('Minimalist Service Worker installing.');
});

self.addEventListener('fetch', (event) => {
    // We let Firebase and the browser handle normal fetching
    event.respondWith(fetch(event.request));
});