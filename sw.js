//v 4
const PRECACHE = 'precache-v1';
const RUNTIME = 'runtime';

// A list of local resources we always want to be cached.
const PRECACHE_URLS = [
  'index.html',
  './',
  'app.js',
  'manifest.json'
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(PRECACHE)
			.then(cache => cache.addAll(PRECACHE_URLS))
			.then(self.skipWaiting())
	);
	console.log("Instalando Service Worker");
});

self.addEventListener('activate', event => {
	console.log("Service Worker Activado");
});

self.addEventListener('fetch', event => {
	if (event.request.url.startsWith(self.location.origin)){
		event.respondWith(
			caches.match(event.request).then(cachedResponse => {
				if (cachedResponse){
					console.log("Request resuelto desde cache: " + event.request.url);
					return cachedResponse;
				}
				console.log("Request resuelto desde la red: " + event.request.url);
				return caches.open(RUNTIME).then(cache => {
					return fetch(event.request).then(response => {
						return cache.put(event.request, response.clone()).then(() => {
							return response;
						});
					});
				});
			})	
		);
	}
});