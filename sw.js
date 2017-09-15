const PRECACHE = 'precache-v1';
const RUNTIME = 'runtime';

// A list of local resources we always want to be cached.
const PRECACHE_URLS = [
  'index.html',
  'app.js',
  'sw.js'
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(PRECACHE)
			.then(cache => cache.addAll(PRECACHE_URLS))
			.then(self.skipWaiting())
	);
});

self.addEventListener('activate', event => {

});

self.addEventListener('fetch', event => {
	if (event.request.url.startsWith(self.location.origin)){
		event.respondWith(
			caches.match(event.request).then(cachedResponse => {
				if (cachedResponse){
					return cachedResponse;
				}

				return caches.open(RUNTIME).then(cache => {
					return fetch(event.request).then(response => {
						return cache.put(event.request, response.clone()).then(() => {
							return response;
						});
					});
				});
			});	
		);
	}
});