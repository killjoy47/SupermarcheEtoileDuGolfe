if ('serviceWorker' in navigator) {
	window.addEventListener('load', async () => {
		try {
			const registrations = await navigator.serviceWorker.getRegistrations();
			await Promise.all(registrations.map((registration) => registration.unregister()));
			if ('caches' in window) {
				const keys = await caches.keys();
				await Promise.all(keys.map((key) => caches.delete(key)));
			}
			console.info('[PWA] service worker removed to avoid stale cache');
		} catch (error) {
			console.warn('[PWA] unable to clear service worker registrations', error);
		}
	});
}