// Gitea integration adapter.
//
// Surfaces:
//   - searchProviders.summary — an everyday search's one short section: the
//                               best-matching repo, then the latest issues
//                               and PRs
//   - searchProviders.issues, .pulls, .repos — under `!gt`, in place of the
//                               summary: issues, PRs and repos the token can
//                               see, by title, name and description
//
// Each user connects with their own read-only access token. Gitea searches
// server-side and has no tight rate limit, so one issue search per query
// feeds the summary and both issue sections from a short cache, and repos
// are searched as typed.

import { STATE_COLORS, issueKind } from './forge.js';

const issueCache = new Map(); // url + token + query → { items, expiresAt }
const ISSUE_CACHE_TTL_MS = 60_000;
const MAX_ISSUE_CACHE_ENTRIES = 200;
const ISSUES_PER_SEARCH = 50;
const REPOS_PER_SEARCH = 50;
const SUMMARY_ISSUES = 3;

// Sections that ask while the cache is cold join the search already running.
const issuesInFlight = new Map();

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'gitea',
	name: 'Gitea',
	icon: 'di:gitea',
	shortcut: 'gt',
	description: 'Your repositories, issues and pull requests',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'Gitea URL',
			required: true,
			placeholder: 'https://gitea.example.com',
			help: 'Base URL of your Gitea server',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'apiKey',
			type: 'secret',
			label: 'Access token',
			required: true,
			help: '1. Open **Settings** → **Applications**\n2. Under **Generate New Token**, name it\n3. Under **Select permissions**, set **repository**, **issue** and **user** to **Read**, and leave the rest at **No access**\n4. Generate the token and copy it',
			helpUrl: { baseKey: 'url', path: '/user/settings/applications', label: 'Open Gitea settings' }
		}
	],

	async test({ config, fetch }) {
		if (!config?.url || !config?.apiKey) {
			return { ok: false, message: 'URL and access token are required' };
		}
		try {
			const res = await fetch(`${apiBase(config)}/user`, { method: 'GET', headers: authHeaders(config) });
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { ok: false, message: 'Token rejected — check that it is valid and can read your user' };
				}
				return { ok: false, message: `Gitea returned ${res.status} ${res.statusText}` };
			}
			const login = (await res.json())?.login;
			return { ok: true, message: login ? `Connected as ${login}` : 'Connected' };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		summary: {
			label: 'Gitea',
			mode: 'inline',
			plainOnly: true,
			async query({ config, query, fetch }) {
				const trimmed = (query || '').trim();
				if (!config?.url || !config?.apiKey || !trimmed) return { results: [] };
				const [repos, items] = await Promise.all([searchRepos(config, trimmed, fetch), searchIssues(config, trimmed, fetch)]);
				const latest = [...items].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, SUMMARY_ISSUES);
				return { results: [...repos.slice(0, 1).map(repoRow), ...latest.map(issueRow)] };
			}
		},
		issues: {
			label: 'Issues',
			mode: 'inline',
			scoped: true,
			query: (ctx) => issueSection(ctx, false)
		},
		pulls: {
			label: 'Pull requests',
			mode: 'inline',
			scoped: true,
			query: (ctx) => issueSection(ctx, true)
		},
		repos: {
			label: 'Repositories',
			mode: 'inline',
			scoped: true,
			async query({ config, query, limit, fetch }) {
				const trimmed = (query || '').trim();
				if (!config?.url || !config?.apiKey || !trimmed) return { results: [] };
				const repos = await searchRepos(config, trimmed, fetch);
				return {
					results: repos.slice(0, Math.min(limit || 10, 25)).map(repoRow),
					more: `${stripTrailingSlash(config.url)}/explore/repos?${new URLSearchParams({ q: trimmed })}`
				};
			}
		}
	},

	widgets: {}
};

