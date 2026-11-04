// Static integration registry.
//
// Adapters are imported eagerly so the framework knows about them at boot.
// `getRegistry()` returns only the ones the operator enabled in config.yml —
// an integration that isn't listed (or is listed with enabled: false) is
// invisible to users entirely. This is the operator gate.
//
// To add a new integration: drop a new file in this directory, import it
// here, push it onto KNOWN_ADAPTERS. Done.

import { getIntegrationsConfig, getAppsConfig } from '../config.js';
import immich from './immich.js';
import paperless from './paperless.js';
import papra from './papra.js';
import nextcloud from './nextcloud.js';
import planka from './planka.js';
import karakeep from './karakeep.js';
import linkwarden from './linkwarden.js';
import jellyfin from './jellyfin.js';
import plex from './plex.js';
import navidrome from './navidrome.js';
import audiobookshelf from './audiobookshelf.js';
import mealie from './mealie.js';
import seerr from './seerr.js';
import caldav from './caldav.js';
import miniflux from './miniflux.js';
import komga from './komga.js';
import kavita from './kavita.js';
import thingport from './thingport.js';
import invidious from './invidious.js';

const KNOWN_ADAPTERS = [immich, paperless, nextcloud, planka, karakeep, linkwarden, jellyfin, plex, navidrome, audiobookshelf, mealie, seerr, caldav, miniflux, komga, kavita, papra, thingport, invidious];
const BY_ID = new Map(KNOWN_ADAPTERS.map((a) => [a.id, a]));

function resolveApp(id) {
	const apps = getAppsConfig();
	for (const app of apps) {
		if (app.id === id) return app;
	}
	return null;
}

// A shared integration (Invidious) has no per-user connection to fall back
// on, so it stays hidden until the operator sets its URL.
function isEnabled(operatorEntry, adapter) {
	if (operatorEntry == null) return false;
	if (typeof operatorEntry !== 'object') return false;
	if (adapter?.shared && !operatorEntry.default_url) return false;
	return operatorEntry.enabled !== false;
}

/**
 * Returns enabled adapter metadata + per-integration operator settings.
 * Used by the API layer to advertise what's available to users.
 */
export function getRegistry() {
	const cfg = getIntegrationsConfig() || {};
	const out = [];
	for (const adapter of KNOWN_ADAPTERS) {
		const operatorEntry = cfg[adapter.id];
		if (!isEnabled(operatorEntry, adapter)) continue;
		const app = resolveApp(adapter.id);
		out.push({
			adapter,
			app,
			icon: app?.icon || adapter.icon || null,
			operator: operatorEntry,
			availableSurfaces: deriveAvailableSurfaces(adapter, operatorEntry)
		});
	}
	return out;
}

/**
 * Returns the adapter for a given id, OR null if it's disabled / unknown.
 * Use this in API handlers to enforce the operator gate.
 */
export function getAdapter(id) {
	const cfg = getIntegrationsConfig() || {};
	const adapter = BY_ID.get(id) || null;
	return isEnabled(cfg[id], adapter) ? adapter : null;
}

/**
 * Returns the operator's settings block for an integration (the value of
 * `integrations.<id>` in config.yml). Useful for `fromOperatorDefault`
 * field prefills.
 */
export function getOperatorDefaults(id) {
	const cfg = getIntegrationsConfig() || {};
	const entry = cfg[id];
	return isEnabled(entry, BY_ID.get(id)) ? entry : null;
}

/**
 * Returns the list of surface keys an integration is allowed to expose,
 * intersected with what the operator enabled in config.yml.
 *
 * Order: ['search', 'widgets']  — UI renders toggles in this order.
 */
function deriveAvailableSurfaces(adapter, operatorEntry) {
	const operatorSurfaces = (operatorEntry && operatorEntry.surfaces) || {};
	const out = [];
	if (
		adapter.searchProviders &&
		Object.keys(adapter.searchProviders).length > 0 &&
		operatorSurfaces.search !== false
	) {
		out.push('search');
	}
	if (
		adapter.widgets &&
		Object.keys(adapter.widgets).length > 0 &&
		operatorSurfaces.widgets === true
	) {
		out.push('widgets');
	}
	return out;
}
