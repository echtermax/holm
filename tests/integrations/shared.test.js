// Unit tests for src/lib/server/integrations/shared.js: a shared integration
// (Invidious) is connected to the operator's URL for everyone, and keeps each
// user's Use for switches, on until the user turns one off.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import invidious from '../../src/lib/server/integrations/invidious.js';
import { sharedConnection } from '../../src/lib/server/integrations/shared.js';

const operator = { default_url: 'https://inv.example.com', open_url: 'https://www.youtube.com' };
const row = (surfaces) => ({ integration_id: 'invidious', config_blob: '', surfaces_json: JSON.stringify(surfaces), updated_at: 1 });

test('with nothing saved, Search provider is on', () => {
	const conn = sharedConnection(invidious, operator, null);
	assert.equal(conn.connected, true);
	assert.deepEqual(conn.surfaces, { search: true });
	assert.deepEqual(conn.config, { url: 'https://inv.example.com', openUrl: 'https://www.youtube.com' });
});

test('a saved switch is read back, so turning search off survives a reload', () => {
	assert.deepEqual(sharedConnection(invidious, operator, row({ search: false })).surfaces, { search: false });
	assert.deepEqual(sharedConnection(invidious, operator, row({ search: true })).surfaces, { search: true });
});

test('the config is always the operator\'s, never the row\'s', () => {
	const conn = sharedConnection(invidious, operator, { ...row({ search: false }), config_blob: 'ignored' });
	assert.deepEqual(conn.config, { url: 'https://inv.example.com', openUrl: 'https://www.youtube.com' });
});

test('a broken row counts as nothing saved', () => {
	assert.deepEqual(sharedConnection(invidious, operator, { surfaces_json: '{not json' }).surfaces, { search: true });
});
