// GitHub integration adapter.
//
// Surfaces:
//   - searchProviders.summary — an everyday search's one short section: the
//                               best-matching repo, then the latest issues
//                               and PRs
//   - searchProviders.issues, .pulls, .repos — under `!gh`, in place of the
//                               summary: issues and PRs the user is involved
//                               in, and the repos the token can see, by name
//                               and description
//
// Each user connects with their own read-only fine-grained token. Such a
// token covers the repos of one owner (the user, or an org they pick), plus
// every public repo; private repos of other owners never show. Repos come
// from /user/repos, cached per token and filtered locally, so they cost no
// search requests. Issues and PRs need the search API, which allows only 30
// requests a minute per user: the search bar asks it only once typing stops
// (`delay`), one request per query feeds every section, repeat queries come
// from a short cache, and no more go out until the limit resets once GitHub
// says it is used up.

import { STATE_COLORS, issueKind } from './forge.js';

const API = 'https://api.github.com';
const WEB = 'https://github.com';

const repoCache = new Map(); // token → { login, repos, expiresAt }
const REPO_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const MAX_REPO_PAGES = 3; // 300 repos, most recently pushed first

const issueCache = new Map(); // token + query → { items, expiresAt }
const ISSUE_CACHE_TTL_MS = 60_000;
const MAX_ISSUE_CACHE_ENTRIES = 200;
const ISSUES_PER_SEARCH = 30;
const SUMMARY_ISSUES = 3;
const ISSUE_DELAY_MS = 700;

const searchBlockedUntil = new Map(); // token → ms since the epoch

// One repo crawl per token, and one search per token and query, at a time:
// keystrokes and sections that ask while the cache is cold join the request
// already running.
const inFlight = new Map();
const issuesInFlight = new Map();

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'github',
	name: 'GitHub',
	icon: 'di:github',
	shortcut: 'gh',
	description: 'Your repositories, issues and pull requests',

	configSchema: [
		{
			key: 'apiKey',
			type: 'secret',
			label: 'Fine-grained token',
			required: true,
			help: '1. Open [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)\n2. Pick an expiry. Under **Resource owner** keep yourself, or pick an org to search its repos instead; under **Repository access** choose **All repositories**\n3. Under **Permissions**, set **Issues** and **Pull requests** to **Read-only**\n4. Generate the token and copy it'
		}
	],

	async test({ config, fetch }) {
		if (!config?.apiKey) {
			return { ok: false, message: 'A token is required' };
		}
		try {
			const res = await fetch(`${API}/user`, { method: 'GET', headers: authHeaders(config) });
			if (!res.ok) {
				if (res.status === 401) {
					return { ok: false, message: 'Token rejected — check that it is valid and not expired' };
				}
				return { ok: false, message: `GitHub returned ${res.status} ${res.statusText}` };
			}
			const login = (await res.json())?.login;
			return { ok: true, message: login ? `Connected as ${login}` : 'Connected' };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		summary: {
			label: 'GitHub',
			mode: 'inline',
			plainOnly: true,
			delay: ISSUE_DELAY_MS,
			async query({ config, query, fetch }) {
				const trimmed = (query || '').trim();
				if (!config?.apiKey || !trimmed) return { results: [] };
				const [repos, items] = await Promise.allSettled([matchingRepos(config, trimmed, fetch), searchIssues(config, trimmed, fetch)]);
				// A spent search budget still leaves the repo to show.
				if (repos.status === 'rejected' || (items.status === 'rejected' && !repos.value.length)) {
					throw repos.status === 'rejected' ? repos.reason : items.reason;
				}
				const latest = items.status === 'fulfilled'
					? [...items.value].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, SUMMARY_ISSUES)
					: [];
				return { results: [...repos.value.slice(0, 1).map(repoRow), ...latest.map(issueRow)] };
			}
		},
		issues: {
			label: 'Issues',
			mode: 'inline',
			scoped: true,
			delay: ISSUE_DELAY_MS,
			query: (ctx) => issueSection(ctx, false)
		},
		pulls: {
			label: 'Pull requests',
			mode: 'inline',
			scoped: true,
			delay: ISSUE_DELAY_MS,
			query: (ctx) => issueSection(ctx, true)
		},
		repos: {
			label: 'Repositories',
			mode: 'inline',
			scoped: true,
			async query({ config, query, limit, fetch }) {
				const trimmed = (query || '').trim();
				if (!config?.apiKey || !trimmed) return { results: [] };
				const { login } = await loadRepos(config, fetch);
				const matches = (await matchingRepos(config, trimmed, fetch)).slice(0, Math.min(limit || 10, 25));
				return {
					results: matches.map(repoRow),
					more: login ? `${WEB}/${encodeURIComponent(login)}?${new URLSearchParams({ tab: 'repositories', q: trimmed })}` : undefined
				};
			}
		}
	},

	widgets: {}
};

async function issueSection({ config, query, limit, fetch }, pulls) {
	const trimmed = (query || '').trim();
	if (!config?.apiKey || !trimmed) return { results: [] };
	const q = `${trimmed} involves:@me ${pulls ? 'is:pr' : 'is:issue'}`;
	const items = (await searchIssues(config, trimmed, fetch)).filter((it) => !!it.pull_request === pulls);
	return {
		results: items.slice(0, Math.min(limit || 10, 25)).map(issueRow),
		more: `${WEB}/search?${new URLSearchParams({ q, type: pulls ? 'pullrequests' : 'issues' })}`
	};
}

