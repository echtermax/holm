// Unit tests for the corner player's queue: an album or playlist plays in
// turn, and Shuffle reorders only what comes after the current track.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { nowPlaying, queue, shuffleAfter, playTrack, playQueue, playAt } from '../src/lib/stores/player.js';

const tracks = ['a', 'b', 'c', 'd', 'e'].map((title) => ({ title, stream: `/s/${title}` }));

test('Shuffle keeps the tracks so far and reorders every one after', () => {
	// random() = 0 always swaps with the first of the rest.
	const shuffled = shuffleAfter({ type: 'playlist', tracks, index: 1 }, () => 0);
	assert.deepEqual(shuffled.tracks.map((t) => t.title), ['a', 'b', 'd', 'e', 'c']);
	assert.equal(shuffled.index, 1);
	assert.deepEqual(tracks.map((t) => t.title), ['a', 'b', 'c', 'd', 'e']);
});

test('a shuffle holds the same tracks', () => {
	const shuffled = shuffleAfter({ type: 'playlist', tracks, index: 0 });
	assert.deepEqual(shuffled.tracks.map((t) => t.title).sort(), ['a', 'b', 'c', 'd', 'e']);
	assert.equal(shuffled.tracks[0].title, 'a');
});

test('a queue starts at its first track and moves through to the last', () => {
	playQueue('album', tracks);
	assert.equal(get(nowPlaying).title, 'a');
	assert.equal(playAt(get(queue), 4), true);
	assert.equal(get(nowPlaying).title, 'e');
	assert.equal(get(queue).index, 4);
	assert.equal(playAt(get(queue), 5), false);
	assert.equal(get(nowPlaying).title, 'e');
});

test('a single song drops the queue', () => {
	playQueue('playlist', tracks);
	playTrack(tracks[2]);
	assert.equal(get(queue), null);
	assert.equal(get(nowPlaying).title, 'c');
	assert.notEqual(get(nowPlaying), tracks[2]);
});
