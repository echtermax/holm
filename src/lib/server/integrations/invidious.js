// Invidious integration adapter.
//
// Surfaces:
//   - searchProviders.videos — YouTube videos, through an Invidious instance
//
// Shared: the operator sets the instance in config.yml (`default_url`) and
// every user searches it, with nothing to connect. Search needs no account,
// so Holm sends no credentials. Thumbnails go through Holm's proxy, so the
// browser only ever talks to Holm.
//
// Videos open on the instance, or on `open_url` when the operator sets one
// (e.g. https://www.youtube.com): search through Invidious, watch elsewhere.
//
// `region` (a two-letter country code, e.g. GB) picks the country YouTube
// answers for. `language` (e.g. en) picks the language of the view counts and
// dates, which the instance otherwise writes in its own default locale.

// Tiles render 208 CSS px wide; the 320x180 "mqdefault" frame is 16:9 and
// sharp enough at that size.
const THUMB = 'mqdefault.jpg';

// YouTube video ids: 11 chars of base64url.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'invidious',
	name: 'Invidious',
	icon: 'di:invidious',
	shortcut: 'yt',
	description: 'YouTube front end — search videos',
	shared: true,

	configSchema: [
		{ key: 'url', type: 'url', label: 'Invidious URL', required: true, fromOperatorDefault: 'default_url' },
		{ key: 'openUrl', type: 'url', label: 'Open videos on', fromOperatorDefault: 'open_url' },
		{ key: 'region', type: 'text', label: 'Region', fromOperatorDefault: 'region' },
		{ key: 'language', type: 'text', label: 'Language', fromOperatorDefault: 'language' }
	],

	async test({ config, fetch }) {
		const base = baseUrl(config?.url);
		if (!base) return { ok: false, message: 'Set integrations.invidious.default_url in config.yml' };
		try {
			await search(base, 'test', fetch, config);
			return { ok: true, message: 'Connected' };
		} catch {
			return { ok: false, message: unreachable(base) };
		}
	},

	searchProviders: {
		videos: {
			label: 'YouTube',
			mode: 'inline',
			kind: 'video',
			layout: 'video',
			failMessage: (config) => unreachable(baseUrl(config?.url) || 'the Invidious server'),
			async query({ config, query, limit, fetch }) {
				const base = baseUrl(config?.url);
				const trimmed = (query || '').trim();
				if (!base || !trimmed) return { results: [] };

				const videos = await search(base, trimmed, fetch, config);
				const open = baseUrl(config.openUrl) || base;
				return {
					results: videos
						.filter((v) => v?.type === 'video' && VIDEO_ID.test(v.videoId || ''))
						.slice(0, Math.min(limit || 10, 25))
						.map((v) => ({
							id: v.videoId,
							title: v.title || 'Untitled',
							subtitle: v.author || '',
							thumbnail: `/api/integrations/invidious/proxy/thumb/${v.videoId}`,
							href: `${open}/watch?v=${v.videoId}`,
							meta: {
								kind: 'video',
								duration: v.liveNow ? 'LIVE' : formatLength(v.lengthSeconds),
								info: [v.viewCountText, v.publishedText].filter(Boolean).join(' · ')
							}
						})),
					more: moreUrl(open, trimmed)
				};
			}
		}
	},

	proxy: {
		thumb: {
			defaultCacheControl: 'private, max-age=86400',
			async fetch({ config, params, fetch }) {
				const base = baseUrl(config?.url);
				const id = params.path?.[0];
				if (!base || !id || !VIDEO_ID.test(id)) {
					return new Response('Invalid video id', { status: 400 });
				}
				return fetch(`${base}/vi/${id}/${THUMB}`, { method: 'GET' });
			}
		}
	},

	widgets: {}
};

// An operator URL, without a trailing slash; null unless it is http(s).
function baseUrl(value) {
	try {
		const url = new URL(value || '');
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
		return url.href.replace(/\/+$/, '');
	} catch {
		return null;
	}
}

// Public instances often answer with a bot check page instead of JSON, so
// anything but a JSON array counts as down.
async function search(base, q, fetch, { region, language } = {}) {
	const params = new URLSearchParams({ q, type: 'video' });
	if (/^[A-Za-z]{2}$/.test(region || '')) params.set('region', region.toUpperCase());
	if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,4})?$/.test(language || '')) params.set('hl', language);
	const res = await fetch(`${base}/api/v1/search?${params}`, {
		method: 'GET',
		headers: { accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`Invidious search failed: ${res.status}`);
	const data = await res.json();
	if (!Array.isArray(data)) throw new Error('Invidious sent an unexpected reply');
	return data;
}

// The full results page for the query: YouTube calls it /results, Invidious
// /search. Both take /watch?v= for a video.
function moreUrl(open, q) {
	const host = new URL(open).hostname;
	return host === 'youtube.com' || host.endsWith('.youtube.com')
		? `${open}/results?${new URLSearchParams({ search_query: q })}`
		: `${open}/search?${new URLSearchParams({ q })}`;
}

function unreachable(base) {
	let host = base;
	try {
		host = new URL(base).host;
	} catch {
		/* not a URL: name it as given */
	}
	return `Couldn’t reach ${host}. Public servers go down often; try again in a minute.`;
}

// 152 → "2:32", 3725 → "1:02:05"
function formatLength(seconds) {
	const s = Math.floor(Number(seconds));
	if (!Number.isFinite(s) || s <= 0) return '';
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, '0');
	return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export default adapter;
