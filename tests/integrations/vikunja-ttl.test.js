// Unit tests for the per-token cache in src/lib/server/integrations/vikunja.js:
// `integrations.vikunja.cache_ttl` (seconds) governs how often /user and
// /projects are asked while the launcher fires on every keystroke.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// One second: long enough for the first two queries to share one window,
// short enough to expire inside this test.
const dir = mkdtempSync(join(tmpdir(), 'vikunja-ttl-'));
writeFileSync(join(dir, 'config.yml'), 'apps: []\nintegrations:\n  vikunja:\n    cache_ttl: 1\n', 'utf8');
process.env.CONFIG_PATH = join(dir, 'config.yml');

const vikunja = (await import('../../src/lib/server/integrations/vikunja.js')).default;

function fakeVikunja({ user, projects }) {
	const calls = [];
	const fetch = async (url) => {
		const u = new URL(url);
		calls.push(u.pathname);
		const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
		if (u.pathname === '/api/v1/user') return json(user);
		if (u.pathname === '/api/v1/projects') return json(projects);
		return new Response('[]', { headers: { 'content-type': 'application/json' } });
	};
	return { fetch, calls };
}

const config = { url: 'https://vk.example.com', token: 'ttl-token' };

test('the cache answers the keystrokes once per ttl, then refreshes', async () => {
	const v = fakeVikunja({
		user: { username: 'demo', settings: { default_project_id: 1 } },
		projects: [{ id: 1, title: 'Inbox' }]
	});
	const tasks = vikunja.searchProviders.tasks;

	await tasks.query({ config, query: 'one', limit: 10, fetch: v.fetch });
	assert.equal(v.calls.filter((p) => p === '/api/v1/user').length, 1);
	assert.equal(v.calls.filter((p) => p === '/api/v1/projects').length, 1);

	// Inside the window the cached user and project names serve the search:
	// only the task query goes out.
	await tasks.query({ config, query: 'two', limit: 10, fetch: v.fetch });
	assert.equal(v.calls.filter((p) => p === '/api/v1/user').length, 1);
	assert.equal(v.calls.filter((p) => p === '/api/v1/projects').length, 1);

	// After the ttl, both are asked again — a renamed project or a moved
	// default project catches up now, at the latest.
	await sleep(1500);
	await tasks.query({ config, query: 'three', limit: 10, fetch: v.fetch });
	assert.equal(v.calls.filter((p) => p === '/api/v1/user').length, 2);
	assert.equal(v.calls.filter((p) => p === '/api/v1/projects').length, 2);
});
