// A simple service worker to allow PWA installation
self.addEventListener('install', (event) => {
    console.log('Minimalist Service Worker installing.');
});

// We must include this listener to pass PWA requirements, 
// but we leave it EMPTY so it stops breaking Firebase Auth!
self.addEventListener('fetch', (event) => {
    return; 
});