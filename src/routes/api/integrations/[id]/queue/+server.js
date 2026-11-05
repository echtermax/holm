import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { getAdapter } from '$lib/server/integrations/index.js';
import { getConnection } from '$lib/server/integrations/store.js';
import { withDeadline, describeFetchError } from '$lib/server/integrations/deadline.js';

const QUEUE_TIMEOUT_MS = 8000;

// POST /api/integrations/:id/queue   body: { params }
//
// The tracks for a search result that carries `meta.queue` (e.g. a Navidrome
// album or playlist), for the corner player to play in turn. The params come
// from the browser, so the adapter validates them.

export async function POST({ cookies, url, request, params, fetch }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const adapter = getAdapter(params.id);
	if (!adapter) return json({ error: 'Unknown integration' }, { status: 404 });
	if (!adapter.queue) return json({ error: 'Nothing to play for this integration' }, { status: 404 });

	let body;
	try {
		const text = await request.text();
		if (text.length > 4096) return json({ error: 'Payload too large' }, { status: 413 });
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const conn = await getConnection(user.username, adapter.id);
	if (!conn?.connected) return json({ error: 'Integration not connected' }, { status: 409 });

	try {
		const tracks = await adapter.queue({
			config: conn.config,
			params: body?.params && typeof body.params === 'object' ? body.params : {},
			fetch: withDeadline(fetch, QUEUE_TIMEOUT_MS)
		});
		if (!tracks) return json({ error: 'Invalid album or playlist' }, { status: 400 });
		return json({ tracks });
	} catch (err) {
		return json({ error: describeFetchError(err, QUEUE_TIMEOUT_MS) }, { status: 502 });
	}
}
