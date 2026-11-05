import { applyOperatorUrls } from './urlPolicy.js';

// A shared integration (Invidious) is the operator's, the same for everyone:
// every user is connected to the URL in config.yml. Only the user's "Use
// for" switches are stored, each on until they turn it off.
// Kept apart from store.js so it can be tested without the database.

export function parseSurfaces(json) {
	if (!json) return {};
	try {
		const obj = JSON.parse(json);
		return obj && typeof obj === 'object' ? obj : {};
	} catch {
		return {};
	}
}

export function sharedConnection(adapter, operator, row) {
	return {
		integrationId: adapter.id,
		connected: true,
		config: applyOperatorUrls(adapter, operator, {}),
		surfaces: { search: true, ...parseSurfaces(row?.surfaces_json) },
		updatedAt: row?.updated_at ?? null
	};
}
