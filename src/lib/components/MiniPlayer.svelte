<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { nowPlaying, queue, shuffleAfter, playAt } from '$lib/stores/player.js';
	import { integrations as integrationsStore } from '$lib/stores/integrations.js';

	// Corner player for a song, album or playlist picked in search.
	// Deliberately small: play or pause, stop, mute, and how far along it is.
	// An album or playlist plays in turn; a playlist adds Shuffle. No seeking.
	let audio = $state(null);
	let paused = $state(true);
	let muted = $state(false);
	let current = $state(0);
	let length = $state(0);
	let failed = $state(false);

	const track = $derived($nowPlaying);
	const q = $derived($queue);
	// Shuffle needs a track after this one to shuffle and jump to.
	const canShuffle = $derived(q?.type === 'playlist' && q.index < q.tracks.length - 1);
	// Navidrome knows the length; the element may not (Infinity until the
	// whole file is in, for some formats), so it's only the fallback.
	const total = $derived(track?.duration || (Number.isFinite(length) ? length : 0));
	const progress = $derived(total ? Math.min(current / total, 1) : 0);

	// A reload brings the song back where it was, paused: browsers don't let
	// a page start sound on its own before it's been clicked. Kept per tab.
	const SAVED_KEY = 'holm_player';
	let resumeAt = null;

	function save() {
		if (!track || failed || !audio) return;
		try { sessionStorage.setItem(SAVED_KEY, JSON.stringify({ track, at: audio.currentTime || 0, queue: get(queue) })); } catch { /* private mode */ }
	}

	function forget() {
		try { sessionStorage.removeItem(SAVED_KEY); } catch { /* private mode */ }
	}

	// Only while that integration's Player switch is still on.
	async function restore() {
		let saved;
		try { saved = JSON.parse(sessionStorage.getItem(SAVED_KEY) || 'null'); } catch { return; }
		const id = /^\/api\/integrations\/([^/]+)\//.exec(saved?.track?.stream || '')?.[1];
		if (!id) return forget();
		await integrationsStore.load();
		const it = get(integrationsStore).integrations.find((x) => x.id === id);
		const on = it?.userState?.connected && it.userState.surfaces?.widgets === true && (it.availableSurfaces || []).includes('widgets');
		if (!on) return forget();
		if (get(nowPlaying)) return;
		resumeAt = Number(saved.at) || 0;
		const sq = saved.queue;
		if (Array.isArray(sq?.tracks) && Number.isInteger(sq.index) && sq.tracks[sq.index]) queue.set(sq);
		nowPlaying.set(saved.track);
	}

	onMount(() => {
		restore();
		const onHide = () => { if (document.visibilityState === 'hidden') save(); };
		window.addEventListener('pagehide', save);
		document.addEventListener('visibilitychange', onHide);
		return () => {
			window.removeEventListener('pagehide', save);
			document.removeEventListener('visibilitychange', onHide);
		};
	});

	// A new track (a fresh object each pick, even the same song) starts over.
	$effect(() => {
		if (!audio || !track) return;
		failed = false;
		current = 0;
		audio.src = track.stream;
		if (resumeAt == null) {
			audio.play().catch(() => {});
			return;
		}
		// Restored: load just enough to show the time and seek, then wait.
		const at = resumeAt;
		resumeAt = null;
		current = at;
		audio.preload = 'metadata';
		audio.addEventListener('loadedmetadata', () => { audio.currentTime = at; }, { once: true });
	});

	function toggle() {
		if (!audio) return;
		if (audio.paused) audio.play().catch(() => {});
		else audio.pause();
	}

	function stop() {
		audio?.pause();
		audio?.removeAttribute('src');
		audio?.load();
		forget();
		queue.set(null);
		nowPlaying.set(null);
	}

	// The next track in the album or playlist; after the last, or for a
	// single song, the player stops.
	function next() {
		const cur = get(queue);
		if (!playAt(cur, (cur?.index ?? 0) + 1)) stop();
	}

	// Shuffles every track after this one and jumps to the first of the new
	// order, so Shuffle right after Play gives a random song.
	function shuffle() {
		if (!canShuffle) return;
		const shuffled = shuffleAfter(q);
		playAt(shuffled, shuffled.index + 1);
	}

	function time(s) {
		if (!Number.isFinite(s) || s < 0) s = 0;
		const m = Math.floor(s / 60);
		return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
	}
