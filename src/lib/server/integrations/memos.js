import { progressOf, sameTask, setTask, tasksOf } from '../../checklist.js';

// Memos integration adapter.
//
// Surfaces:
//   - searchProviders.memos — searches the user's own memos by content
//   - details — a memo in full, with its checklist live
//   - actions.check — ticks or unticks one checklist item in a memo
//
// Needs Memos 0.26 or later: auth/me and the CEL `content.contains` filter.
// 0.26 names users `users/<id>` and filters on `creator_id`; 0.27 renamed
// them `users/<username>` and added the `creator` filter, so the filter
// follows whichever name the server hands back. 26.10 moved the API from
// /api/v1 to /api; older servers answer 404 there, so /api/v1 is the
// fallback.

// The API path and the filter for "memos this user created" change per
// release, and the user behind a token doesn't, so both are looked up per
// token and kept for a few minutes; the expiry picks up an upgrade, and a
// rename on 0.27+, where the filter is the username.
const userCache = new Map();
const USER_CACHE_TTL_MS = 5 * 60_000; // 5 minutes
const API_PATHS = ['/api', '/api/v1'];
// Memo IDs are short base58-ish strings; anything else isn't one.
const MEMO_UID = /^[A-Za-z0-9_-]{1,64}$/;

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'memos',
	name: 'Memos',
	// dashboard-icons' memos.svg is ~240 KB, over the icon proxy's cap.
	icon: '/api/icon/lucide/notebook-pen',
	shortcut: 'memo',
	description: 'Self-hosted note taking',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'Memos URL',
			required: true,
			placeholder: 'https://memos.example.com',
			help: 'Base URL of your Memos server',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'apiKey',
			type: 'secret',
			label: 'Access Token',
			required: true,
			help: '1. Open **Settings** → **Access Tokens**\n2. Click **Create**, name it and pick an expiry\n3. Copy the token',
			helpUrl: { baseKey: 'url', path: '/setting#access-token', label: 'Open Memos settings' }
		}
	],

	async test({ config, fetch }) {
		if (!config?.url || !config?.apiKey) {
			return { ok: false, message: 'URL and access token are required' };
		}
		const base = stripTrailingSlash(config.url);
		try {
			const { res } = await fetchMe(base, config, fetch);
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { ok: false, message: 'Access token rejected — check that it is valid and not expired' };
				}
				if (res.status === 404) {
					return { ok: false, message: 'Memos 0.26 or later is required' };
				}
				return { ok: false, message: `Server returned ${res.status} ${res.statusText}` };
			}
			const user = (await res.json())?.user;
			if (!user?.name) return { ok: false, message: 'Memos 0.26 or later is required' };
			return { ok: true, message: user.username ? `Connected as ${user.username}` : 'Connected' };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		memos: {
			label: 'Memos',
			mode: 'inline',
			async query({ config, query, limit, fetch }) {
				if (!config?.url || !config?.apiKey) return { results: [] };
				const trimmed = (query || '').trim();
				if (!trimmed) return { results: [] };

				const base = stripTrailingSlash(config.url);
				const { api, filter: creator } = await userOf(base, config, fetch);
				// JSON string escapes are valid CEL string escapes.
				const params = new URLSearchParams({
					filter: `${creator} && content.contains(${JSON.stringify(trimmed)})`,
					pageSize: String(Math.min(limit || 10, 25))
				});
				const res = await fetch(`${base}${api}/memos?${params}`, {
					method: 'GET',
					headers: authHeaders(config)
				});
				if (!res.ok) {
					throw new Error(`Memos search failed: ${res.status}`);
				}
				const memos = (await res.json())?.memos || [];
				return {
					results: memos.map((memo) => {
						const { title, rest } = splitSnippet(memo);
						const uid = (memo.name || '').replace(/^memos\//, '');
						return {
							id: uid,
							title,
							subtitle: [formatDate(memo.createTime), rest].filter(Boolean).join(' · ').slice(0, 120),
							href: `${base}/memos/${encodeURIComponent(uid)}`,
							openLabel: 'Open in Memos',
							detail: { uid },
							tags: memo.tags || [],
							meta: { kind: 'document', progress: progressOf(memo.content) }
						};
					})
				};
			}
		}
	},

	/**
	 * A memo in full: its Markdown without the heading or tag line the title
	 * and tags already show, and its checklist live (actions.check saves it).
	 */
	async details({ config, params, fetch }) {
		if (!config?.url || !config?.apiKey || !MEMO_UID.test(params?.uid || '')) return null;
		const base = stripTrailingSlash(config.url);
		const memo = await getMemo(base, config, fetch, params.uid);
		const { title } = splitSnippet(memo);
		const progress = progressOf(memo.content);
		const edited = memo.updateTime && formatDate(memo.updateTime) !== formatDate(memo.createTime);
		return {
			title,
			facts: [
				'Memos',
				memo.createTime ? `Created ${formatDate(memo.createTime)}` : '',
				edited ? `Edited ${formatDate(memo.updateTime)}` : '',
				progress ? `${progress.done} of ${progress.total} done` : ''
			].filter(Boolean),
			pinned: !!memo.pinned,
			genres: memo.tags || [],
			markdown: bodyOf(memo.content || '', title),
			checklist: { key: 'check', params: { uid: params.uid } }
		};
	},

	actions: {
		/**
		 * Ticks or unticks task `index`. The memo is read again first and only
		 * that line changes, so an edit made in Memos meanwhile is kept; when
		 * the line no longer reads `text`, nothing is saved.
		 */
		check: {
			async run({ config, params, fetch }) {
				const { uid, index, checked, text } = params || {};
				if (!config?.url || !config?.apiKey || !MEMO_UID.test(uid || '') || !Number.isInteger(index) || index < 0 || typeof checked !== 'boolean') {
					return { ok: false, message: 'Invalid checklist item' };
				}
				try {
					return await saveTask(stripTrailingSlash(config.url), config, fetch, { uid, index, checked, text });
				} catch (err) {
					// No answer at all (down, offline, timed out) reads as a connection
					// error; an answer Memos gave keeps its own message.
					if (err?.name === 'TypeError' || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
						return { ok: false, message: 'Can’t reach Memos. Check the connection.' };
					}
					throw err;
				}
			}
		}
	},

	widgets: {}
};