// Name matches first (exact, then prefix), then the rest; most recently
// pushed first within each.
async function matchingRepos(config, query, fetch) {
	const q = query.toLowerCase();
	const { repos } = await loadRepos(config, fetch);
	const rank = (r) => {
		const name = r.name.toLowerCase();
		return name === q ? 0 : name.startsWith(q) ? 1 : r.full_name.toLowerCase().includes(q) ? 2 : 3;
	};
	return repos
		.filter((r) => r.full_name.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q))
		.map((r, i) => ({ r, key: rank(r) * 10_000 + i }))
		.sort((a, b) => a.key - b.key)
		.map(({ r }) => r);
}

function repoRow(r) {
	return {
		id: `repo:${r.id}`,
		title: r.full_name,
		subtitle: [r.description, r.language, r.stargazers_count ? `★ ${r.stargazers_count}` : '']
			.filter(Boolean)
			.join(' · ')
			.slice(0, 120),
		href: r.html_url,
		meta: { kind: 'repo', status: r.private ? 'Private' : r.archived ? 'Archived' : '' }
	};
}

function issueRow(it) {
	const repo = it.repository_url?.replace(`${API}/repos/`, '') || '';
	const pr = it.pull_request;
	const status = pr?.merged_at ? 'Merged' : it.state === 'closed' ? 'Closed' : 'Open';
	return {
		id: `issue:${it.id}`,
		title: it.title,
		subtitle: [`${repo}#${it.number}`, `updated ${shortDate(it.updated_at)}`].join(' · '),
		href: it.html_url,
		meta: { kind: issueKind(!!pr, status), color: STATE_COLORS[status], status }
	};
}

// Issues and PRs the user is involved in, best match first: one search
// request per token and query, whichever sections ask for it.
function searchIssues(config, query, fetch) {
	const cacheKey = `${config.apiKey}\n${query.toLowerCase()}`;
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
	const blockedUntil = searchBlockedUntil.get(config.apiKey) || 0;
	if (Date.now() < blockedUntil) throw limitError(blockedUntil);

	// Fine-grained tokens get a 422 unless the query names issues or PRs,
	// and only advanced search takes the OR.
	const params = new URLSearchParams({
		q: `${query} involves:@me (is:issue OR is:pull-request)`,
		advanced_search: 'true',
		per_page: String(ISSUES_PER_SEARCH)
	});
	const res = await fetch(`${API}/search/issues?${params}`, { method: 'GET', headers: authHeaders(config) });
	noteSearchLimit(config.apiKey, res);
	if (!res.ok) {
		if ((res.status === 403 || res.status === 429) && searchBlockedUntil.has(config.apiKey)) {
			throw limitError(searchBlockedUntil.get(config.apiKey));
		}
		throw new Error(`GitHub search failed: ${res.status}`);
	}
	return (await res.json())?.items || [];
}

function loadRepos(config, fetch) {
	const cached = repoCache.get(config.apiKey);
	if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached);
	let pending = inFlight.get(config.apiKey);
	if (!pending) {
		pending = fetchRepos(config, fetch)
			.then(({ login, repos }) => {
				const entry = { login, repos, expiresAt: Date.now() + REPO_CACHE_TTL_MS };
				repoCache.set(config.apiKey, entry);
				return entry;
			})
			.finally(() => inFlight.delete(config.apiKey));
		inFlight.set(config.apiKey, pending);
	}
	return pending;
}

async function fetchRepos(config, fetch) {
	const me = await fetch(`${API}/user`, { method: 'GET', headers: authHeaders(config) });
	if (!me.ok) throw new Error(`GitHub user failed: ${me.status}`);
	const login = (await me.json())?.login || '';
	const repos = [];
	let url = `${API}/user/repos?per_page=100&sort=pushed`;
	for (let page = 0; url && page < MAX_REPO_PAGES; page++) {
		const res = await fetch(url, { method: 'GET', headers: authHeaders(config) });
		if (!res.ok) throw new Error(`GitHub repos failed: ${res.status}`);
		repos.push(...((await res.json()) || []));
		url = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get('link') || '')?.[1] || null;
	}
	return { login, repos };
}

// When GitHub reports the search budget spent, no more searches go out for
// this token until it resets.
function noteSearchLimit(token, res) {
	const remaining = res.headers.get('x-ratelimit-remaining');
	const reset = Number(res.headers.get('x-ratelimit-reset'));
	const retryAfter = Number(res.headers.get('retry-after'));
	if (retryAfter > 0) {
		searchBlockedUntil.set(token, Date.now() + retryAfter * 1000);
	} else if (remaining === '0' && reset > 0) {
		searchBlockedUntil.set(token, reset * 1000);
	} else {
		searchBlockedUntil.delete(token);
	}
}

function limitError(until) {
	return new Error(`GitHub search limit reached, try again in ${Math.max(1, Math.ceil((until - Date.now()) / 1000))} s`);
}

function shortDate(iso) {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function authHeaders(config) {
	return {
		Authorization: `Bearer ${config.apiKey}`,
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28'
	};
}

export default adapter;
