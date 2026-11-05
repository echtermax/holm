import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChangelog, compareVersions, changelogFor } from '../src/lib/changelog.js';

const md = `# Changelog

Intro text that is not a release.

## 0.7.0 — 2026-12-01

- Seven

## 0.6.0 — 2026-11-01

- Six

## v0.5.0

- Five
`;
const releases = parseChangelog(md);
const base = { version: '0.7.0', enabled: true, releases };

test('parseChangelog: releases newest first, with dates and notes', () => {
	assert.deepEqual(releases.map((r) => [r.version, r.date, r.notes]), [
		['0.7.0', '2026-12-01', '- Seven'],
		['0.6.0', '2026-11-01', '- Six'],
		['0.5.0', '', '- Five']
	]);
});

// On dev, a version raised for its alphas has no section yet: its lines wait
// under "## Unreleased" until the release PR renames it.
test('the repo CHANGELOG.md has the package version, or an Unreleased section', () => {
	const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
	const md = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
	const found = parseChangelog(md);
	assert.ok(
		found.some((r) => r.version === version) || /^## Unreleased\s*$/m.test(md),
		`CHANGELOG.md has no ## ${version} or ## Unreleased section`
	);
});

test('compareVersions: numeric, not by text', () => {
	assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
	assert.equal(compareVersions('0.5.0', '0.5.0'), 0);
	assert.equal(compareVersions('0.4.9', '0.5.0'), -1);
	assert.equal(compareVersions(null, '0.1.0'), -1);
});

test('a new user sees nothing, and the version is recorded', () => {
	assert.deepEqual(changelogFor({ ...base, seen: null, known: false }), { show: false, releases: [], record: true });
});

test('nothing new since the version last seen', () => {
	assert.equal(changelogFor({ ...base, seen: '0.7.0', known: true }).show, false);
	// Running an older version than the one seen (a rollback) shows nothing.
	assert.equal(changelogFor({ ...base, seen: '0.8.0', known: true }).show, false);
});

test('one version on: that release', () => {
	const r = changelogFor({ ...base, seen: '0.6.0', known: true });
	assert.equal(r.show, true);
	assert.deepEqual(r.releases.map((x) => x.version), ['0.7.0']);
	assert.equal(r.record, false);
});

test('skipped versions: every release since the last one seen', () => {
	assert.deepEqual(changelogFor({ ...base, seen: '0.5.0', known: true }).releases.map((x) => x.version), ['0.7.0', '0.6.0']);
});

test('releases newer than the running version are left out', () => {
	assert.deepEqual(changelogFor({ ...base, version: '0.6.0', seen: '0.5.0', known: true }).releases.map((x) => x.version), ['0.6.0']);
});

test('a user from before the dialog existed sees every release since 0.5.0', () => {
	assert.deepEqual(changelogFor({ ...base, seen: null, known: true }).releases.map((x) => x.version), ['0.7.0', '0.6.0']);
});

test('turned off by the operator: never shown', () => {
	const r = changelogFor({ ...base, enabled: false, seen: '0.5.0', known: true });
	assert.equal(r.show, false);
	// Not recorded either, so turning it back on shows what was missed.
	assert.equal(r.record, false);
});

test('a version with no notes: nothing shown, counted as seen', () => {
	assert.deepEqual(changelogFor({ ...base, version: '0.7.1', seen: '0.7.0', known: true }), { show: false, releases: [], record: true });
});
