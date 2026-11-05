// Markdown task lists ("- [ ] milk", "- [x] eggs"), shared by the Memos
// adapter, which saves a ticked box, and the detail view, which shows it.
// The nth task here is the nth checkbox the rendered Markdown shows: both
// count list items with a box, in order, outside fenced code.

const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s)(.*)$/;
const FENCE = /^\s*(?:>\s*)*(```|~~~)/;

/** @returns {{ line: number, checked: boolean, text: string }[]} */
export function tasksOf(markdown) {
	const tasks = [];
	let fence = null;
	(markdown || '').split('\n').forEach((line, i) => {
		const f = FENCE.exec(line);
		if (f) {
			if (!fence) fence = f[1];
			else if (f[1] === fence) fence = null;
			return;
		}
		if (fence) return;
		const m = TASK.exec(line);
		if (m) tasks.push({ line: i, checked: m[2] !== ' ', text: m[4] });
	});
	return tasks;
}

/** Done and total, or null when there are no tasks. */
export function progressOf(markdown) {
	const tasks = tasksOf(markdown);
	return tasks.length ? { done: tasks.filter((t) => t.checked).length, total: tasks.length } : null;
}

/** The Markdown with task `index` ticked or not; null when there's no such task. */
export function setTask(markdown, index, checked) {
	const task = tasksOf(markdown)[index];
	if (!task) return null;
	const lines = markdown.split('\n');
	lines[task.line] = lines[task.line].replace(TASK, (_, a, _box, b, text) => `${a}${checked ? 'x' : ' '}${b}${text}`);
	return lines.join('\n');
}

/**
 * Whether a task's Markdown and a checkbox's text name the same item, so a
 * box isn't saved onto a line that moved since the memo was opened. Letters
 * and digits only: the Markdown has marks (**, `, links) the text doesn't.
 */
export function sameTask(markdownText, shownText) {
	const plain = (s) => String(s || '').replace(/\]\([^)]*\)/g, ']').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
	return plain(markdownText) === plain(shownText);
}

/**
 * Runs the tasks handed to it one after another, each starting once the one
 * before has settled, and resolves with each task's own result.
 */
export function oneAtATime() {
	let last = Promise.resolve();
	return (task) => {
		const run = last.then(task);
		last = run.catch(() => {});
		return run;
	};
}
