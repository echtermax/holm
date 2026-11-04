// Unit tests for src/lib/server/integrations/invidious.js: videos map to
// 16:9 tiles that open on the instance, a bot-check page counts as down, and
// the thumbnail proxy only fetches video ids.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import invidious from '../../src/lib/server/integrations/invidious.js';

const config = { url: 'https://inv.example.com/' };
const videos = [
	{
		type: 'video',
		title: 'Interstellar trailer',
		videoId: '2LqzF5WauAw',
		author: 'Interstellar Movie',
		lengthSeconds: 152,
		viewCountText: '9.2M views',
		publishedText: '12 years ago',
		liveNow: false
	},
	{ type: 'video', title: 'Long talk', videoId: 'abcdefghijk', author: 'Talks', lengthSeconds: 3725, liveNow: false },
	{ type: 'video', title: 'Live now', videoId: 'LIVEstream1', author: 'Stream', lengthSeconds: 0, liveNow: true },
	{ type: 'video', title: 'Bad id', videoId: 'x/../y', author: 'Nope' },
	{ type: 'channel', author: 'A channel' }
];

function fakeFetch(body, init = { headers: { 'content-type': 'application/json' } }) {
	const calls = [];
	const fetch = async (url) => {
		calls.push(url);
		return new Response(typeof body === 'string' ? body : JSON.stringify(body), init);
	};
	return { fetch, calls };
}

const search = (fetch, query = 'interstellar') =>
	invidious.searchProviders.videos.query({ config, query, limit: 24, fetch });

test('videos map to tiles that open on the instance', async () => {
	const { fetch, calls } = fakeFetch(videos);
	const { results, more } = await search(fetch);

	const sent = new URL(calls[0]);
	assert.equal(sent.origin + sent.pathname, 'https://inv.example.com/api/v1/search');
	assert.equal(sent.searchParams.get('q'), 'interstellar');
	assert.equal(sent.searchParams.get('type'), 'video');

	assert.deepEqual(results.map((r) => [r.id, r.subtitle, r.href, r.thumbnail, r.meta.duration, r.meta.info]), [
		['2LqzF5WauAw', 'Interstellar Movie', 'https://inv.example.com/watch?v=2LqzF5WauAw', '/api/integrations/invidious/proxy/thumb/2LqzF5WauAw', '2:32', '9.2M views · 12 years ago'],
		['abcdefghijk', 'Talks', 'https://inv.example.com/watch?v=abcdefghijk', '/api/integrations/invidious/proxy/thumb/abcdefghijk', '1:02:05', ''],
		['LIVEstream1', 'Stream', 'https://inv.example.com/watch?v=LIVEstream1', '/api/integrations/invidious/proxy/thumb/LIVEstream1', 'LIVE', '']
	]);
	assert.ok(results.every((r) => r.meta.kind === 'video'));
	assert.equal(more, 'https://inv.example.com/search?q=interstellar');
});

test('open_url sends videos and "More" elsewhere, search still goes to the instance', async () => {
	const { fetch, calls } = fakeFetch(videos);
	const { results, more } = await invidious.searchProviders.videos.query({
		config: { ...config, openUrl: 'https://www.youtube.com/' }, query: 'interstellar', limit: 24, fetch
	});
	assert.ok(calls[0].startsWith('https://inv.example.com/api/v1/search?'));
	assert.equal(results[0].href, 'https://www.youtube.com/watch?v=2LqzF5WauAw');
	assert.equal(results[0].thumbnail, '/api/integrations/invidious/proxy/thumb/2LqzF5WauAw');
	assert.equal(more, 'https://www.youtube.com/results?search_query=interstellar');

	const other = await invidious.searchProviders.videos.query({ config: { ...config, openUrl: 'https://watch.example.org' }, query: 'interstellar', limit: 24, fetch });
	assert.equal(other.results[0].href, 'https://watch.example.org/watch?v=2LqzF5WauAw');
	assert.equal(other.more, 'https://watch.example.org/search?q=interstellar');

	const bad = await invidious.searchProviders.videos.query({ config: { ...config, openUrl: 'javascript:alert(1)' }, query: 'interstellar', limit: 24, fetch });
	assert.equal(bad.results[0].href, 'https://inv.example.com/watch?v=2LqzF5WauAw');
});

test('a bot-check page or an error status counts as down', async () => {
	const html = fakeFetch('<!doctype html><title>Verifying your browser…</title>', { headers: { 'content-type': 'text/html' } });
	await assert.rejects(search(html.fetch));
	const down = fakeFetch({ error: 'nope' }, { status: 503 });
	await assert.rejects(search(down.fetch));
	assert.equal(
		invidious.searchProviders.videos.failMessage(config),
		'Couldn’t reach inv.example.com. Public servers go down often; try again in a minute.'
	);
});

test('an empty query or a non-http URL asks nothing', async () => {
	const { fetch, calls } = fakeFetch(videos);
	assert.deepEqual(await search(fetch, '  '), { results: [] });
	const res = await invidious.searchProviders.videos.query({ config: { url: 'javascript:alert(1)' }, query: 'x', limit: 5, fetch });
	assert.deepEqual(res, { results: [] });
	assert.equal(calls.length, 0);
});

test('the thumbnail proxy fetches only video ids, from /vi/', async () => {
	const { fetch, calls } = fakeFetch('jpg', { headers: { 'content-type': 'image/jpeg' } });
	const thumb = (id) => invidious.proxy.thumb.fetch({ config, params: { path: [id] }, request: new Request('http://holm/x'), fetch });

	await thumb('2LqzF5WauAw');
	assert.deepEqual(calls, ['https://inv.example.com/vi/2LqzF5WauAw/mqdefault.jpg']);

	for (const bad of ['..', 'short', 'abc%2F..%2Fx']) {
		const res = await thumb(bad);
		assert.equal(res.status, 400);
	}
	assert.equal(calls.length, 1);
});
