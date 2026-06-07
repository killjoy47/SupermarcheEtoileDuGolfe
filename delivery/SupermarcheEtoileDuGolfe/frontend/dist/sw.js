self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		try {
			const keys = await caches.keys();
			await Promise.all(keys.map((key) => caches.delete(key)));
		} catch {
			// best effort cleanup
		}
		try {
			await self.registration.unregister();
		} catch {
			// best effort cleanup
		}
		try {
			const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of windows) {
				const url = new URL(client.url);
				url.searchParams.set('sw', 'off');
				await client.navigate(url.toString());
			}
		} catch {
			// best effort cleanup
		}
	})());
});


