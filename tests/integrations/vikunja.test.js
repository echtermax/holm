// Unit tests for src/lib/server/integrations/vikunja.js: the quickadd row
// files the typed text into the user's Inbox the way Vikunja's own quick-add
// does (default project, else a project titled Inbox), and a task opens with
// its facts. Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The adapter reads `integrations.vikunja` (the cache ttl) from config.yml,
// which CONFIG_PATH points at: here a fixture with no cache_ttl, so the
// default window of 5 minutes governs. Each test passes its own token: users
// are cached per URL and token either way.
const dir = mkdtempSync(join(tmpdir(), 'vikunja-'));
writeFileSync(join(dir, 'config.yml'), 'apps: []\n', 'utf8');
process.env.CONFIG_PATH = join(dir, 'config.yml');

const vikunja = (await import('../../src/lib/server/integrations/vikunja.js')).default;

const ZERO = '0001-01-01T00:00:00Z';
const today = new Date();
const day = (offset) => new Date(today.getTime() + offset * 24 * 60 * 60 * 1000).toISOString();
const iso = (y, m, d) => new Date(Date.UTC(y, m - 1, d, 12)).toISOString();

// A fake Vikunja. Each test passes its own token: users are cached per URL
// and token, so nothing leaks between tests.
function fakeVikunja({
	user = { username: 'demo', settings: { default_project_id: 1 } },
	projects = [{ id: 1, title: 'Inbox' }, { id: 4, title: 'Work' }],
	tasks = [],
	task = null,
	create = null // status the PUT answers with, or a body when all is well
} = {}) {
	const calls = [];
	const created = { id: 99, title: '', project_id: 1 };
	const fetch = async (url, init = {}) => {
		const u = new URL(url);
		calls.push({ method: init.method || 'GET', path: u.pathname, params: u.searchParams, body: init.body });
		const json = (body, status = 200) =>
			new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
		if (u.pathname === '/api/v1/user') return json(user);
		if (u.pathname === '/api/v1/projects') return json(projects);
		if (u.pathname === '/api/v1/tasks') return json(tasks);
		const detail = /^\/api\/v1\/tasks\/(\d+)$/.exec(u.pathname);
		if (detail) return task && task.id === Number(detail[1]) ? json(task) : new Response('', { status: 404 });
		const put = /^\/api\/v1\/projects\/(\d+)\/tasks$/.exec(u.pathname);
		if (put) {
			created.project_id = Number(put[1]);
			created.title = JSON.parse(init.body).title;
			if (typeof create === 'number') return json({}, create);
			return json({ ...created, ...create });
		}
		return new Response('', { status: 404 });
	};
	return { fetch, calls, created };
}

const url = 'https://vikunja.example.com/';
const config = (token) => ({ url, token });

test('test() checks the token against /user', async () => {
	const v = fakeVikunja();
	assert.deepEqual(await vikunja.test({ config: {}, fetch: v.fetch }), { ok: false, message: 'URL and API token are required' });

	const reject = async () => new Response('', { status: 401 });
	assert.deepEqual(
		await vikunja.test({ config: config('t-auth'), fetch: reject }),
		{ ok: false, message: 'API token rejected — check that it is valid and not expired' }
	);

	assert.deepEqual(await vikunja.test({ config: config('t-auth2'), fetch: v.fetch }), { ok: true, message: 'Connected as demo' });
	assert.deepEqual(v.calls.map((c) => c.path), ['/api/v1/user']);
});

test('quickadd answers only under the scope and cleans the typed text', async () => {
	const { quickadd, tasks } = vikunja.searchProviders;
	assert.equal(quickadd.scoped, true);
	assert.ok(!tasks.scoped);

	assert.deepEqual(await quickadd.query({ query: '   ' }), { results: [] });
	const res = await quickadd.query({ query: '  Milch\nkaufen\tund  putzen  ' });
	const row = res.results[0];
	assert.equal(row.title, 'Milch kaufen und putzen');
	assert.equal(row.subtitle, 'New task in your Inbox');
	assert.equal(row.meta.kind, 'card');
	assert.deepEqual(row.action, { key: 'create', label: 'Add to Inbox', params: { title: 'Milch kaufen und putzen' } });
	assert.ok(!row.href && !row.detail);

	// Longer than a title can be, with control characters gone.
	const long = await quickadd.query({ query: 'x'.repeat(300) + '\u0007' });
	assert.equal(long.results[0].title, 'x'.repeat(250));
});

