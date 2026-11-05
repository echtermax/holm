import { getIntegrationsConfig } from '../config.js';

// Plane integration adapter.
//
// Surfaces:
//   - searchProviders.items — searches work items by title or ID (WEB-42)
//     across every project in the workspace the user can see
//   - details — a work item's state, priority, people, labels, dates and
//     description
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIORITY = {
	urgent: { label: 'Urgent', color: '#ef4444' },
	high: { label: 'High', color: '#f97316' },
	medium: { label: 'Medium', color: '#eab308' },
	low: { label: 'Low', color: '#22c55e' }
};
const DAY_MS = 24 * 60 * 60 * 1000;

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
					const named = (it) => String(it.sequence_id) === id[2] && it.project__identifier?.toLowerCase() === id[1].toLowerCase();
					items = items.filter(
						(it) =>
							String(it.sequence_id) !== id[2] ||
							named(it) ||
							it.name?.toLowerCase().includes(trimmed.toLowerCase())
					);
					// The item the ID names comes first, ahead of titles that mention it.
					items = [...items.filter(named), ...items.filter((it) => !named(it))];
				}

				return {
					results: items.slice(0, max).map((it) => {
						const key = `${it.project__identifier}-${it.sequence_id}`;
						return {
							id: String(it.id),
							title: it.name,
							subtitle: [key, projects.get(it.project_id)].filter(Boolean).join(' · '),
							href: `${base}/${slug}/browse/${key}/`,
							openLabel: 'Open in Plane',
							detail: { project: it.project_id, item: it.id },
							meta: { kind: 'card' }
						};
					})
				};
			}
		}
	},

	/** A work item's facts and description; the parent costs a second request. */
	async details({ config, params, fetch }) {
		if (!config?.url || !config?.workspace || !config?.apiKey) return null;
		if (!UUID.test(params?.project || '') || !UUID.test(params?.item || '')) return null;
		const base = stripTrailingSlash(config.url);
		const projects = `${base}/api/v1/workspaces/${encodeURIComponent(config.workspace)}/projects`;
		const get = async (url) => {
			const res = await fetch(url, { method: 'GET', headers: authHeaders(config) });
			if (!res.ok) throw new Error(res.status === 404 ? 'This work item is gone from Plane' : `Plane answered ${res.status}`);
			return await res.json();
		};
		const it = await get(`${projects}/${params.project}/work-items/${params.item}/?expand=state,assignees,labels,project,parent`);
		const project = it.project && typeof it.project === 'object' ? it.project : {};
		const parent = it.parent?.id
			? await get(`${projects}/${it.parent.project_id || params.project}/work-items/${it.parent.id}/?expand=project`).catch(() => null)
			: null;
		const priority = PRIORITY[it.priority];
		const due = dueOf(it.target_date);
		const fields = [
			project.name && { label: 'Project', value: project.identifier ? `${project.name} (${project.identifier})` : project.name },
			it.state?.name && { label: 'State', value: it.state.name, color: safeColor(it.state.color) },
			priority && { label: 'Priority', value: priority.label, color: priority.color },
			it.assignees?.length && { label: 'Assignees', chips: it.assignees.map((a) => ({ text: personName(a), initials: initialsOf(personName(a)) })) },
			it.labels?.length && { label: 'Labels', chips: it.labels.map((l) => ({ text: l.name, color: safeColor(l.color) })) },
			due && { label: 'Due', value: due.text, warn: due.warn },
			parent && { label: 'Parent', value: [itemKey(parent), parent.name].filter(Boolean).join(' · ') }
		].filter(Boolean);
		return {
			title: it.name || 'Untitled',
			facts: [project.identifier && it.sequence_id ? `${project.identifier}-${it.sequence_id}` : '', it.updated_at ? `Updated ${ago(it.updated_at)}` : ''].filter(Boolean),
			fields,
			html: hasText(it.description_html) ? it.description_html : ''
		};
	},

	widgets: {}
};

function itemKey(it) {
	const id = it?.project?.identifier || it?.project__identifier;
	return id && it.sequence_id ? `${id}-${it.sequence_id}` : '';
}

function personName(a) {
	return [a.first_name, a.last_name].filter(Boolean).join(' ') || a.display_name || 'Someone';
}

function initialsOf(name) {
	return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// Plane's colours are hex; anything else isn't put in a style attribute.
function safeColor(c) {
	return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : null;
}

// "<p></p>" is Plane's empty description.
function hasText(html) {
	return !!html && html.replace(/<[^>]*>/g, '').trim().length > 0;
}

// A due date, red when it's past or within a day.
function dueOf(date) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null;
	const d = new Date(`${date}T00:00:00`);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const days = Math.round((d - today) / DAY_MS);
	const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days < 0 ? `${-days} days late` : '';
	const text = d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
	return { text: when ? `${text} · ${when}` : text, warn: days <= 1 };
}

function ago(iso) {
	const ms = Date.now() - new Date(iso).getTime();
	if (!Number.isFinite(ms)) return '';
	const min = Math.round(ms / 60_000);
	if (min < 1) return 'just now';
	if (min < 60) return `${min} m ago`;
	const h = Math.round(min / 60);
	if (h < 24) return `${h} h ago`;
	const d = Math.round(h / 24);
	return d < 30 ? `${d} d ago` : new Date(iso).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
