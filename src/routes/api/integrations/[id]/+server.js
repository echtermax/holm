import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { getAdapter, getOperatorDefaults } from '$lib/server/integrations/index.js';
import { checkUrls, urlOriginChanged, withoutSecrets } from '$lib/server/integrations/urlPolicy.js';
import {
	getConnection,
	upsertConnection,
	deleteConnection
} from '$lib/server/integrations/store.js';
import { redactConfig } from '$lib/server/integrations/serialize.js';
import { mergeConfig, validateConfig } from '$lib/server/integrations/configMerge.js';
import { mergeAccounts } from '$lib/server/integrations/accounts.js';
import { withDeadline } from '$lib/server/integrations/deadline.js';
import { autoConnect, disconnectLinked } from '$lib/server/integrations/linked.js';

// PUT /api/integrations/:id   body: { config, surfaces }
// Save (or update) the user's connection. Secret fields that come back as
// the redacted bullet string are merged from the existing record so users
// can edit URL-only without re-pasting the API key.

export async function PUT({ cookies, url, request, params, fetch }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const adapter = getAdapter(params.id);
	if (!adapter) return json({ error: 'Unknown integration' }, { status: 404 });

	const body = await readJson(request);
	if (!body) return json({ error: 'Invalid JSON' }, { status: 400 });

	const existing = await getConnection(user.username, adapter.id);
	// A shared integration (Invidious) saves only the switches: there is
	// nothing to connect, and its config is the operator's.
	if (adapter.shared) {
		const surfaces = sanitizeSurfaces(body.surfaces);
		await upsertConnection(user.username, adapter.id, { surfaces });
		return json({ ok: true, userState: { connected: true, config: redactConfig(adapter, existing.config), surfaces } });
	}

	const submitted = body.config || {};
	const stored = existing?.config || {};
	const operator = getOperatorDefaults(adapter.id);
	let checked = checkUrls(adapter, operator, mergeConfig(adapter, stored, submitted));
	if (!checked.ok) return json({ error: checked.message }, { status: 400 });
	// Moving to another server drops what the old one issued: a stored key
	// or token is never sent to a URL it wasn't saved for.
	if (urlOriginChanged(adapter, stored, checked.config)) {
		checked = checkUrls(adapter, operator, mergeConfig(adapter, withoutSecrets(adapter, stored), submitted));
	}
	let merged = checked.config;
	if (adapter.prepareConfig) merged = adapter.prepareConfig({ config: merged });

	const validation = validateConfig(adapter, merged);
	if (!validation.ok) return json({ error: validation.message }, { status: 400 });

	// The other accounts of an integration that holds several (Calendar).
	const accounts = mergeAccounts(adapter, operator, stored, submitted.accounts);
	if (!accounts.ok) return json({ error: accounts.message }, { status: 400 });
	delete merged.accounts;
	if (accounts.accounts.length) merged.accounts = accounts.accounts;

	const surfaces = sanitizeSurfaces(body.surfaces);

	await upsertConnection(user.username, adapter.id, { config: merged, surfaces });
	// A new connection can connect others too (Jellyfin → Seerr), as a
	// sign-in does; saving an existing one (a surface toggle) doesn't.
	if (!existing?.connected) {
		await autoConnect(user.username, withDeadline(fetch, 5000), { signedIn: adapter.id }).catch(() => {});
	}

	return json({
		ok: true,
		userState: {
			connected: true,
			config: redactConfig(adapter, merged),
			surfaces
		}
	});
}

// DELETE /api/integrations/:id
// Disconnect — wipes the row entirely.
export async function DELETE({ cookies, url, params, fetch }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	const adapter = getAdapter(params.id);
	if (!adapter) return json({ error: 'Unknown integration' }, { status: 404 });

	// Revoke the upstream session too (e.g. a Quick Connect token), best
	// effort: an unreachable server must not stop the user disconnecting.
	if (adapter.signOut) {
		const existing = await getConnection(user.username, adapter.id);
		if (existing?.config) {
			try {
				await adapter.signOut({ config: existing.config, fetch: withDeadline(fetch, 5000) });
			} catch {
				/* ignore */
			}
		}
	}

	// An integration Holm connects on its own (Seerr) keeps an empty row, so
	// it stays disconnected instead of reconnecting on the next page load.
	if (adapter.connectFromLinked) {
		await upsertConnection(user.username, adapter.id, { config: {}, surfaces: {} });
	} else {
		await deleteConnection(user.username, adapter.id);
	}
	await disconnectLinked(user.username, adapter.id);
	return json({ ok: true });
}

async function readJson(request) {
	try {
		const text = await request.text();
		if (text.length > 16384) return null;
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function sanitizeSurfaces(input) {
	if (!input || typeof input !== 'object') return {};
	const out = {};
	for (const [k, v] of Object.entries(input)) {
		out[k] = !!v;
	}
	return out;
}
