import { getIntegrationsConfig } from '../config.js';

// Plane integration adapter.
//
// Surfaces:
//   - searchProviders.items — searches work items by title or ID (WEB-42)
//     across every project in the workspace the user can see
//
// Each user connects with their own Plane API key, so results follow that
// user's project membership. Needs Plane 1.1 or later for the workspace-wide
// /work-items/search/ endpoint. Search returns only names and IDs, so project
// names come from a per-user cache of the project list.

const projectCache = new Map();
const DEFAULT_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function getCacheTtl() {
	const ttl = (getIntegrationsConfig() || {}).plane?.cache_ttl;
	if (typeof ttl === 'number' && ttl > 0) return ttl * 1000;
	return DEFAULT_CACHE_TTL_MS;
}

// A work item ID: project identifier, a dash, the sequence number.
const ITEM_ID = /^([A-Za-z0-9]+)-(\d+)$/;

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'plane',
	name: 'Plane',
	icon: 'di:plane',
	shortcut: 'plane',
	description: 'Project tracking with work item search',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'Plane URL',
			required: true,
			placeholder: 'https://plane.example.com',
			help: 'Base URL of your Plane server',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'workspace',
			type: 'text',
			label: 'Workspace',
			required: true,
			placeholder: 'my-workspace',
			help: 'The part of the address after the server, e.g. `my-workspace` in plane.example.com/my-workspace/projects',
			fromOperatorDefault: 'default_workspace'
		},
		{
			key: 'apiKey',
			type: 'secret',
			label: 'API Key',
			required: true,
			help: '1. Open **Profile settings** → **Personal Access Tokens**\n2. Click **Add personal access token**, name it and pick an expiry\n3. Copy the token'
		}
	],

	async test({ config, fetch }) {
		if (!config?.url || !config?.workspace || !config?.apiKey) {
			return { ok: false, message: 'URL, workspace and API key are required' };
		}
		const base = stripTrailingSlash(config.url);
		try {
			// Plane answers 403 for a bad key and for a workspace the user can't
			// see alike, so the key is checked on its own first.
			const me = await fetch(`${base}/api/v1/users/me/`, {
				method: 'GET',
				headers: authHeaders(config)
			});
			if (me.status === 401 || me.status === 403) {
				return { ok: false, message: 'API key rejected — check that it is valid and not expired' };
			}
			if (!me.ok) {
				return { ok: false, message: `Server returned ${me.status} ${me.statusText}` };
			}
			const res = await fetch(`${base}/api/v1/workspaces/${encodeURIComponent(config.workspace)}/projects/`, {
				method: 'GET',
				headers: authHeaders(config)
			});
			if (!res.ok) {
				if (res.status === 403 || res.status === 404) {
					return { ok: false, message: `Workspace "${config.workspace}" not found, or you aren't a member` };
				}
				return { ok: false, message: `Server returned ${res.status} ${res.statusText}` };
			}
			const projects = (await res.json())?.results || [];
			return { ok: true, message: `Connected — ${projects.length} project${projects.length !== 1 ? 's' : ''} accessible` };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		items: {
			label: 'Work items',
			mode: 'inline',
			async query({ config, query, limit, fetch }) {
				if (!config?.url || !config?.workspace || !config?.apiKey) return { results: [] };
				const trimmed = (query || '').trim();
				if (!trimmed) return { results: [] };

				const base = stripTrailingSlash(config.url);
				const slug = encodeURIComponent(config.workspace);
				const max = Math.min(limit || 10, 25);
				const params = new URLSearchParams({ search: trimmed, limit: String(max), workspace_search: 'true' });
				const [res, projects] = await Promise.all([
					fetch(`${base}/api/v1/workspaces/${slug}/work-items/search/?${params}`, {
						method: 'GET',
						headers: authHeaders(config)
					}),
					loadProjects(base, slug, config, fetch).catch(() => new Map())
				]);
				if (!res.ok) {
					throw new Error(`Plane search failed: ${res.status}`);
				}
				let items = (await res.json())?.issues || [];

				// Plane matches the number in "WEB-42" against every project's
				// item 42, so keep only the one the ID names.
				const id = ITEM_ID.exec(trimmed);
				if (id) {
					items = items.filter(
						(it) =>
							String(it.sequence_id) !== id[2] ||
							it.project__identifier?.toLowerCase() === id[1].toLowerCase() ||
							it.name?.toLowerCase().includes(trimmed.toLowerCase())
					);
				}

				return {
					results: items.slice(0, max).map((it) => {
						const key = `${it.project__identifier}-${it.sequence_id}`;
						return {
							id: String(it.id),
							title: it.name,
							subtitle: [key, projects.get(it.project_id)].filter(Boolean).join(' · '),
							href: `${base}/${slug}/browse/${key}/`,
							meta: { kind: 'card' }
						};
					})
				};
			}
		}
	},

	widgets: {}
};

async function loadProjects(base, slug, config, fetch) {
	const cacheKey = `${config.url}:${config.workspace}:${config.apiKey}`;
	const cached = projectCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) return cached.names;

	const res = await fetch(`${base}/api/v1/workspaces/${slug}/projects/?per_page=100`, {
		method: 'GET',
		headers: authHeaders(config)
	});
	if (!res.ok) throw new Error(`Plane projects failed: ${res.status}`);
	const names = new Map(((await res.json())?.results || []).map((p) => [p.id, p.name]));
	projectCache.set(cacheKey, { names, expiresAt: Date.now() + getCacheTtl() });
	return names;
}

function stripTrailingSlash(url) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

function authHeaders(config) {
	return {
		'X-API-Key': config.apiKey,
		accept: 'application/json'
	};
}

export default adapter;
