// Unit tests for src/lib/server/integrations/gitea.js and the shared shape
// of GitHub's sections: one issue search per query feeds the summary and
// both issue sections, rows carry the same status chips, and the summary is
// the best repo plus the latest issues and PRs.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import gitea from '../../src/lib/server/integrations/gitea.js';
import github from '../../src/lib/server/integrations/github.js';

const json = (body, headers = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

const giteaRepos = [
	{ id: 1, name: 'garden-notes', full_name: 'sam-rivera/garden-notes', description: 'Planting log', html_url: 'https://gitea.example.com/sam-rivera/garden-notes', private: false, archived: true },
	{ id: 2, name: 'garden', full_name: 'sam-rivera/garden', description: 'Sensors in the garden', html_url: 'https://gitea.example.com/sam-rivera/garden', private: true, stars_count: 3 }
];
const giteaIssues = [
	{ id: 10, number: 4, title: 'Garden: water the beans', state: 'open', updated_at: '2026-10-01T00:00:00Z', html_url: 'https://gitea.example.com/sam-rivera/garden/issues/4', repository: { full_name: 'sam-rivera/garden' } },
	{ id: 11, number: 5, title: 'Garden: add a rain gauge', state: 'closed', updated_at: '2026-11-01T00:00:00Z', html_url: 'https://gitea.example.com/sam-rivera/garden/pulls/5', repository: { full_name: 'sam-rivera/garden' }, pull_request: { merged: true } },
	{ id: 12, number: 6, title: 'Garden: fix the fence', state: 'closed', updated_at: '2026-09-01T00:00:00Z', html_url: 'https://gitea.example.com/sam-rivera/garden/pulls/6', repository: { full_name: 'sam-rivera/garden' }, pull_request: { merged: false } },
	{ id: 13, number: 7, title: 'Garden: compost', state: 'closed', updated_at: '2026-08-01T00:00:00Z', html_url: 'https://gitea.example.com/sam-rivera/garden/issues/7', repository: { full_name: 'sam-rivera/garden' } }
];

function fakeGitea() {
	const calls = [];
	const fetch = async (url, init = {}) => {
		const u = new URL(url);
		calls.push({ path: u.pathname, search: u.searchParams, auth: init.headers?.Authorization });
		if (u.pathname === '/api/v1/user') return json({ login: 'sam-rivera' });
		if (u.pathname === '/api/v1/repos/search') return json({ ok: true, data: giteaRepos });
		if (u.pathname === '/api/v1/repos/issues/search') return json(giteaIssues);
		return new Response('', { status: 404 });
	};
	return { fetch, calls };
}

// Each test passes its own token: issue searches are cached per token.
const config = (apiKey) => ({ url: 'https://gitea.example.com/', apiKey });

test('Gitea connects with a token sent as `token`', async () => {
	const { fetch, calls } = fakeGitea();
	assert.deepEqual(await gitea.test({ config: config('g-test'), fetch }), { ok: true, message: 'Connected as sam-rivera' });
	assert.equal(calls[0].path, '/api/v1/user');
	assert.equal(calls[0].auth, 'token g-test');
});

test('Gitea sections split issues from PRs with GitHub\'s chips, from one issue search', async () => {
	const { fetch, calls } = fakeGitea();
	const ctx = { config: config('g-sections'), query: 'garden', limit: 24, fetch };
	const [issues, pulls] = await Promise.all([gitea.searchProviders.issues.query(ctx), gitea.searchProviders.pulls.query(ctx)]);
	assert.deepEqual(issues.results.map((r) => [r.title, r.meta.status]), [['Garden: water the beans', 'Open'], ['Garden: compost', 'Closed']]);
	assert.deepEqual(pulls.results.map((r) => [r.title, r.meta.status]), [['Garden: add a rain gauge', 'Merged'], ['Garden: fix the fence', 'Closed']]);
	assert.equal(pulls.results[0].subtitle.split(' · ')[0], 'sam-rivera/garden#5');
	assert.equal(pulls.more, 'https://gitea.example.com/pulls?q=garden&state=all');
	assert.equal(calls.filter((c) => c.path === '/api/v1/repos/issues/search').length, 1);
	assert.equal(calls[0].search.get('state'), 'all');
});

test('Gitea repos put the exact name first and chip Private and Archived', async () => {
	const { fetch } = fakeGitea();
	const { results, more } = await gitea.searchProviders.repos.query({ config: config('g-repos'), query: 'garden', limit: 24, fetch });
	assert.deepEqual(results.map((r) => [r.title, r.meta.status]), [['sam-rivera/garden', 'Private'], ['sam-rivera/garden-notes', 'Archived']]);
	assert.equal(more, 'https://gitea.example.com/explore/repos?q=garden');
});

test('Gitea\'s summary is the best repo, then the 3 latest issues and PRs', async () => {
	const { fetch } = fakeGitea();
	const { results } = await gitea.searchProviders.summary.query({ config: config('g-summary'), query: 'garden', limit: 24, fetch });
	assert.deepEqual(results.map((r) => r.title), ['sam-rivera/garden', 'Garden: add a rain gauge', 'Garden: water the beans', 'Garden: fix the fence']);
	assert.equal(new Set(results.map((r) => r.id)).size, results.length);
});

test('GitHub\'s summary and both issue sections share one search request', async () => {
	const calls = [];
	const fetch = async (url) => {
		const u = new URL(url);
		calls.push(u.pathname);
		if (u.pathname === '/user') return json({ login: 'sam-rivera' });
		if (u.pathname === '/user/repos') return json([{ id: 1, name: 'garden', full_name: 'sam-rivera/garden', html_url: 'https://github.com/sam-rivera/garden', private: true }]);
		if (u.pathname === '/search/issues') {
			return json({ items: [
				{ id: 20, number: 1, title: 'Garden issue', state: 'open', updated_at: '2026-10-01T00:00:00Z', html_url: 'https://github.com/sam-rivera/garden/issues/1', repository_url: 'https://api.github.com/repos/sam-rivera/garden' },
				{ id: 21, number: 2, title: 'Garden PR', state: 'closed', updated_at: '2026-11-01T00:00:00Z', html_url: 'https://github.com/sam-rivera/garden/pull/2', repository_url: 'https://api.github.com/repos/sam-rivera/garden', pull_request: { merged_at: '2026-11-01T00:00:00Z' } }
			] }, { 'x-ratelimit-remaining': '29' });
		}
		return new Response('', { status: 404 });
	};
	const ctx = { config: { apiKey: 'gh-shared' }, query: 'garden', limit: 24, fetch };
	const [summary, issues, pulls] = await Promise.all([
		github.searchProviders.summary.query(ctx),
		github.searchProviders.issues.query(ctx),
		github.searchProviders.pulls.query(ctx)
	]);
	assert.deepEqual(summary.results.map((r) => [r.title, r.meta.status]), [['sam-rivera/garden', 'Private'], ['Garden PR', 'Merged'], ['Garden issue', 'Open']]);
	assert.deepEqual(issues.results.map((r) => r.title), ['Garden issue']);
	assert.deepEqual(pulls.results.map((r) => r.title), ['Garden PR']);
	assert.equal(calls.filter((p) => p === '/search/issues').length, 1);
});