test('tasks search: params, open before done, project and due on the row', async () => {
	const v = fakeVikunja({
		tasks: [
			{ id: 7, title: 'Done one', done: true, done_at: iso(2026, 11, 3), project_id: 4, due_date: ZERO, priority: 0 },
			{ id: 5, title: 'Open one', done: false, project_id: 2, due_date: day(0), priority: 3 },
			{ id: 6, title: 'Open two', done: false, project_id: 1, due_date: day(2), priority: 0 }
		],
		projects: [{ id: 1, title: 'Inbox' }, { id: 2, title: 'Sparen' }, { id: 4, title: 'Work' }]
	});
	await vikunja.searchProviders.tasks.query({ config: config('t-search'), query: ' x ', limit: 24, fetch: v.fetch });
	assert.equal(v.calls[0].path, '/api/v1/tasks');
	assert.equal(v.calls[0].params.get('s'), 'x');
	assert.equal(v.calls[0].params.get('sort_by'), 'relevance');
	assert.equal(v.calls[0].params.get('order_by'), 'desc');
	assert.equal(v.calls[0].params.get('per_page'), '24');

	const res = await vikunja.searchProviders.tasks.query({ config: config('t-search'), query: 'x', limit: 24, fetch: v.fetch });
	assert.deepEqual(res.results.map((r) => r.id), ['5', '6', '7']);
	const open = res.results[0];
	assert.equal(open.href, 'https://vikunja.example.com/tasks/5');
	assert.deepEqual(open.detail, { id: '5' });
	assert.equal(open.meta.status, '');
	assert.equal(open.subtitle.includes('Sparen'), true);
	assert.equal(open.subtitle.includes('due today'), true);
	assert.equal(open.subtitle.includes('High'), true);
	assert.equal(res.results[2].meta.status, 'Done');
	assert.equal(res.results[2].subtitle, 'Work');

	assert.deepEqual(await vikunja.searchProviders.tasks.query({ config: config('t-search'), query: ' ', limit: 24, fetch: v.fetch }), { results: [] });
});

test('a late due date says so, and empty projects cost nothing', async () => {
	const v = fakeVikunja({
		tasks: [{ id: 3, title: 'Late', done: false, project_id: 9, due_date: day(-2), priority: 0 }],
		projects: []
	});
	const res = await vikunja.searchProviders.tasks.query({ config: config('t-late'), query: 'late', limit: 10, fetch: v.fetch });
	assert.equal(res.results[0].subtitle, '2 days late');
});

test('create files the task in the default project, as Vikunja itself does', async () => {
	const v = fakeVikunja();
	const res = await vikunja.actions.create.run({ config: config('t-create'), params: { title: 'Milch kaufen' }, fetch: v.fetch });
	assert.deepEqual(res, { ok: true, message: 'Added to Inbox' });
	const put = v.calls.find((c) => c.method === 'PUT');
	assert.equal(put.path, '/api/v1/projects/1/tasks');
	assert.equal(JSON.parse(put.body).title, 'Milch kaufen');
});

test('a renamed default project is told honestly', async () => {
	const v = fakeVikunja({
		user: { username: 'demo', settings: { default_project_id: 4 } },
		projects: [{ id: 1, title: 'Inbox' }, { id: 4, title: 'Work' }]
	});
	const res = await vikunja.actions.create.run({ config: config('t-renamed'), params: { title: 'x' }, fetch: v.fetch });
	assert.deepEqual(res, { ok: true, message: 'Added to Work' });
	assert.equal(v.calls.find((c) => c.method === 'PUT').path, '/api/v1/projects/4/tasks');
});

test('without the setting, a project titled Inbox — in any case — is the target', async () => {
	const v = fakeVikunja({
		user: { username: 'demo', settings: {} },
		projects: [{ id: 2, title: 'Sparen' }, { id: 3, title: 'INBOX' }, { id: 7, title: 'inbox ' }]
	});
	const res = await vikunja.actions.create.run({ config: config('t-titled'), params: { title: 'x' }, fetch: v.fetch });
	assert.deepEqual(res, { ok: true, message: 'Added to Inbox' });
	assert.equal(v.calls.find((c) => c.method === 'PUT').path, '/api/v1/projects/3/tasks');
});