// Re-reads the memo, then saves task `index` if its line still reads `text`.
async function saveTask(base, config, fetch, { uid, index, checked, text }) {
	const memo = await getMemo(base, config, fetch, uid);
	const task = tasksOf(memo.content)[index];
	if (!task || !sameTask(task.text, text)) {
		return { ok: false, message: 'This memo changed in Memos. Go back and open it again.' };
	}
	if (task.checked === checked) return { ok: true, message: 'Saved' };
	const { api } = await userOf(base, config, fetch);
	const res = await fetch(`${base}${api}/memos/${encodeURIComponent(uid)}?updateMask=content`, {
		method: 'PATCH',
		headers: { ...authHeaders(config), 'content-type': 'application/json' },
		body: JSON.stringify({ content: setTask(memo.content, index, checked) })
	});
	if (!res.ok) {
		if (res.status === 401 || res.status === 403) return { ok: false, message: 'Memos refused the change. Check the access token.' };
		return { ok: false, message: `Memos answered ${res.status}` };
	}
	return { ok: true, message: 'Saved' };
}

// auth/me on the first API path that has it: /api from 26.10, /api/v1 before.
async function fetchMe(base, config, fetch) {
	let res;
	for (const api of API_PATHS) {
		res = await fetch(`${base}${api}/auth/me`, { method: 'GET', headers: authHeaders(config) });
		if (res.status !== 404) return { api, res };
	}
	return { api: API_PATHS[API_PATHS.length - 1], res };
}

async function userOf(base, config, fetch) {
	const cacheKey = `${config.url}:${config.apiKey}`;
	const cached = userCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt) return cached;

	const { api, res } = await fetchMe(base, config, fetch);
	if (!res.ok) throw new Error(`Memos auth/me failed: ${res.status}`);
	const user = (await res.json())?.user;
	const name = user?.name || '';
	let filter;
	if (user?.username && name === `users/${user.username}`) {
		filter = `creator == ${JSON.stringify(name)}`;
	} else if (/^users\/\d+$/.test(name)) {
		filter = `creator_id == ${name.slice('users/'.length)}`;
	} else {
		throw new Error('Memos 0.26 or later is required');
	}
	const entry = { api, filter, expiresAt: Date.now() + USER_CACHE_TTL_MS };
	userCache.set(cacheKey, entry);
	return entry;
}

async function getMemo(base, config, fetch, uid) {
	const { api } = await userOf(base, config, fetch);
	const res = await fetch(`${base}${api}/memos/${encodeURIComponent(uid)}`, { method: 'GET', headers: authHeaders(config) });
	if (!res.ok) throw new Error(res.status === 404 ? 'This memo is gone from Memos' : `Memos answered ${res.status}`);
	return await res.json();
}

// The content without a first-line heading that is the title, and without a
// last line of only tags, which show as chips.
function bodyOf(content, title) {
	const lines = content.replace(/\s+$/, '').split('\n');
	const first = /^#{1,6}\s+(.*)$/.exec(lines[0] || '');
	if (first && first[1].replace(/\*\*|__|~~|`/g, '').trim().slice(0, 100) === title) lines.shift();
	if (lines.length && /^\s*(#[^\s#]+\s*)+$/.test(lines[lines.length - 1])) lines.pop();
	return lines.join('\n').trim();
}

// The memo's H1 if it has one, else the first line of its Markdown without
// list, quote or heading markers and bold, strikethrough or code marks; the
// rest of the snippet goes under it. The snippet is plain text on one line, so
// it can't be split on its own.
function splitSnippet(memo) {
	const snippet = (memo.snippet || '').replace(/\s+/g, ' ').trim();
	const firstLine = (memo.content || '').trim().split('\n')[0];
	const title = (memo.property?.title || firstLine.replace(/^(#+|>|[-*+]( \[[ xX]\])?|\d+\.)\s+/, ''))
		.replace(/\*\*|__|~~|`/g, '')
		.trim()
		.slice(0, 100);
	// A title cut mid-sentence leaves its separator on the rest (", old one…").
	// A snippet cut inside the title is all title: nothing is left to show.
	const cut = snippet.replace(/\s*(\.\.\.|…)$/, '');
	const rest = snippet.startsWith(title)
		? snippet.slice(title.length).replace(/^[\s,.:;!?–—-]+/, '')
		: title.startsWith(cut) ? '' : snippet;
	return { title: title || 'Untitled', rest };
}

function formatDate(iso) {
	const d = iso ? new Date(iso) : null;
	if (!d || Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

function stripTrailingSlash(url) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

function authHeaders(config) {
	return {
		Authorization: `Bearer ${config.apiKey}`,
		accept: 'application/json'
	};
}

export default adapter;
