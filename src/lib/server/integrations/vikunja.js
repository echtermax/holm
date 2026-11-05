// Vikunja integration adapter.
//
// Surfaces:
//   - searchProviders.tasks — searches the user's tasks across every project
//     they can see (open ones first)
//   - searchProviders.quickadd — one row under `!vk`: Enter files the typed
//     text as a new task in the user's Inbox
//   - details — a task's project, due date, priority, people and description
//   - actions.create — the write the quickadd row carries
//
// Needs Vikunja 1.0 or later for /tasks (the /tasks/all route was renamed)
// and an API token, which is what /user answers a token with. Vikunja itself
// files a task typed on its home page in the user's default project — the
// Inbox every user gets — so new tasks go there, resolved the way the
// frontend does it (settings.default_project_id), with a project titled
// Inbox as the fallback when the setting is unset. The user and the project
// names are cached per token, so the lookup never runs per keystroke;
// `cache_ttl` sets the seconds, like on Plane.

import { getIntegrationsConfig } from '../config.js';

const cache = new Map();
const DEFAULT_CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function getCacheTtl() {
	const ttl = (getIntegrationsConfig() || {}).vikunja?.cache_ttl;
	if (typeof ttl === 'number' && ttl > 0) return ttl * 1000;
	return DEFAULT_CACHE_TTL_MS;
}

// A task's id, the only thing a detail request may carry.
const TASK_ID = /^\d{1,18}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

