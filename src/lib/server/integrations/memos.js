// Memos integration adapter.
//
// Surfaces:
//   - searchProviders.memos — searches the user's own memos by content
//
// Needs Memos 0.26 or later: /api/v1/auth/me and the CEL `content.contains`
// filter. 0.26 names users `users/<id>` and filters on `creator_id`; 0.27
// renamed them `users/<username>` and added the `creator` filter, so the
// filter follows whichever name the server hands back.

// The filter for "memos this user created" changes per release, and the user
// behind a token doesn't, so it is looked up once per token.
const creatorCache = new Map();

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'memos',
	name: 'Memos',
	icon: 'di:memos',
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
			const res = await fetch(`${base}/api/v1/auth/me`, {
				method: 'GET',
				headers: authHeaders(config)
			});
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
				const creator = await creatorFilter(base, config, fetch);
				// JSON string escapes are valid CEL string escapes.
				const params = new URLSearchParams({
					filter: `${creator} && content.contains(${JSON.stringify(trimmed)})`,
					pageSize: String(Math.min(limit || 10, 25))
				});
				const res = await fetch(`${base}/api/v1/memos?${params}`, {
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
							tags: memo.tags || [],
							meta: { kind: 'document' }
						};
					})
				};
			}
		}
	},

	widgets: {}
};

async function creatorFilter(base, config, fetch) {
	const cacheKey = `${config.url}:${config.apiKey}`;
	const cached = creatorCache.get(cacheKey);
	if (cached) return cached;

	const res = await fetch(`${base}/api/v1/auth/me`, {
		method: 'GET',
		headers: authHeaders(config)
	});
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
	creatorCache.set(cacheKey, filter);
	return filter;
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
	const rest = snippet.startsWith(title) ? snippet.slice(title.length).trim() : snippet;
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
