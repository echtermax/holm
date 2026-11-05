// Unit tests for src/lib/server/integrations/navidrome.js: albums and
// playlists in search carry the params to play them, and `queue` turns an
// album or playlist into the corner player's tracks, in order.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import navidrome from '../../src/lib/server/integrations/navidrome.js';

const config = { url: 'https://music.example.com/', username: 'sam', salt: 's', token: 't' };
const ok = (body) => new Response(JSON.stringify({ 'subsonic-response': { status: 'ok', ...body } }), { headers: { 'content-type': 'application/json' } });

const song = (id, title) => ({ id, title, artist: 'The Lanterns', duration: 190, coverArt: `al-${id}` });

const replies = {
	search3: { searchResult3: { album: [{ id: 'al1', name: 'Night Songs', artist: 'The Lanterns', coverArt: 'al-1' }], song: [song('s9', 'Night Drive')] } },
	getPlaylists: { playlists: { playlist: [
		{ id: 'pl1', name: 'Night mix', songCount: 42, coverArt: 'pl-1' },
		{ id: 'pl2', name: 'Morning', songCount: 3 },
		{ id: 'pl3', name: 'One night', songCount: 1 }
	] } },
	getAlbum: { album: { song: [song('s1', 'One'), song('s2', 'Two')] } },
	getPlaylist: { playlist: { entry: [song('s5', 'Five'), song('bad id', 'Skipped'), song('s3', 'Three')] } }
};

function fakeFetch(failing = []) {
	const calls = [];
	const fetch = async (url) => {
		const method = new URL(url).pathname.split('/').pop();
		calls.push(method);
		if (failing.includes(method)) return new Response('nope', { status: 500 });
		return ok(replies[method]);
	};
	return { fetch, calls };
}

const search = (query, fetch) => navidrome.searchProviders.music.query({ config, query, limit: 10, fetch });

test('albums and matching playlists can be played; songs keep their track', async () => {
	const { fetch } = fakeFetch();
	const { results } = await search('night', fetch);
	assert.deepEqual(results.map((r) => [r.title, r.subtitle, r.meta.queue || null, !!r.meta.track]), [
		['Night Songs', 'Album · The Lanterns', { type: 'album', id: 'al1' }, false],
		['Night mix', 'Playlist · 42 songs', { type: 'playlist', id: 'pl1' }, false],
		['One night', 'Playlist · 1 song', { type: 'playlist', id: 'pl3' }, false],
		['Night Drive', 'Song · The Lanterns', null, true]
	]);
	assert.equal(results[1].href, 'https://music.example.com/app/#/playlist/pl1/show');
	assert.equal(results[3].meta.track.stream, '/api/integrations/navidrome/proxy/stream/s9');
});

test("a playlist lookup that fails doesn't sink the search", async () => {
	const { fetch } = fakeFetch(['getPlaylists']);
	const { results } = await search('night', fetch);
	assert.deepEqual(results.map((r) => r.title), ['Night Songs', 'Night Drive']);
});

test('an album queues its tracks in order', async () => {
	const { fetch, calls } = fakeFetch();
	const tracks = await navidrome.queue({ config, params: { type: 'album', id: 'al1' }, fetch });
	assert.deepEqual(calls, ['getAlbum']);
	assert.deepEqual(tracks.map((t) => t.title), ['One', 'Two']);
	assert.deepEqual(tracks[0], {
		title: 'One',
		artist: 'The Lanterns',
		duration: 190,
		stream: '/api/integrations/navidrome/proxy/stream/s1',
		cover: '/api/integrations/navidrome/proxy/cover/al-s1'
	});
});

test('a playlist queues its entries, skipping any without a usable id', async () => {
	const { fetch, calls } = fakeFetch();
	const tracks = await navidrome.queue({ config, params: { type: 'playlist', id: 'pl1' }, fetch });
	assert.deepEqual(calls, ['getPlaylist']);
	assert.deepEqual(tracks.map((t) => t.title), ['Five', 'Three']);
});

test('queue params from the browser are checked before any request', async () => {
	const { fetch, calls } = fakeFetch();
	for (const params of [{}, { type: 'artist', id: 'ar1' }, { type: 'album', id: '../x' }, { type: 'playlist', id: 7 }]) {
		assert.equal(await navidrome.queue({ config, params, fetch }), null);
	}
	assert.deepEqual(calls, []);
});