// Priority 0 is unset. Colours as on Vikunja's own picker.
const PRIORITY = {
	1: { label: 'Low', color: '#22c55e' },
	2: { label: 'Medium', color: '#eab308' },
	3: { label: 'High', color: '#f97316' },
	4: { label: 'Urgent', color: '#ef4444' },
	5: { label: 'Do now', color: '#ef4444' }
};

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'vikunja',
	name: 'Vikunja',
	icon: 'di:vikunja',
	shortcut: 'vk',
	description: 'To-dos: search tasks, add one to your Inbox',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'Vikunja URL',
			required: true,
			placeholder: 'https://vikunja.example.com',
			help: 'Base URL of your Vikunja server',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'token',
			type: 'secret',
			label: 'API token',
			required: true,
			help: '1. Open **Settings** → **API tokens**\n2. Create a token: under **tasks**, tick read and create; under **projects**, tick read\n3. Copy the token — it is only shown once',
			helpUrl: { baseKey: 'url', path: '/user/settings/api-tokens', label: 'Open Vikunja API tokens' }
		}
	],

	async test({ config, fetch }) {
		if (!config?.url || !config?.token) {
			return { ok: false, message: 'URL and API token are required' };
		}
		const base = stripTrailingSlash(config.url);
		try {
			const res = await fetch(`${base}/api/v1/user`, { method: 'GET', headers: headersOf(config) });
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { ok: false, message: 'API token rejected — check that it is valid and not expired' };
				}
				return { ok: false, message: `Server returned ${res.status} ${res.statusText}` };
			}
			const user = await res.json();
			if (!user?.username) return { ok: false, message: 'Could not read the account — is this a Vikunja server?' };
			return { ok: true, message: `Connected as ${user.username}` };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		// Declared before tasks so that, scoped to Vikunja, this one-row
		// section comes first: with nothing picked, Enter files the task.
		quickadd: {
			label: 'Quick add',
			mode: 'inline',
			scoped: true, // never asked in an everyday search, only under the scope
			async query({ query }) {
				const title = cleanTitle(query);
				if (!title) return { results: [] };
				return {
					results: [
						{
							// Fresh per dispatch, so the row's action state starts
							// over whenever the typed text changes.
							id: `new-${Date.now().toString(36)}`,
							title,
							subtitle: 'New task in your Inbox',
							action: { key: 'create', label: 'Add to Inbox', params: { title } },
							meta: { kind: 'card' }
						}
					]
				};
			}
		},

		tasks: {
			label: 'Tasks',
			mode: 'inline',
			async query({ config, query, limit, fetch }) {
				if (!config?.url || !config?.token) return { results: [] };
				const trimmed = (query || '').trim();
				if (!trimmed) return { results: [] };

				const base = stripTrailingSlash(config.url);
				const max = Math.min(limit || 10, 25);
				const params = new URLSearchParams({
					s: trimmed,
					sort_by: 'relevance',
					order_by: 'desc',
					per_page: String(max)
				});
				const res = await fetch(`${base}/api/v1/tasks?${params}`, {
					method: 'GET',
					headers: headersOf(config)
				});
				if (!res.ok) {
					throw new Error(`Vikunja search failed: ${res.status}`);
				}
				const found = await res.json();
				if (!Array.isArray(found)) return { results: [] };

				// Open ones first, within what the API already ranked.
				const tasks = [...found.filter((t) => !t.done), ...found.filter((t) => t.done)];
				const projects = await projectNames(base, config, fetch).catch(() => new Map());

				return {
					results: tasks.slice(0, max).map((t) => ({
						id: String(t.id),
						title: t.title,
						subtitle: [projects.get(t.project_id), dueShort(t.due_date), PRIORITY[t.priority]?.label]
							.filter(Boolean)
							.join(' · ')
							.slice(0, 120),
						href: `${base}/tasks/${t.id}`,
						openLabel: 'Open in Vikunja',
						detail: { id: String(t.id) },
						meta: { kind: 'card', status: t.done ? 'Done' : '' }
					}))
				};
			}
		}
	},

	actions: {
		create: {
			// Files the typed text as a task where Vikunja itself would file a
			// quick-add one: the user's Inbox, unless they moved their default
			// project.
			async run({ config, params, fetch }) {
				if (!config?.url || !config?.token) {
					return { ok: false, message: 'Vikunja is not connected' };
				}
				const title = cleanTitle(params?.title);
				if (!title) return { ok: false, message: 'Type what to add' };
				try {
					const base = stripTrailingSlash(config.url);
					const inbox = await inboxOf(base, config, fetch);
					if (!inbox) {
						return { ok: false, message: 'No Inbox found — set a default project in Vikunja' };
					}
					const res = await fetch(`${base}/api/v1/projects/${inbox.id}/tasks`, {
						method: 'PUT',
						headers: { ...headersOf(config), 'content-type': 'application/json' },
						body: JSON.stringify({ title })
					});
					if (!res.ok) {
						if (res.status === 401 || res.status === 403) {
							return { ok: false, message: 'Vikunja refused the task — the token needs write access' };
						}
						if (res.status === 404) {
							return { ok: false, message: 'The project the new task goes to is gone — set a default project in Vikunja' };
						}
						return { ok: false, message: `Vikunja answered ${res.status}` };
					}
					return { ok: true, message: `Added to ${inbox.title}` };
				} catch (err) {
					// No answer at all (down, offline, timed out) reads as a connection
					// error; an answer Vikunja gave keeps its own message.
					if (err?.name === 'TypeError' || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
						return { ok: false, message: 'Can’t reach Vikunja. Check the connection.' };
					}
					throw err;
				}
			}
		}
	},

	/** A task's facts and description; project names come from the cache. */
	async details({ config, params, fetch }) {
		if (!config?.url || !config?.token || !TASK_ID.test(params?.id || '')) return null;
		const base = stripTrailingSlash(config.url);
		const res = await fetch(`${base}/api/v1/tasks/${params.id}`, { method: 'GET', headers: headersOf(config) });
		if (!res.ok) {
			throw new Error(res.status === 404 ? 'This task is gone from Vikunja' : `Vikunja answered ${res.status}`);
		}
		const t = await res.json();
		if (!t?.id) return null;
		const projects = await projectNames(base, config, fetch).catch(() => new Map());
		const priority = PRIORITY[t.priority];
		const due = dueOf(t.due_date);
		const project = projects.get(t.project_id);
		const fields = [
			project && { label: 'Project', value: project },
			due && { label: 'Due', value: due.text, warn: due.warn },
			priority && { label: 'Priority', value: priority.label, color: priority.color },
			t.percent_done > 0 && t.percent_done < 100 && { label: 'Progress', value: `${t.percent_done}% done` },
			t.labels?.length && { label: 'Labels', chips: t.labels.map((l) => ({ text: l.title, color: safeColor(l.hex_color) })) },
			t.assignees?.length && { label: 'Assignees', chips: t.assignees.map((a) => ({ text: personName(a), initials: initialsOf(a) })) }
		].filter(Boolean);
		return {
			title: t.title || 'Untitled',
			facts: [
				t.identifier && `#${String(t.identifier).replace(/^#/, '')}`,
				t.done && dateOf(t.done_at) && `Done ${shortDate(t.done_at)}`,
				dateOf(t.created) && `Created ${shortDate(t.created)}`
			].filter(Boolean),
			fields,
			markdown: (t.description || '').trim()
		};
	},

	widgets: {}
};

