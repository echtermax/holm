// Unit tests for src/lib/checklist.js: Markdown task lists are counted the
// way the rendered memo shows them, and ticking one changes only its line.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { oneAtATime, progressOf, sameTask, setTask, tasksOf } from '../src/lib/checklist.js';

const memo = [
	'# Errands',
	'- [ ] milk',
	'- [x] eggs',
	'* [X] bread',
	'1. [ ] numbered',
	'> - [ ] quoted',
	'  - [ ] nested',
	'- not a task',
	'```',
	'- [ ] inside a fence',
	'```',
	'- [ ] after the fence'
].join('\n');

test('tasks are list items with a box, outside fenced code', () => {
	assert.deepEqual(tasksOf(memo).map((t) => [t.line, t.checked, t.text]), [
		[1, false, 'milk'],
		[2, true, 'eggs'],
		[3, true, 'bread'],
		[4, false, 'numbered'],
		[5, false, 'quoted'],
		[6, false, 'nested'],
		[11, false, 'after the fence']
	]);
	assert.deepEqual(tasksOf(''), []);
	assert.deepEqual(tasksOf(null), []);
});

test('progress counts done and total, null without tasks', () => {
	assert.deepEqual(progressOf(memo), { done: 2, total: 7 });
	assert.equal(progressOf('just a note'), null);
});

test('setTask changes only that line, and refuses an index past the end', () => {
	const ticked = setTask(memo, 0, true);
	assert.equal(ticked.split('\n')[1], '- [x] milk');
	assert.equal(ticked.split('\n').filter((l, i) => l !== memo.split('\n')[i]).length, 1);
	assert.equal(setTask(memo, 1, false).split('\n')[2], '- [ ] eggs');
	assert.equal(setTask(memo, 6, true).split('\n')[11], '- [x] after the fence');
	assert.equal(setTask(memo, 7, true), null);
});

test('sameTask ignores Markdown marks and link targets', () => {
	assert.ok(sameTask('**call** the [bank](https://bank.example)', 'call the bank'));
	assert.ok(sameTask('`pay` water bill', 'Pay water bill'));
	assert.ok(!sameTask('pay water bill', 'pay gas bill'));
});

test('oneAtATime: overlapping saves run one after another, so neither is lost', async () => {
	// Two ticks in quick succession, each a read-modify-write of the memo.
	let stored = '- [ ] milk\n- [ ] eggs';
	const save = async (index) => {
		const read = stored;
		await new Promise((r) => setTimeout(r, 10));
		stored = setTask(read, index, true);
		return index;
	};
	const next = oneAtATime();
	assert.deepEqual(await Promise.all([next(() => save(0)), next(() => save(1))]), [0, 1]);
	assert.equal(stored, '- [x] milk\n- [x] eggs');

	// A failed save doesn't stop the next one.
	const failed = next(() => Promise.reject(new Error('nope')));
	const after = next(() => 'ran');
	await assert.rejects(failed, /nope/);
	assert.equal(await after, 'ran');
});
