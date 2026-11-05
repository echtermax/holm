import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

// Client-side cache of /api/integrations.
//
// Lazy: nothing fetched until something calls `load()` (typically the first
// time the Integrations tab opens). Result is cached in-memory; calls during
// in-flight loads share the same promise.

function createIntegrationsStore() {
	const state = writable({ loaded: false, loading: false, error: '', integrations: [] });
	let inflight = null;

	async function fetchAndSet() {
		try {
			const res = await fetch('/api/integrations');
			// No session (auth disabled): there are simply no integrations.
			if (res.status === 401) {
				state.set({ loaded: true, loading: false, error: '', integrations: [] });
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			state.set({ loaded: true, loading: false, error: '', integrations: data.integrations || [] });
		} catch (err) {
			console.error('[integrations] fetch failed:', err);
			// loaded stays false so the next load() retries instead of caching the failure
			state.set({ loaded: false, loading: false, error: err.message || 'Failed to load', integrations: [] });
		} finally {
			inflight = null;
		}
	}

	async function load({ force = false } = {}) {
		if (!browser) return;
		const cur = get(state);
		if (cur.loaded && !force) return;
		if (inflight) return inflight;
		state.update((s) => ({ ...s, loading: true }));
		inflight = fetchAndSet();
		return inflight;
	}

	async function save(integrationId, payload) {
		const wasConnected = !!get(state).integrations.find((it) => it.id === integrationId)?.userState?.connected;
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || `Save failed (${res.status})`);
		}
		const data = await res.json();
		// Patch the cached entry in place.
		state.update((s) => ({
			...s,
			integrations: s.integrations.map((it) =>
				it.id === integrationId ? { ...it, userState: data.userState } : it
			)
		}));
		// A new connection can connect others too (Jellyfin → Seerr).
		if (!wasConnected) load({ force: true });
		return data;
	}

	async function disconnect(integrationId) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
		state.update((s) => ({
			...s,
			integrations: s.integrations.map((it) =>
				it.id === integrationId
					? { ...it, userState: { connected: false, config: {}, surfaces: {} } }
					: it
			)
		}));
		// Disconnecting Jellyfin also disconnects a Seerr linked through it.
		load({ force: true });
	}

	// `account` tests another account of a Calendar: its id, or 'new'.
	async function test(integrationId, config, account) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/test`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(account ? { config, account } : { config })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return { ok: false, message: err.error || `HTTP ${res.status}` };
		}
		return await res.json();
	}

	// Sign-in flows (e.g. Jellyfin Quick Connect): start returns a code to
	// show; poll until the server reports done, which also saves the
	// connection server-side.
	async function signIn(integrationId, body) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/signin`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status})`);
		if (data.status === 'done') {
			state.update((s) => ({
				...s,
				integrations: s.integrations.map((it) =>
					it.id === integrationId ? { ...it, userState: data.userState } : it
				)
			}));
			// One sign-in can connect others too (Jellyfin → Seerr).
			load({ force: true });
		}
		return data;
	}

	// Runs an adapter action for a search result (e.g. Seerr's Request).
	async function runAction(integrationId, key, params) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/action/${encodeURIComponent(key)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ params })
		});
		const data = await res.json().catch(() => ({}));
		return { ok: !!data.ok, message: data.message || data.error || `HTTP ${res.status}` };
	}

	// Detail view for a search result that carries `detail` params.
	async function details(integrationId, params) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/details`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ params })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.details) throw new Error(data.error || `HTTP ${res.status}`);
		return data.details;
	}

	// The tracks of a search result that carries `meta.queue` params.
	async function queue(integrationId, params) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/queue`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ params })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !Array.isArray(data.tracks)) throw new Error(data.error || `HTTP ${res.status}`);
		return data.tracks;
	}

	return {
		subscribe: state.subscribe,
		load,
		save,
		disconnect,
		test,
		signIn,
		runAction,
		details,
		queue
	};
}

export const integrations = createIntegrationsStore();