// The user, their default project and the project names, cached per token:
// every lookup runs on a keystroke and has to be served from one call.
async function userOf(base, config, fetch) {
	const key = `${config.url}:${config.token}`;
	const cached = cache.get(key);
	if (cached && Date.now() < cached.expiresAt) return cached;

	const res = await fetch(`${base}/api/v1/user`, { method: 'GET', headers: headersOf(config) });
	if (!res.ok) throw new Error(`Vikunja /user failed: ${res.status}`);
	const user = await res.json();
	const entry = {
		// Where Vikunja itself files a quick-add task: 0 when unset.
		defaultProjectId: Number(user?.settings?.default_project_id) || 0,
		projects: new Map(), // id → title, filled by projectNames
		projectFull: false, // a page that fills up ends the list
		inbox: null, // the resolved task target
		expiresAt: Date.now() + getCacheTtl()
	};
	cache.set(key, entry);
	return entry;
}

// Project id → title, refreshed when the cache runs out. A page that fills
// up ends the list, so one more is asked for big installs.
async function projectNames(base, config, fetch) {
	const entry = await userOf(base, config, fetch);
	if (entry.projectFull && entry.projects.size) return entry.projects;
	for (let page = 1; page <= 3 && !entry.projectFull; page++) {
		const res = await fetch(`${base}/api/v1/projects?per_page=100&page=${page}`, {
			method: 'GET',
			headers: headersOf(config)
		});
		if (!res.ok) throw new Error(`Vikunja projects failed: ${res.status}`);
		const projects = await res.json();
		for (const p of Array.isArray(projects) ? projects : []) entry.projects.set(p.id, p.title || '');
		if (!Array.isArray(projects) || projects.length < 100) entry.projectFull = true;
	}
	return entry.projects;
}

// Where quick tasks go, sticky until the cache expires: the default project
// as Vikunja's own quick-add uses it, else a project titled Inbox.
async function inboxOf(base, config, fetch) {
	const entry = await userOf(base, config, fetch);
	if (entry.inbox) return entry.inbox;
	await projectNames(base, config, fetch).catch(() => {});
	if (entry.defaultProjectId) {
		const id = entry.defaultProjectId;
		entry.inbox = { id, title: entry.projects.get(id) || 'Inbox' };
		return entry.inbox;
	}
	const names = [...entry.projects].find(([, title]) => title.trim().toLowerCase() === 'inbox');
	if (names) {
		entry.inbox = { id: names[0], title: 'Inbox' };
		return entry.inbox;
	}
	return null;
}

// One line the user typed, as a task title: whitespace and control
// characters collapsed to spaces, nothing longer than Vikunja accepts.
function cleanTitle(text) {
	if (typeof text !== 'string') return '';
	return text
		.replace(/[\s\p{Cc}]+/gu, ' ')
		.trim()
		.slice(0, 250);
}

// Calendar days from today to a date, so a due date's age never drifts
// with the time of day or the daylight-saving shift.
function daysFromToday(date) {
	const a = new Date(date);
	a.setHours(0, 0, 0, 0);
	const b = new Date();
	b.setHours(0, 0, 0, 0);
	return Math.round((a - b) / DAY_MS);
}

// The date a task is due, red when it's past or within a day.
function dueOf(iso) {
	const d = dateOf(iso);
	if (!d) return null;
	const days = daysFromToday(d);
	const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days === -1 ? 'yesterday' : days < 0 ? `${-days} days late` : '';
	return { text: when ? `${shortDate(iso)} · ${when}` : shortDate(iso), warn: days <= 1 };
}

// A due date on a search row: only when there is one (unset ones come as
// the Go zero time). Near dates read as words.
function dueShort(iso) {
	const d = dateOf(iso);
	if (!d) return null;
	const days = daysFromToday(d);
	if (days === 0) return 'due today';
	if (days === 1) return 'due tomorrow';
	if (days === -1) return 'due yesterday';
	if (days < 0) return `${-days} days late`;
	if (days <= 7) return `due ${shortDate(iso)}`;
	return shortDate(iso);
}

function shortDate(iso) {
	const d = dateOf(iso);
	return d ? d.toLocaleDateString('en', { day: 'numeric', month: 'short' }) : null;
}

function dateOf(iso) {
	if (typeof iso !== 'string' || !iso || iso.startsWith('0001-')) return null;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? null : d;
}

function personName(a) {
	return [a?.name, a?.username].filter(Boolean)[0] || 'Someone';
}

function initialsOf(a) {
	const name = a?.name || a?.username || '';
	return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

// Vikunja's colours are hex; anything else isn't put in a style attribute.
function safeColor(c) {
	return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : null;
}

function stripTrailingSlash(url) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

function headersOf(config) {
	return {
		Authorization: `Bearer ${config.token}`,
		accept: 'application/json'
	};
}

export default adapter;
