import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { getAdapter } from '$lib/server/integrations/index.js';
import { getConnection } from '$lib/server/integrations/store.js';
import { withDeadline, describeFetchError } from '$lib/server/integrations/deadline.js';
import { adapterContext } from '$lib/server/integrations/linked.js';
import { validZone } from '$lib/server/integrations/ical.js';

// The response is bounded by SEARCH_TIMEOUT_MS, but the adapter's own fetches
// get the longer UPSTREAM_TIMEOUT_MS and aren't tied to request.signal: the
// search bar aborts on every keystroke, and a cold Planka crawl that runs past
// the response deadline still fills the cache for the next query. Other
// adapters also run each abandoned query to the end; at a handful of users
// that costs less than threading request.signal through every adapter.
const SEARCH_TIMEOUT_MS = 8000;
const UPSTREAM_TIMEOUT_MS = 30000;

// POST /api/search   body: { provider, query, limit?, timeZone?, filter? }
//
// `provider` is the colon-joined "<integrationId>:<providerKey>" string
// chosen by the user (e.g. "immich:photos"). The dispatcher resolves the
// adapter, loads the user's stored credentials, and invokes the adapter's
// query() function. Adapters never see another user's data — the connection
// is keyed on the session username. `filter` is the params of a result the
// user drilled into (a tag, a list); only providers with `filters` get it,
// and they check it, since it comes from the browser.

export async function POST({ cookies, url, request, fetch }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body;
	try {
		const text = await request.text();
		if (text.length > 4096) return json({ error: 'Payload too large' }, { status: 413 });
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const provider = String(body?.provider || '');
	const query = String(body?.query || '');
	const limit = Number.isFinite(body?.limit) ? Math.min(Math.max(body.limit, 1), 50) : 20;
	const timeZone = validZone(body?.timeZone) ? body.timeZone : 'UTC';
	const filter = body?.filter && typeof body.filter === 'object' && !Array.isArray(body.filter) ? body.filter : null;

	const [integrationId, providerKey] = provider.split(':');
	if (!integrationId || !providerKey) {
		return json({ error: 'provider must look like "<integration>:<provider>"' }, { status: 400 });
	}

	const adapter = getAdapter(integrationId);
	if (!adapter) return json({ error: 'Unknown integration' }, { status: 404 });

	const searchProvider = adapter.searchProviders?.[providerKey];
	if (!searchProvider) return json({ error: 'Unknown search provider' }, { status: 404 });
	if (filter && !searchProvider.filters) return json({ error: 'This search provider takes no filter' }, { status: 400 });

	const conn = await getConnection(user.username, adapter.id);
	if (!conn?.connected) {
		return json({ error: 'Integration not connected' }, { status: 409 });
	}

	let timer;
	try {
		const pending = searchProvider.query({
			...(await adapterContext(user.username, adapter, conn)),
			config: conn.config,
			query,
			limit,
			timeZone,
			...(filter ? { filter } : {}),
			fetch: withDeadline(fetch, UPSTREAM_TIMEOUT_MS)
		});
		pending.catch(() => {}); // may settle after we've already answered
		const result = await Promise.race([
			pending,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new DOMException('Search timed out', 'TimeoutError')), SEARCH_TIMEOUT_MS);
			})
		]);
		return json({ results: result?.results || [], more: result?.more || null });
	} catch (err) {
		const status = err?.name === 'TimeoutError' ? 504 : 502;
		const message = searchProvider.failMessage?.(conn.config) || `Search failed: ${describeFetchError(err, SEARCH_TIMEOUT_MS)}`;
		return json({ error: message }, { status });
	} finally {
		clearTimeout(timer);
	}
}
