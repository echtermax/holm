// Unit tests for src/lib/server/integrations/memos.js: the API path follows
// the server's release, a memo opens in full, and ticking a box saves only
// that line, never onto one that moved.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import memos from '../../src/lib/server/integrations/memos.js';

const content = '# Errands\n- [ ] milk\n- [x] eggs\n\n#todo';
const memo = {
	name: 'memos/abc123',
	content,
	snippet: 'Errands milk eggs #todo',
	tags: ['todo'],
	pinned: true,
	createTime: '2026-09-03T12:00:00Z',
	updateTime: '2026-11-05T12:00:00Z'
};

// A fake Memos on `api` (/api from 26.10, /api/v1 before); other paths 404.
// Each test passes its own token: users are cached per URL and token.
function fakeMemos(api, { stored = { ...memo }, patchStatus = 200 } = {}) {
	const calls = [];
	const fetch = async (url, init = {}) => {
		const u = new URL(url);
		calls.push({ method: init.method || 'GET', path: u.pathname, search: u.search, body: init.body });
		const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		if (!u.pathname.startsWith(`${api}/`)) return new Response('', { status: 404 });
		const path = u.pathname.slice(api.length);
		if (path === '/auth/me') return json({ user: { name: 'users/ana', username: 'ana' } });
		if (path === '/memos') return json({ memos: [stored] });
		if (path === '/memos/abc123' && init.method === 'PATCH') {
			if (patchStatus !== 200) return new Response('', { status: patchStatus });
			stored.content = JSON.parse(init.body).content;
			return json(stored);
		}
		if (path === '/memos/abc123') return json(stored);
		return new Response('', { status: 404 });
	};
	return { fetch, calls, stored };
}

const config = (apiKey) => ({ url: 'https://memos.example.com/', apiKey });

test('26.10+ is reached on /api, older servers on /api/v1', async () => {
	const now = fakeMemos('/api');
	assert.deepEqual(await memos.test({ config: config('t-new'), fetch: now.fetch }), { ok: true, message: 'Connected as ana' });
	assert.deepEqual(now.calls.map((c) => c.path), ['/api/auth/me']);

	const old = fakeMemos('/api/v1');
	assert.deepEqual(await memos.test({ config: config('t-old'), fetch: old.fetch }), { ok: true, message: 'Connected as ana' });
	assert.deepEqual(old.calls.map((c) => c.path), ['/api/auth/me', '/api/v1/auth/me']);

	await memos.searchProviders.memos.query({ config: config('t-old'), query: 'milk', limit: 10, fetch: old.fetch });
	assert.equal(old.calls.at(-1).path, '/api/v1/memos');
});

test('results open in Memos, show details and carry checklist progress', async () => {
	const { fetch } = fakeMemos('/api');
	const { results } = await memos.searchProviders.memos.query({ config: config('t-search'), query: 'milk', limit: 10, fetch });
	assert.equal(results.length, 1);
	assert.equal(results[0].title, 'Errands');
	assert.equal(results[0].href, 'https://memos.example.com/memos/abc123');
	assert.equal(results[0].openLabel, 'Open in Memos');
	assert.deepEqual(results[0].detail, { uid: 'abc123' });
	assert.deepEqual(results[0].meta.progress, { done: 1, total: 2 });
});

test('details: the body without the title heading or the tag line', async () => {
	const { fetch } = fakeMemos('/api');
	const d = await memos.details({ config: config('t-details'), params: { uid: 'abc123' }, fetch });
	assert.equal(d.title, 'Errands');
	assert.deepEqual(d.facts, ['Memos', 'Created Sep 3, 2026', 'Edited Nov 5, 2026', '1 of 2 done']);
	assert.equal(d.pinned, true);
	assert.deepEqual(d.genres, ['todo']);
	assert.equal(d.markdown, '- [ ] milk\n- [x] eggs');
	assert.deepEqual(d.checklist, { key: 'check', params: { uid: 'abc123' } });

	assert.equal(await memos.details({ config: config('t-details'), params: { uid: '../x' }, fetch }), null);
});

test('check saves only that line, with updateMask=content', async () => {
	const { fetch, calls, stored } = fakeMemos('/api');
	const res = await memos.actions.check.run({ config: config('t-check'), params: { uid: 'abc123', index: 0, checked: true, text: 'milk' }, fetch });
	assert.deepEqual(res, { ok: true, message: 'Saved' });
	const patch = calls.find((c) => c.method === 'PATCH');
	assert.equal(patch.path, '/api/memos/abc123');
	assert.equal(patch.search, '?updateMask=content');
	assert.equal(stored.content, '# Errands\n- [x] milk\n- [x] eggs\n\n#todo');
});

test('check refuses a line that moved, bad params, and passes on a refusal', async () => {
	const { fetch, calls } = fakeMemos('/api');
	const run = (params) => memos.actions.check.run({ config: config('t-refuse'), params, fetch });

	assert.deepEqual(await run({ uid: 'abc123', index: 0, checked: true, text: 'eggs' }), {
		ok: false,
		message: 'This memo changed in Memos. Go back and open it again.'
	});
	assert.equal((await run({ uid: 'abc123', index: '0', checked: true, text: 'milk' })).message, 'Invalid checklist item');
	assert.equal((await run({ uid: 'a/b', index: 0, checked: true, text: 'milk' })).message, 'Invalid checklist item');
	// Already as asked: nothing to save.
	assert.deepEqual(await run({ uid: 'abc123', index: 1, checked: true, text: 'eggs' }), { ok: true, message: 'Saved' });
	assert.ok(!calls.some((c) => c.method === 'PATCH'));

	const locked = fakeMemos('/api', { patchStatus: 403 });
	const res = await memos.actions.check.run({ config: config('t-locked'), params: { uid: 'abc123', index: 0, checked: true, text: 'milk' }, fetch: locked.fetch });
	assert.deepEqual(res, { ok: false, message: 'Memos refused the change. Check the access token.' });
});

test('a title cut short in the snippet leaves nothing under it', async () => {
	const long = { ...memo, content: 'A very long first line that the snippet cuts', snippet: 'A very long first line…' };
	const { fetch } = fakeMemos('/api', { stored: long });
	const { results } = await memos.searchProviders.memos.query({ config: config('t-snip'), query: 'long', limit: 10, fetch });
	assert.equal(results[0].subtitle, 'Sep 3, 2026');
});

test('check: Memos out of reach reads as a connection error', async () => {
	const down = async () => {
		throw new TypeError('fetch failed');
	};
	const res = await memos.actions.check.run({ config: config('t-down'), params: { uid: 'abc123', index: 0, checked: true, text: 'milk' }, fetch: down });
	assert.deepEqual(res, { ok: false, message: 'Can’t reach Memos. Check the connection.' });

	const slow = async () => {
		throw new DOMException('timed out', 'TimeoutError');
	};
	const late = await memos.actions.check.run({ config: config('t-slow'), params: { uid: 'abc123', index: 0, checked: true, text: 'milk' }, fetch: slow });
	assert.equal(late.message, 'Can’t reach Memos. Check the connection.');
});