test('no default and no Inbox refuses, and bad input never reaches the server', async () => {
	const v = fakeVikunja({ user: { username: 'demo', settings: {} }, projects: [{ id: 2, title: 'Sparen' }] });
	assert.deepEqual(
		await vikunja.actions.create.run({ config: config('t-none'), params: { title: 'x' }, fetch: v.fetch }),
		{ ok: false, message: 'No Inbox found — set a default project in Vikunja' }
	);
	for (const title of [undefined, null, 42, '', '   ', '\n']) {
		const other = fakeVikunja();
		const res = await vikunja.actions.create.run({ config: config('t-bad'), params: { title }, fetch: other.fetch });
		assert.equal(res.ok, false);
		assert.equal(other.calls.filter((c) => c.method === 'PUT').length, 0);
	}
});

test('a refusing server names the missing write scope, a dead one the connection', async () => {
	const refused = fakeVikunja({ create: 403 });
	const res = await vikunja.actions.create.run({ config: config('t-refuse'), params: { title: 'x' }, fetch: refused.fetch });
	assert.deepEqual(res, { ok: false, message: 'Vikunja refused the task — the token needs write access' });

	const dead = fakeVikunja();
	const down = async () => {
		throw new TypeError('fetch failed');
	};
	const err = await vikunja.actions.create.run({ config: config('t-dead'), params: { title: 'x' }, fetch: down });
	assert.deepEqual(err, { ok: false, message: 'Can’t reach Vikunja. Check the connection.' });
	assert.equal(dead.calls.length, 0);
});

test('a task opens with its facts: identifier, dates, due warning, people', async () => {
	const v = fakeVikunja({
		task: {
			id: 8,
			title: 'Renovate the shed',
			identifier: '#8',
			description: '  Paint it **green**.  ',
			done: true,
			done_at: iso(2026, 11, 3),
			created: iso(2026, 10, 1),
			updated: iso(2026, 11, 3),
			due_date: day(-3),
			priority: 4,
			percent_done: 60,
			project_id: 4,
			labels: [{ title: 'garden', hex_color: '#0f0f0f' }, { title: 'autumn', hex_color: 'not-a-color' }],
			assignees: [{ username: 'mp', name: 'Mia Pawellek' }]
		},
		projects: [{ id: 1, title: 'Inbox' }, { id: 4, title: 'Work' }]
	});
	const d = await vikunja.details({ config: config('t-detail'), params: { id: '8' }, fetch: v.fetch });
	assert.equal(v.calls[0].path, '/api/v1/tasks/8');
	assert.equal(d.title, 'Renovate the shed');
	assert.deepEqual(d.facts, ['#8', `Done ${shortDate(iso(2026, 11, 3))}`, `Created ${shortDate(iso(2026, 10, 1))}`]);
	const byField = d.fields.map((f) => [f.label, f]);
	assert.equal(byField.map((f) => f[0])[0], 'Project');
	assert.deepEqual(Object.fromEntries(byField.map(([label, f]) => [label, f])), {
		Project: { label: 'Project', value: 'Work' },
		Due: { label: 'Due', value: `${shortDate(day(-3))} · 3 days late`, warn: true },
		Priority: { label: 'Priority', value: 'Urgent', color: '#ef4444' },
		Progress: { label: 'Progress', value: '60% done' },
		Labels: { label: 'Labels', chips: [{ text: 'garden', color: '#0f0f0f' }, { text: 'autumn', color: null }] },
		Assignees: { label: 'Assignees', chips: [{ text: 'Mia Pawellek', initials: 'MP' }] }
	});
	assert.equal(d.markdown, 'Paint it **green**.');

	// A task without any of the optional bits opens without empty rows.
	const bare = fakeVikunja({
		task: { id: 2, title: 'x', description: '', done: false, created: iso(2026, 1, 2), project_id: 1 },
		projects: [{ id: 1, title: 'Inbox' }]
	});
	const d2 = await vikunja.details({ config: config('t-bare'), params: { id: '2' }, fetch: bare.fetch });
	assert.deepEqual(d2.fields.map((f) => f.label), ['Project']);
	assert.deepEqual(d2.facts, [`Created ${shortDate(iso(2026, 1, 2))}`]);
});

test('a detail request with anything but a task id reads as nothing', async () => {
	const v = fakeVikunja();
	for (const id of [undefined, null, '', 'abc', '9'.repeat(19)]) {
		assert.equal(await vikunja.details({ config: config('t-id'), params: { id }, fetch: v.fetch }), null);
	}
	assert.deepEqual(v.calls, []);
});

test('a task that is gone reports so', async () => {
	const v = fakeVikunja();
	await assert.rejects(
		() => vikunja.details({ config: config('t-gone'), params: { id: '12' }, fetch: v.fetch }),
		/This task is gone from Vikunja/
	);
});

function shortDate(iso) {
	const d = new Date(iso);
	return d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
}
