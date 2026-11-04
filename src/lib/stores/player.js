import { writable } from 'svelte/store';

// The song in the corner player, or null when nothing is playing. Set from
// search (a Navidrome result's `meta.track`); MiniPlayer owns the audio.
export const nowPlaying = writable(null);

// The album or playlist the song belongs to, or null for a single song:
// `{ type: 'album' | 'playlist', tracks, index }`, with `index` the song now
// playing. The player moves through it in turn and stops after the last.
export const queue = writable(null);

// The queue after Shuffle: the tracks up to and including the current one
// stay put, and every one after it is shuffled (Fisher–Yates).
export function shuffleAfter(q, random = Math.random) {
	const done = q.tracks.slice(0, q.index + 1);
	const rest = q.tracks.slice(q.index + 1);
	for (let i = rest.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[rest[i], rest[j]] = [rest[j], rest[i]];
	}
	return { ...q, tracks: [...done, ...rest] };
}

// Plays a single song: any album or playlist playing is dropped. A fresh
// object each time, so picking the playing song again restarts it.
export function playTrack(track) {
	queue.set(null);
	nowPlaying.set({ ...track });
}

// Plays an album or playlist from its first track.
export function playQueue(type, tracks) {
	if (!tracks.length) return;
	queue.set({ type, tracks, index: 0 });
	nowPlaying.set({ ...tracks[0] });
}

// Moves to `index` in the queue. False when there's no track there.
export function playAt(q, index) {
	if (!q || index >= q.tracks.length) return false;
	queue.set({ ...q, index });
	nowPlaying.set({ ...q.tracks[index] });
	return true;
}