</script>

<audio
	bind:this={audio}
	bind:paused
	bind:muted
	bind:currentTime={current}
	bind:duration={length}
	onended={next}
	onerror={() => { if (track) { failed = true; forget(); } }}
	preload="none"
></audio>

{#if track}
	<div class="mini-player glass-card menu-surface animate-slide-up" role="region" aria-label="Now playing">
		<div class="mini-player-art">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
			{#if track.cover}<img src={track.cover} alt="" />{/if}
		</div>
		<div class="mini-player-text">
			<div class="mini-player-title" title={track.title}>{track.title}</div>
			{#if failed}
				<div class="mini-player-sub is-error">Couldn’t play this song</div>
			{:else}
				{#if track.artist}<div class="mini-player-sub" title={track.artist}>{track.artist}</div>{/if}
				<div class="mini-player-time"><span>{time(current)}</span> / <span>{time(total)}</span></div>
			{/if}
		</div>
		<div class="mini-player-buttons">
			<button type="button" class="mini-player-btn" aria-label={paused ? 'Play' : 'Pause'} onclick={toggle} disabled={failed}>
				{#if paused}
					<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>
				{:else}
					<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
				{/if}
			</button>
			{#if q?.type === 'playlist'}
				<!-- An action, not a switch: each tap reshuffles, so no pressed state. -->
				<button type="button" class="mini-player-btn" aria-label="Shuffle" onclick={shuffle} disabled={!canShuffle}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/></svg>
				</button>
			{/if}
			<button type="button" class="mini-player-btn" aria-label="Stop" onclick={stop}>
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
			</button>
			<button type="button" class="mini-player-btn" aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} onclick={() => (muted = !muted)}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M11 5 6 9H3v6h3l5 4V5Z"/>
					{#if muted}<path d="m22 9-6 6M16 9l6 6"/>{:else}<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>{/if}
				</svg>
			</button>
		</div>
		<!-- How far along, display only. -->
		<div class="mini-player-progress" aria-hidden="true"><div style="transform: scaleX({progress})"></div></div>
	</div>
{/if}

<style>
	/* Placed by CornerStack. */
	.mini-player {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 10px 12px;
		border-radius: 16px;
		overflow: hidden;
		box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.45);
	}
	.mini-player-art {
		position: relative;
		width: 48px;
		height: 48px;
		flex-shrink: 0;
		border-radius: 8px;
		overflow: hidden;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--color-content) 8%, transparent);
		color: var(--color-content-dim);
	}
	.mini-player-art svg { width: 22px; height: 22px; }
	.mini-player-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
	.mini-player-text { flex: 1; min-width: 0; }
	.mini-player-title,
	.mini-player-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mini-player-title { font-size: 0.85rem; font-weight: 600; color: var(--color-content); }
	.mini-player-sub { font-size: 0.75rem; color: var(--color-content-dim); margin-top: 1px; }
	.mini-player-sub.is-error { color: var(--color-content-muted); }
	.mini-player-time { font-size: 0.7rem; color: var(--color-content-dim); margin-top: 2px; font-variant-numeric: tabular-nums; }
	.mini-player-buttons { display: flex; gap: 2px; flex-shrink: 0; }
	.mini-player-btn {
		width: 32px;
		height: 32px;
		display: grid;
		place-items: center;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--color-content);
		cursor: pointer;
	}
	.mini-player-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--color-content) 10%, transparent); }
	.mini-player-btn:disabled { opacity: 0.4; cursor: default; }
	.mini-player-btn:focus-visible { outline: 2px solid var(--color-content-muted); outline-offset: 1px; }
	.mini-player-btn svg { width: 16px; height: 16px; }
	.mini-player-progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 3px;
		background: color-mix(in srgb, var(--color-content) 10%, transparent);
	}
	.mini-player-progress div {
		height: 100%;
		background: var(--color-content-muted);
		transform-origin: left;
	}
</style>