async function issueSection({ config, query, limit, fetch }, pulls) {
	const trimmed = (query || '').trim();
	if (!config?.url || !config?.apiKey || !trimmed) return { results: [] };
	const items = (await searchIssues(config, trimmed, fetch)).filter((it) => !!it.pull_request === pulls);
	return {
		results: items.slice(0, Math.min(limit || 10, 25)).map(issueRow),
		more: `${stripTrailingSlash(config.url)}/${pulls ? 'pulls' : 'issues'}?${new URLSearchParams({ q: trimmed, state: 'all' })}`
	};
}

// Name matches first (exact, then prefix), then the rest in Gitea's order.
async function searchRepos(config, query, fetch) {
	const params = new URLSearchParams({ q: query, includeDesc: 'true', limit: String(REPOS_PER_SEARCH) });
	const res = await fetch(`${apiBase(config)}/repos/search?${params}`, { method: 'GET', headers: authHeaders(config) });
	if (!res.ok) throw new Error(`Gitea repo search failed: ${res.status}`);
	const q = query.toLowerCase();
	const rank = (r) => {
		const name = (r.name || '').toLowerCase();
		return name === q ? 0 : name.startsWith(q) ? 1 : 2;
	};
	return ((await res.json())?.data || [])
		.map((r, i) => ({ r, key: rank(r) * 10_000 + i }))
		.sort((a, b) => a.key - b.key)
		.map(({ r }) => r);
}

function repoRow(r) {
	return {
		id: `repo:${r.id}`,
		title: r.full_name,
		subtitle: [r.description, r.language, r.stars_count ? `★ ${r.stars_count}` : '']
			.filter(Boolean)
			.join(' · ')
			.slice(0, 120),
		href: r.html_url,
		meta: { kind: 'repo', status: r.private ? 'Private' : r.archived ? 'Archived' : '' }
	};
}

function issueRow(it) {
	const pr = it.pull_request;
	const status = pr?.merged ? 'Merged' : it.state === 'closed' ? 'Closed' : 'Open';
	return {
		id: `issue:${it.id}`,
		title: it.title,
		subtitle: [`${it.repository?.full_name || ''}#${it.number}`, `updated ${shortDate(it.updated_at)}`].join(' · '),
		href: it.html_url,
		meta: { kind: issueKind(!!pr, status), color: STATE_COLORS[status], status }
	};
}

// Issues and PRs in every repo the token can see, most recently updated
// first: one request per token and query, whichever sections ask for it.
function searchIssues(config, query, fetch) {
	const cacheKey = `${apiBase(config)}\n${config.apiKey}\n${query.toLowerCase()}`;
	const cached = issueCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.items);
	let pending = issuesInFlight.get(cacheKey);
	if (!pending) {
		pending = fetchIssues(config, query, fetch)
			.then((items) => {
				if (issueCache.size >= MAX_ISSUE_CACHE_ENTRIES) issueCache.delete(issueCache.keys().next().value);
				issueCache.set(cacheKey, { items, expiresAt: Date.now() + ISSUE_CACHE_TTL_MS });
				return items;
			})
			.finally(() => issuesInFlight.delete(cacheKey));
		issuesInFlight.set(cacheKey, pending);
	}
	return pending;
}

async function fetchIssues(config, query, fetch) {
	const params = new URLSearchParams({ q: query, state: 'all', limit: String(ISSUES_PER_SEARCH) });
	const res = await fetch(`${apiBase(config)}/repos/issues/search?${params}`, { method: 'GET', headers: authHeaders(config) });
	if (!res.ok) throw new Error(`Gitea search failed: ${res.status}`);
	const items = await res.json();
	return Array.isArray(items) ? items : [];
}

function shortDate(iso) {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function stripTrailingSlash(url) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

function apiBase(config) {
	return `${stripTrailingSlash(config.url)}/api/v1`;
}

function authHeaders(config) {
	return { Authorization: `token ${config.apiKey}`, accept: 'application/json' };
}

export default adapter;
