<script>
	import { onMount, getContext, untrack, tick } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { integrations as integrationsStore } from '$lib/stores/integrations.js';
	import { playTrack as startTrack, playQueue } from '$lib/stores/player.js';
	import { prefs } from '$lib/stores/prefs.js';
	import { resolveIcon } from '$lib/apps.js';
	import SearchResults from './SearchResults.svelte';
	import { isMac } from './Keys.svelte';
	import { bestScore } from '$lib/launcher/match.js';
	import { buildActions, matchBang } from '$lib/launcher/actions.js';
	import { arrangeProviderSections, topHit } from '$lib/launcher/sections.js';
	import { providersFor } from '$lib/launcher/scope.js';
	import { cycleHints } from '$lib/launcher/typedHints.js';
	import { recordOpen, frecencyScores } from '$lib/launcher/frecency.js';
	import { instantAnswer, isCalculation } from '$lib/launcher/instant.js';
	import { searchOnFocus } from '$lib/searchOnFocus.js';
	import { oneAtATime, progressOf, setTask } from '$lib/checklist.js';
	import { searchTransparency, searchGlassLevel, searchHints } from '$lib/searchLook.js';

	const siteConfig = getContext('config');
	const searchConfig = siteConfig?.search || { enabled: true, url: 'https://www.google.com/search', param: 'q' };

	let { query = $bindable(''), apps = [], onSettingsOpen = () => {} } = $props();
	let inputEl;
	let containerEl;
	// Available pixel height for the results dropdown — computed from the bar's
	// bottom edge to the viewport bottom minus a breathing gap. Recomputed on
	// open + window resize so the panel never spills past the visible area.
	let resultsMaxHeight = $state(420);
	// On desktop the open palette slides up toward the top of the viewport,
	// Spotlight-style, so short screens (a 14" laptop) give the results most
	// of the height instead of the strip under a mid-page bar, unless the
	// person (or search.on_focus in config.yml) chose to open it in place. On
	// phones it always pins to the top, just under the status bar, above the
	// keyboard. `lift` is the px the bar is raised by.
	let lift = $state(0);
	const onFocus = $derived(searchOnFocus($prefs.searchOnFocus, searchConfig.on_focus));
	// The bar's glass level: the page's, or the one this person pinned it to.
	const glassLevel = $derived(searchGlassLevel(searchTransparency($prefs.searchTransparency, searchConfig.transparency), $prefs.glass));
	const hintsRotate = $derived(searchHints($prefs.searchHints, searchConfig.hints) === 'rotating');
	// env(safe-area-inset-top) in px: the status bar in an installed app.
	// Measured on mount and on resize (which covers rotation), not per scroll.
	let safeTop = 0;
	function safeAreaTop() {
		const probe = document.createElement('div');
		probe.style.cssText = 'position:absolute;visibility:hidden;padding-top:env(safe-area-inset-top, 0px)';
		document.body.appendChild(probe);
		const px = parseFloat(getComputedStyle(probe).paddingTop) || 0;
		probe.remove();
		return px;
	}
	function recomputeResultsMaxHeight() {
		if (!containerEl || typeof window === 'undefined') return;
		const rect = containerEl.getBoundingClientRect();
		// Measure from where the bar rests: undo the translate actually
		// applied right now, which mid-slide is not yet `lift`.
		const shift = new DOMMatrixReadOnly(getComputedStyle(containerEl).transform).m42;
		const restTop = rect.top - shift;
		const restBottom = rect.bottom - shift;
		// The visible part of the page: iOS covers it with the keyboard
		// without resizing it, and may scroll it underneath.
		const vv = window.visualViewport;
		const desktop = window.matchMedia('(min-width: 768px)').matches;
		const targetTop = desktop ? Math.max(48, window.innerHeight * 0.1) : (vv?.offsetTop ?? 0) + safeTop + 12;
		lift = inlineOpen && (!desktop || onFocus === 'top') ? Math.max(0, Math.round(restTop - targetTop)) : 0;
		const gap = 24;
		const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
		const available = visibleBottom - (restBottom - lift) - gap;
		resultsMaxHeight = Math.max(220, available);
	}

	// ── Provider model — unified search ───────────────────────────
	// There is no provider switcher. The form's submit target is the
	// configured web search (Enter key fires it in a new tab). Every
	// connected integration that exposes inline-mode search providers
	// AND has the user's `surfaces.search` toggle on runs automatically
	// on every keystroke; results land in the dropdown below the bar.
	//
	// This matches the iPhone Spotlight model: one box, one experience,
	// no clicks to switch contexts.

	const inlineProviders = $derived.by(() => {
		const out = [];
		for (const it of $integrationsStore.integrations) {
			if (!it.userState?.connected) continue;
			if (it.userState?.surfaces?.search === false) continue;
			if (!(it.availableSurfaces || []).includes('search')) continue;
			for (const [key, prov] of Object.entries(it.searchProviders || {})) {
				if (prov.mode !== 'inline') continue;
				out.push({
					providerId: `${it.id}:${key}`,
					integrationId: it.id,
					integrationName: it.name,
					integrationIcon: it.icon,
					providerKey: key,
					label: prov.label,
					kind: prov.kind,
					layout: prov.layout,
					shelf: prov.shelf,
					scoped: prov.scoped,
					filters: prov.filters,
					// Navidrome's player widget: songs play in Holm instead of opening.
					player: it.userState?.surfaces?.widgets === true && (it.availableSurfaces || []).includes('widgets'),
					// The Calendar's CalDAV URL is no page to browse; its web address is.
					searchUrl: it.userState?.config?.webUrl || it.operatorDefaults?.url || it.userState?.config?.url || null
				});
			}
		}
		return out;
	});

	const hasInlineProviders = $derived(inlineProviders.length > 0);

	// ── Bang-prefix scope (chip-style) ───────────────────────────
	// `query` holds only the user-visible text (no bang prefix once recognized).
	// `activeScope` holds the integrationId once a shortcut is recognized from input.
	let activeScope = $state(null);

	const shortcutMap = $derived.by(() => {
		const m = new Map();
		for (const it of $integrationsStore.integrations) {
			if (!it.shortcut || !it.userState?.connected) continue;
			const key = it.shortcut.toLowerCase();
			if (!m.has(key)) m.set(key, it.id);
		}
		return m;
	});

	// Called on every input event. A bang token is only promoted once it is
	// space-terminated (or Enter-terminated, handled in handleInputKeydown).
	// This avoids clobbering longer shortcuts that share a prefix (e.g. `p` vs `pk`).
	function maybePromoteScope() {
		if (activeScope) return;
		const s = (query || '').trimStart();
		if (!s.startsWith('!')) return;
		const m = s.match(/^!([a-zA-Z0-9_-]+)\s+(.*)$/);
		if (!m) return;
		const id = shortcutMap.get(m[1].toLowerCase());
		if (!id) return;
		activeScope = id;
		query = m[2];
	}

	// Shortcuts arrive with the integrations store, which can be after a
	// `?q=!jf dune` deep link set the query — promote once they do.
	$effect(() => {
		shortcutMap;
		untrack(maybePromoteScope);
	});

	// A tag or list picked inside the scope (`Karakeep › #recipes`): only
	// that app's `filters` providers are asked, with its params.
	let activeFilter = $state(null);
	$effect(() => {
		if (activeFilter && activeFilter.integrationId !== activeScope) activeFilter = null;
	});

	const scopedProviders = $derived(providersFor(inlineProviders, activeScope, activeFilter));

	const activeIntegration = $derived(
		activeScope ? $integrationsStore.integrations.find((it) => it.id === activeScope) : null
	);

	// ── Quick-action registry ───────────────────────────────────
	const ACTIONS = buildActions({ wallpapers: siteConfig?.wallpapers?.enabled ? siteConfig.wallpapers.count || 0 : 0, onSettingsOpen: () => onSettingsOpen() });
	const matchedActions = $derived(activeScope ? [] : matchBang(ACTIONS, query));

	function runAction(action) {
		try { action.exec(); } catch (err) { console.error('Action failed:', err); }
		query = '';
		activeScope = null;
		inlineOpen = false;
		inputEl?.blur();
	}

	// Lazy-load the integrations registry once on mount so the inline
	// providers list is populated without requiring focus first.
	let triedLoad = false;
	function ensureIntegrationsLoaded() {
		if (triedLoad) return;
		triedLoad = true;
		integrationsStore.load();
	}

	// ── Inline-mode search dispatch ───────────────────────────────
	// One results bucket per provider. Keyed by providerId so multiple
	// providers in the future render as separate sections in the dropdown.
	let providerResults = $state({}); // providerId → { results, loading, error }
	let inlineOpen = $state(false);
	let debounceTimer = null;
	let lastDispatched = '';
	let searchAbort = null;

	// Drop any pending or in-flight provider search so a slower, older
	// response can't land under a newer query.
	function cancelSearch() {
		clearTimeout(debounceTimer);
		searchAbort?.abort();
		searchAbort = null;
		lastDispatched = '';
	}

	// ── Rotating typed placeholder ────────────────────────────────
	// Cycles through hints so the placeholder advertises what the palette
	// can do (bangs, actions, shortcuts) without a static wall of text.
	// Pauses while the user is focused, typing, or scoped — those are
	// states where a moving placeholder would distract. With Hints set to Still
	// (Configure → Widgets → Search) the first hint just stays.
	// The scope hint uses a real shortcut from a connected integration, since
	// shortcuts are per-adapter and operator-overridable.
	const scopeHint = $derived.by(() => {
		const it = $integrationsStore.integrations.find((i) => i.shortcut && i.userState?.connected);
		return it ? `Try !${it.shortcut} to scope ${it.name}` : null;
	});
	// The server render assumes Mac; swap to Ctrl after hydration so the
	// two renders agree.
	let macKeys = $state(true);
	onMount(() => { macKeys = isMac; });
	const FIRST_HINT = 'Search apps, files, photos…';
	const PLACEHOLDER_HINTS = $derived([
		FIRST_HINT,
		...(scopeHint ? [scopeHint] : []),
		'Type a command, like “dark” or “wallpaper”',
		'Do quick maths, like “12 * 7” or “5 km in mi”',
		`Press / or ${isMac ? '⌘K' : 'Ctrl K'} anywhere to search`
	]);
	let placeholderText = $state(FIRST_HINT);

	$effect(() => {
		if (typeof document === 'undefined') return;
		if (!hintsRotate) {
			placeholderText = FIRST_HINT;
			return;
		}
		if (inlineOpen || query || activeScope) return;
		return cycleHints(PLACEHOLDER_HINTS, (text) => (placeholderText = text), () => prefersReducedMotion.current);
	});

	async function fireOneProvider(provider, q, signal, key, filter) {
		providerResults = {
			...providerResults,
			[provider.providerId]: { ...(providerResults[provider.providerId] || {}), loading: true, error: '' }
		};
		try {
			const res = await fetch('/api/search', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ provider: provider.providerId, query: q, limit: 24, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...(filter ? { filter: filter.params } : {}) }),
				signal
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error || `HTTP ${res.status}`);
			}
			const data = await res.json();
			if (lastDispatched !== key) return; // a newer query has overtaken us
			providerResults = {
				...providerResults,
				[provider.providerId]: {
					results: data.results || [],
					more: data.more || null,
					loading: false,
					error: ''
				}
			};
		} catch (err) {
			if (signal.aborted || lastDispatched !== key) return;
			providerResults = {
				...providerResults,
				[provider.providerId]: {
					results: [],
					loading: false,
					error: err.message || 'Search failed'
				}
			};
		}
	}

	// Min query length before any remote provider fetch fires. One/two-letter
	// queries are mostly people filtering local apps — fanning out to every
	// connected integration on every keystroke is noisy + expensive (and the
	// results are too broad to be useful). Matches the Raycast/Spotlight
	// pattern of "local-instant, remote-after-3-chars". Scoped queries are
	// gated by the same threshold by design — the user opted into a scope but
	// we still don't want a Planka cards fetch on "p".
	const MIN_REMOTE_QUERY_LENGTH = 3;

	// Inside a picked filter an empty query lists what's in it.
	function dispatchSearch(q, providers, filter) {
		cancelSearch();
		const trimmed = (q || '').trim();
		if (trimmed.length < MIN_REMOTE_QUERY_LENGTH && !(filter && !trimmed)) {
			providerResults = {};
			return;
		}
		debounceTimer = setTimeout(() => {
			const key = filter ? `${JSON.stringify(filter.params)}\n${trimmed}` : trimmed;
			lastDispatched = key;
			searchAbort = new AbortController();
			for (const provider of providers) {
				fireOneProvider(provider, trimmed, searchAbort.signal, key, filter);
			}
		}, 250);
	}

	$effect(() => {
		// Bang-prefixed input is a built-in command (`!settings`, `!theme`, …) or
		// a pending scope shortcut. Either way the user is not asking integrations
		// to search — skip the dispatch entirely so we don't waste requests on
		// every keystroke until they hit space and a real query begins. A sum
		// answers in place, so it isn't sent to them either.
		const trimmed = (query || '').trim();
		const isBang = trimmed.startsWith('!');
		if (hasInlineProviders && !isBang && !isCalculation(trimmed)) {
			dispatchSearch(query, scopedProviders, activeFilter);
		} else {
			cancelSearch();
			providerResults = {};
		}
	});

	// ── Launcher model ────────────────────────────────────────────
	// Everything the list shows is built here as sections of items. Each item
	// carries its own actions; actions[0] is what Enter does, actions[1] is
	// ⌘↵, and the ⌘K panel lists them all.
	const openAppsInNewTab = $derived($prefs.openInNewTab ?? true);

	// Result links come from integrations (bookmarks, files), so only follow
	// http(s): a stored `javascript:` link would otherwise run as Holm.
	function safeUrl(url) {
		try {
			const u = new URL(url, window.location.href);
			return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
		} catch {
			return null;
		}
	}

	function openUrl(raw, newTab) {
		const url = raw && safeUrl(raw);
		if (!url) return;
		if (newTab) window.open(url, '_blank', 'noopener,noreferrer');
		else window.location.href = url;
	}

	async function copyText(text) {
		try { await navigator.clipboard.writeText(text); } catch {}
	}

	// Which value of the answer card was just copied, for its "Copied" label.
	// Tied to the query, so typing on clears it.
	let answerCopied = $state(null);
	let answerCopiedTimer;
	function copyAnswer(value, index) {
		copyText(value.copy);
		answerCopied = { index, query };
		clearTimeout(answerCopiedTimer);
		answerCopiedTimer = setTimeout(() => (answerCopied = null), 1500);
		inputEl?.focus();
	}

	function finish() {
		query = '';
		activeScope = null;
		inlineOpen = false;
		panelOpen = false;
		inputEl?.blur();
	}

	// Only app opens feed frecency: they're the only keys it ranks, and
	// one-off result opens would otherwise evict app history.
	const noteOpen = (key) => { if (key.startsWith('app:')) recordOpen(key); };

	function linkActions(key, url, newTabFirst, openLabel = 'Open') {
		const open = { label: openLabel, run: () => { noteOpen(key); openUrl(url, newTabFirst); finish(); } };
		const other = {
			label: newTabFirst ? 'Open in this tab' : 'Open in new tab',
			hint: '⌘ ↵',
			run: () => { noteOpen(key); openUrl(url, !newTabFirst); finish(); }
		};
		const copy = { label: 'Copy link', hint: '⌘ ⇧ C', run: () => { copyText(url); finish(); } };
		return [open, other, copy];
	}

	// Result actions run in place (e.g. Seerr's Request): the list stays open
	// and the poster's badge reports how it went. Keyed by result key. They
	// never run on a plain click or Enter, which open the title; the poster
	// shows a button for it on hover, and the ⌘K panel lists it.
	let actionState = $state({});

	async function runResultAction(key, integrationId, action) {
		if (actionState[key]?.busy || actionState[key]?.ok) return;
		actionState = { ...actionState, [key]: { busy: true, message: `${action.label}…` } };
		const res = await integrationsStore.runAction(integrationId, action.key, action.params);
		actionState = { ...actionState, [key]: { ok: res.ok, message: res.message } };
	}

	// The poster's button: Request, then a disabled Requested once it's in
	// (or when Seerr already has a request for the title).
	function resultAction(key, p, r) {
		if (actionState[key]?.ok || r.meta?.requested) return { label: 'Requested', done: true };
		if (!r.action) return null;
		return {
			label: r.action.label,
			busy: !!actionState[key]?.busy,
			run: () => runResultAction(key, p.integrationId, r.action)
		};
	}

	function playTrack(track) {
		startTrack(track);
		finish();
	}

	// An album or playlist: fetch its tracks, then play from the first. The
	// list stays open while they load, and the badge reports a failure.
	async function playTracks(key, p, r) {
		if (actionState[key]?.busy) return;
		actionState = { ...actionState, [key]: { busy: true } };
		try {
			const tracks = await integrationsStore.queue(p.integrationId, r.meta.queue);
			if (!tracks.length) throw new Error('Nothing to play');
			const cleared = { ...actionState };
			delete cleared[key];
			actionState = cleared;
			playQueue(r.meta.queue.type, tracks);
			finish();
		} catch (err) {
			actionState = { ...actionState, [key]: { ok: false, message: err.message || 'Couldn’t play this' } };
		}
	}

	// Playing a result in the corner player, or null when it can't play there.
	function playerAction(key, p, r) {
		if (!p.player) return null;
		if (r.meta?.track) return { run: () => playTrack(r.meta.track) };
		if (r.meta?.queue) return { run: () => playTracks(key, p, r) };
		return null;
	}

	function resultActions(key, p, r) {
		// With the player widget on, a song, album or playlist plays in the
		// corner player and opening it in its app moves to second.
		const player = playerAction(key, p, r);
		const play = player ? [{ label: 'Play', run: player.run }] : [];
		const links = r.href ? linkActions(key, r.href, true, play.length ? `Open in ${p.integrationName}` : r.openLabel || 'Open') : [];
		const extra = resultAction(key, p, r);
		const all = [...play, ...(extra?.run ? [...links, extra] : links)];
		return r.detail ? [{ label: 'Show details', run: () => openDetail(key, p, r) }, ...all] : all;
	}

	// A tag or list: Enter searches inside it, ⌘↵ opens it in its app.
	function filterActions(key, p, r) {
		const inside = { label: `Search in ${r.filter.label}`, run: () => drillIn(p, r) };
		return [inside, ...(r.href ? linkActions(key, r.href, true, `Open in ${p.integrationName}`) : [])];
	}

	function drillIn(p, r) {
		activeFilter = { integrationId: p.integrationId, label: r.filter.label, params: r.filter.params };
		query = '';
		inlineOpen = true;
		inputEl?.focus();
	}

	// Detail view (Spotlight-style) for a result with `detail` params: it
	// replaces the list until Esc, a new query, or an arrow key.
	let detailView = $state(null);
	let detailSeq = 0;

	async function openDetail(key, p, r) {
		const seq = ++detailSeq;
		detailView = { key, p, r, loading: true, data: null, error: '' };
		try {
			const data = await integrationsStore.details(p.integrationId, r.detail);
			if (seq === detailSeq) detailView = { ...detailView, loading: false, data };
		} catch (err) {
			if (seq === detailSeq) detailView = { ...detailView, loading: false, error: err.message || 'Couldn’t load details' };
		}
	}

	function closeDetail() {
		detailSeq++;
		detailView = null;
	}

	// A checklist box in the detail view (a memo's): saved through the
	// integration's action, then shown ticked, with the done counts on the
	// facts and on the result row following. `taskStates` holds, by box,
	// 'saving' or the error with what to retry. Saves go one at a time: each
	// rewrites the whole memo from a fresh read, so two at once would lose one.
	const nextSave = oneAtATime();
	async function checkTask(index, checked, text) {
		const view = detailView;
		const list = view?.data?.checklist;
		if (!list || view.taskStates?.[index] === 'saving') return;
		const seq = detailSeq;
		const setState = (st) => {
			const states = { ...detailView.taskStates };
			if (st) states[index] = st;
			else delete states[index];
			detailView = { ...detailView, taskStates: states };
		};
		setState('saving');
		// Holm itself out of reach (offline) is a connection error too.
		const res = await nextSave(() =>
			seq === detailSeq ? integrationsStore.runAction(view.p.integrationId, list.key, { ...list.params, index, checked, text }) : null
		).catch(() => ({ ok: false, message: 'Can’t reach Holm. Check your connection.' }));
		if (seq !== detailSeq || !res) return;
		if (!res.ok) {
			setState({ error: res.message, checked, text });
			return;
		}
		const markdown = setTask(detailView.data.markdown, index, checked) ?? detailView.data.markdown;
		const progress = progressOf(markdown);
		const facts = (detailView.data.facts || []).map((f) => (progress && /^\d+ of \d+ done$/.test(f) ? `${progress.done} of ${progress.total} done` : f));
		if (detailView.r.meta) detailView.r.meta.progress = progress;
		detailView = { ...detailView, data: { ...detailView.data, markdown, facts } };
		setState(null);
	}

	// "Play on Jellyfin": Seerr says which server it plays from; a Jellyfin or
	// Plex result plays on itself. The button wears the accent, like the poster ▶.
	function openOn(p, r) {
		if (r.openLabel !== 'Play') return { label: r.openLabel || 'Open' };
		const on = r.meta?.merge ? r.meta.playOn : p.integrationName;
		return { label: on ? `Play on ${on}` : 'Play' };
	}

	const detail = $derived(detailView && {
		...detailView,
		title: detailView.data?.title || detailView.r.title,
		thumbnail: detailView.data?.thumbnail || detailView.r.thumbnail,
		badge: (actionState[detailView.key]?.ok === false && actionState[detailView.key].message) || '',
		request: resultAction(detailView.key, detailView.p, detailView.r),
		open: detailView.r.href
			? { ...openOn(detailView.p, detailView.r), run: () => { openUrl(detailView.r.href, true); finish(); } }
			: null,
		// A link the details bring (an event's video call). The label names
		// the host, since anyone who sends an invite picks the link.
		link: detailView.data?.link?.href && /^https:\/\//.test(detailView.data.link.href)
			? { label: `${detailView.data.link.label || 'Open'} · ${new URL(detailView.data.link.href).host}`, run: () => { openUrl(detailView.data.link.href, true); finish(); } }
			: null
	});

	function appItem(app) {
		const key = `app:${app.id}`;
		let host = '';
		try { host = new URL(app.url).host; } catch {}
		return {
			key,
			title: app.name,
			subtitle: app.subtitle || host,
			appIcon: app.icon ?? null,
			accessory: 'App',
			url: app.url,
			actions: linkActions(key, app.url, openAppsInNewTab)
		};
	}

	function commandItem(a) {
		return {
			key: `cmd:${a.id}`,
			title: a.label,
			subtitle: a.bang ? `!${a.bang}${a.arg ? ' ' + a.arg : ''}` : '',
			svg: a.icon,
			accessory: 'Command',
			actions: [{ label: 'Run command', run: () => runAction(a) }]
		};
	}

	let frecency = $state({});
	$effect(() => {
		if (inlineOpen) frecency = frecencyScores();
	});

	const sections = $derived.by(() => {
		const q = (query || '').trim();
		const out = [];

		// Bang mode: only the matching commands.
		if (matchedActions.length) {
			out.push({ id: 'commands', label: 'Commands', items: matchedActions.map(commandItem) });
			return out;
		}
		// A bare or partial bang ("!", "!th"): list the commands and scopes
		// it could still become, so "!" doubles as the command list.
		if (q.startsWith('!') && !activeScope) {
			const m = q.match(/^!([a-zA-Z0-9_-]*)$/);
			if (!m) return out;
			const prefix = m[1].toLowerCase();
			const cmds = ACTIONS.filter((a) => a.bang.startsWith(prefix));
			if (cmds.length) out.push({ id: 'commands', label: 'Commands', items: cmds.map(commandItem) });
			const scopes = [];
			for (const [key, id] of shortcutMap) {
				if (!key.startsWith(prefix)) continue;
				const it = $integrationsStore.integrations.find((i) => i.id === id);
				if (!it) continue;
				scopes.push({
					key: `scope:${id}`,
					title: `Search in ${it.name}`,
					subtitle: `!${key}`,
					appIcon: it.icon ? resolveIcon(it.icon) : null,
					actions: [{ label: `Search ${it.name}`, run: () => { activeScope = id; query = ''; inputEl?.focus(); } }]
				});
			}
			if (scopes.length) out.push({ id: 'scopes', label: 'Scopes', items: scopes });
			return out;
		}

		// Nothing typed yet: recents first, then a few commands.
		if (!q && !activeScope) {
			const ranked = apps
				.map((a) => ({ a, f: frecency[`app:${a.id}`] || 0 }))
				.filter((x) => x.f > 0)
				.sort((x, y) => y.f - x.f)
				.slice(0, 6)
				.map((x) => x.a);
			const recent = ranked.length ? ranked : apps.slice(0, 6);
			out.push({ id: 'recent', label: ranked.length ? 'Recent' : 'Apps', items: recent.map(appItem) });
			const suggested = ['settings', 'wall', $prefs.theme === 'light' ? 'theme-dark' : 'theme-light'];
			out.push({
				id: 'commands',
				label: 'Commands',
				items: suggested.map((id) => ACTIONS.find((a) => a.id === id)).filter(Boolean).map(commandItem)
			});
			return out;
		}

		if (!activeScope) {
			// Maths, conversions and times answer in place, above everything,
			// so Enter copies the answer.
			const answer = instantAnswer(q);
			if (answer) {
				// A bare "2ft" answers in more than one unit: Enter copies the
				// first, the actions panel offers each. Copying keeps the search
				// open, so it works as a calculator.
				const values = [{ ...answer.to, copy: answer.copy }, ...(answer.also || [])];
				out.push({
					id: 'answer',
					label: { math: 'Calculator', unit: 'Conversion', time: 'Time' }[answer.kind],
					layout: 'answer',
					items: [{
						key: 'answer',
						title: answer.to.value,
						subtitle: answer.from.value,
						answer,
						actions: values.map((v, i) => ({
							label: values.length > 1 ? `Copy ${v.value}` : 'Copy answer',
							run: () => copyAnswer(v, i)
						}))
					}]
				});
			}

			const scoredApps = apps
				.map((a) => ({
					a,
					s: bestScore(q, a.name, [a.subtitle, ...(a.tags || [])].filter(Boolean)) + Math.min(frecency[`app:${a.id}`] || 0, 10)
				}))
				// 45+ = substring or better; a letters-in-order match alone would
				// put a weak app above the web fallback that Enter should hit.
				.filter((x) => x.s >= 45)
				.sort((x, y) => y.s - x.s)
				.slice(0, 6);
			if (scoredApps.length) out.push({ id: 'apps', label: 'Apps', items: scoredApps.map((x) => appItem(x.a)) });

			const scoredCmds = ACTIONS
				.map((a) => ({ a, s: bestScore(q, a.label, a.keywords || []) }))
				.filter((x) => x.s >= 45)
				.sort((x, y) => y.s - x.s)
				.slice(0, 3);
			if (scoredCmds.length) out.push({ id: 'commands', label: 'Commands', items: scoredCmds.map((x) => commandItem(x.a)) });
		}

		// Results from connected apps, one section each. A result marked
		// `merge` (Seerr) stands for its title, so other providers' results for
		// the same TMDB id are dropped rather than shown twice. The media
		// server is the authority on what the user has: when it returned the
		// title, the merged row plays from there and offers no Request.
		const merged = new Set();
		const owned = new Map();
		for (const p of scopedProviders) {
			for (const r of providerResults[p.providerId]?.results || []) {
				if (!r.meta?.tmdb) continue;
				if (r.meta.merge) merged.add(r.meta.tmdb);
				else if (r.href && !owned.has(r.meta.tmdb)) owned.set(r.meta.tmdb, { href: r.href, name: p.integrationName });
			}
		}
		// The app a poster opens in, for the small icon on its corner: the
		// media server for a title the user has, otherwise the provider.
		const sourceOf = (p, r) => {
			const name = (r.meta?.merge && r.meta.playOn) || p.integrationName;
			const it = $integrationsStore.integrations.find((i) => i.name.toLowerCase() === name.toLowerCase());
			const icon = resolveIcon(it?.icon || p.integrationIcon);
			if (!icon.colored) return null;
			// Follows the icon style picked for the apps: colour, or the flat
			// mark in white or grey.
			const style = $prefs.iconStyle || 'colored';
			return style === 'colored'
				? { name: it?.name || name, icon: icon.colored, style }
				: { name: it?.name || name, icon: icon.mono || icon.colored, fallback: icon.colored, style };
		};
		const fromMediaServer = (r) =>
			r.meta?.merge && owned.has(r.meta.tmdb)
				? { ...r, href: owned.get(r.meta.tmdb).href, openLabel: 'Play', action: undefined, meta: { ...r.meta, status: '', requested: false, playOn: owned.get(r.meta.tmdb).name } }
				: r;
		const provSections = scopedProviders.map((p) => {
			const data = providerResults[p.providerId] || {};
			const results = (data.results || [])
				.filter((r) => r.meta?.merge || !merged.has(r.meta?.tmdb))
				.map(fromMediaServer);
			const kind = results[0]?.meta?.kind || p.kind || 'other';
			const layout = p.layout || (kind === 'photo' ? 'grid' : kind === 'media' ? 'poster' : 'list');
			// Songs sit three to a row: with a "More" card, five leave it room on
			// the second row instead of a row of its own.
			// The provider's own results page for this query, else the app itself.
			const moreUrl = data.more || p.searchUrl;
			const more = moreUrl && results.length > (layout === 'grid' ? 6 : layout === 'poster' ? 8 : 6);
			const max = layout === 'grid' ? 6 : layout === 'poster' ? 8 : layout === 'tracks' && more ? 5 : 6;
			return {
				id: `p-${p.providerId}`,
				integrationId: p.integrationId,
				shelf: p.shelf,
				label: p.label,
				layout,
				kind,
				loading: !!data.loading && (q.length >= 3 || !!activeFilter),
				// Videos hold their row with three grey tiles until the first ones land.
				skeleton: layout === 'video' && !!data.loading && (q.length >= 3 || !!activeFilter) && !results.length,
				error: data.error || '',
				items: [...results.slice(0, max).map((r) => {
					const key = `r:${p.providerId}:${r.id}`;
					return {
						key,
						url: r.href,
						title: r.title,
						subtitle: r.subtitle,
						thumbnail: r.thumbnail,
						duration: r.meta?.duration,
						info: r.meta?.info,
						kind: r.meta?.kind,
						color: r.meta?.color,
						// A failed action reports here; success shows on the chip. The
						// play mark already says "Available", so that badge is dropped.
						badge: (actionState[key]?.ok === false && actionState[key].message)
							|| (r.openLabel === 'Play' && r.meta?.status === 'Available' ? '' : r.meta?.status) || '',
						// A movie or show the user has: the play mark on the art
						// plays it, while a click elsewhere opens its details.
						play: r.openLabel === 'Play' && r.href
							? { run: () => { openUrl(r.href, true); finish(); } }
							: playerAction(key, p, r),
						request: resultAction(key, p, r),
						showDetail: r.detail ? () => openDetail(key, p, r) : null,
						tmdb: r.meta?.tmdb,
						source: layout === 'poster' ? sourceOf(p, r) : null,
						tags: r.tags,
						progress: r.meta?.progress,
						accessory: layout === 'list' ? p.integrationName : '',
						actions: r.filter ? filterActions(key, p, r) : resultActions(key, p, r)
					};
				}), ...(results.length > max && moreUrl ? [{
					key: `more:${p.providerId}`,
					title: `More in ${p.integrationName}`,
					more: true,
					url: moreUrl,
					svg: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
					actions: linkActions(`more:${p.providerId}`, moreUrl, true)
				}] : [])]
			};
		});
		const arranged = arrangeProviderSections(provSections);
		// A result titled just what was typed goes above everything but the
		// answer, unless an app already matches that well.
		const hit = !activeScope && !out.some((s) => s.id === 'apps' && s.items.some((i) => bestScore(q, i.title) >= 85)) && topHit(q, arranged);
		if (hit) {
			const at = out[0]?.id === 'answer' ? 1 : 0;
			out.splice(at, 0, { id: 'top', label: 'Top hit', layout: 'list', items: [{ ...hit.item, key: `top:${hit.item.key}`, accessory: hit.item.accessory || hit.section.label }] });
		}
		// The top hit leaves its own section, so ↓ doesn't visit it twice.
		out.push(...(hit ? arranged.map((s) => (s === hit.section ? { ...s, items: s.items.filter((i) => i !== hit.item) } : s)) : arranged));

		// Fallback: the web search, always last. One row only; each app's
		// results are already above, and its !shortcut still scopes to it.
		// The icon is grey so it doesn't pull the eye from the results.
		if (q) {
			const fb = [];
			if (searchConfig?.url) {
				const param = searchConfig.param || 'q';
				const url = `${searchConfig.url}${searchConfig.url.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(q)}`;
				fb.push({
					key: 'web',
					title: `Search the web for “${q}”`,
					subtitle: searchConfig.name || 'Web',
					appIcon: searchConfig.icon ? resolveIcon(searchConfig.icon) : undefined,
					iconStyle: 'grayed',
					svg: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
					url,
					actions: linkActions('web', url, true)
				});
			}
			if (fb.length) out.push({ id: 'fallbacks', label: 'Use “' + (q.length > 24 ? q.slice(0, 24) + '…' : q) + '” with…', items: fb });
		}
		return out;
	});

	const flatItems = $derived(sections.flatMap((s) => s.items));
	let selectedKey = $state(null);
	let panelOpen = $state(false);
	let panelIndex = $state(0);
	let resultsEl = $state();

	// Keep a valid selection. Until the user arrows away, it tracks the top
	// row, so results that arrive late (and sort above the fallbacks) take it.
	let userMoved = false;
	$effect(() => {
		const keys = flatItems.map((i) => i.key);
		const cur = untrack(() => selectedKey);
		if (!userMoved || !keys.includes(cur)) selectedKey = keys[0] ?? null;
	});
	$effect(() => {
		query;
		panelOpen = false;
		userMoved = false;
		untrack(closeDetail);
	});

	function moveSelection(delta) {
		const keys = flatItems.map((i) => i.key);
		if (!keys.length) return;
		const i = keys.indexOf(selectedKey);
		selectedKey = keys[(i + delta + keys.length) % keys.length];
		userMoved = true;
	}

	function runItem(item, e) {
		if (!item) return;
		const mod = e && (e.metaKey || e.ctrlKey);
		// Mouse: Cmd/Ctrl-click and middle-click mean "new tab", as on a link.
		if (item.url && e && 'button' in e && (mod || e.button === 1)) {
			noteOpen(item.key);
			openUrl(item.url, true);
			finish();
			return;
		}
		const action = mod && item.actions[1] ? item.actions[1] : item.actions[0];
		action?.run();
	}

	const isPaletteOpen = $derived(inlineOpen);

	// Desktop landing page: the first keystroke anywhere starts a search.
	function typeAnywhere(e) {
		if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key.length !== 1 || e.key === ' ' || e.key === '/') return;
		const el = document.activeElement;
		if (el && el !== document.body && el.tagName !== 'A' && el.tagName !== 'BUTTON') return;
		if (document.querySelector('[aria-modal="true"]')) return;
		if (window.matchMedia('(pointer: coarse)').matches) return;
		e.preventDefault();
		query = e.key;
		inputEl?.focus();
		inlineOpen = true;
		handleInput();
	}

	onMount(() => {
		ensureIntegrationsLoaded();
		safeTop = safeAreaTop();
		recomputeResultsMaxHeight();
		const onResize = () => {
			safeTop = safeAreaTop();
			recomputeResultsMaxHeight();
		};
		window.addEventListener('resize', onResize);

		// ?q= deep link (browser search engine / OpenSearch): open the
		// launcher pre-filled, then drop the parameter from the address bar.
		const params = new URLSearchParams(window.location.search);
		const q0 = params.get('q');
		if (q0) {
			query = q0;
			inlineOpen = true;
			inputEl?.focus();
			params.delete('q');
			const rest = params.toString();
			history.replaceState(history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
		}

		function onClickOutside(e) {
			if (inlineOpen && containerEl && !containerEl.contains(e.target)) {
				inlineOpen = false;
				panelOpen = false;
			}
		}
		function onKeydown(e) {
			// ⌘K / Ctrl+K — open search from anywhere; inside the open
			// launcher it toggles the action panel instead.
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
				e.preventDefault();
				if (inlineOpen && document.activeElement === inputEl && selectedKey) {
					panelOpen = !panelOpen;
					return;
				}
				inputEl?.focus();
				inputEl?.select();
				inlineOpen = true;
				return;
			}
			if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
				e.preventDefault();
				inputEl?.focus();
				return;
			}
			typeAnywhere(e);
		}
		document.addEventListener('keydown', onKeydown);
		document.addEventListener('mousedown', onClickOutside);

		// From a widget (the Calendar's upcoming events): search for the item
		// and open its details, as if it had been picked from the results.
		async function onShowDetails(e) {
			const { integrationId, title, href, detail: params, color } = e.detail || {};
			const p = inlineProviders.find((x) => x.integrationId === integrationId);
			if (!p || !params) return;
			query = title || '';
			activeScope = null;
			inlineOpen = true;
			inputEl?.focus();
			await tick();
			openDetail(`widget:${integrationId}:${title}`, p, { title, href: href || undefined, detail: params, meta: { kind: 'event', color } });
		}
		window.addEventListener('holm:show-details', onShowDetails);

		// The keyboard opening or closing changes how much room the results
		// have below the bar.
		const vv = window.visualViewport;
		const onViewport = () => recomputeResultsMaxHeight();
		vv?.addEventListener('resize', onViewport);
		vv?.addEventListener('scroll', onViewport);

		return () => {
			document.removeEventListener('keydown', onKeydown);
			document.removeEventListener('mousedown', onClickOutside);
			window.removeEventListener('holm:show-details', onShowDetails);
			window.removeEventListener('resize', onResize);
			vv?.removeEventListener('resize', onViewport);
			vv?.removeEventListener('scroll', onViewport);
		};
	});

	// Recompute when the palette opens or closes (the lift and the bar's
	// bottom edge change) and when the scope chip appears/disappears. The
	// first pass runs before paint: deferred to a frame, the panel showed
	// once at the old, shorter height and flashed a scrollbar.
	$effect(() => {
		inlineOpen;
		untrack(recomputeResultsMaxHeight);
		requestAnimationFrame(recomputeResultsMaxHeight);
	});

	function handleSubmit(e) {
		// Enter is handled in the keydown below; a submit only gets here with
		// nothing to run (no results yet), and then it is a web search.
		if (!query.trim()) e.preventDefault();
	}

	function handleFocus() {
		ensureIntegrationsLoaded();
		inlineOpen = true;
	}

	function handleInputKeydown(e) {
		if (resultsEl?.panelKey(e)) return;

		// Escape steps back one level: action panel, query, filter, scope, then close.
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			if (panelOpen) panelOpen = false;
			else if (detailView) closeDetail();
			else if (query) query = '';
			else if (activeFilter) activeFilter = null;
			else if (activeScope) activeScope = null;
			else { inlineOpen = false; inputEl?.blur(); return; }
			// Still open, so the arrows must keep working: keyboard extensions
			// (e.g. Vimium) blur a text field on Escape. After this event, so
			// after their blur.
			setTimeout(() => inputEl?.focus({ preventScroll: true }), 0);
			return;
		}
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			inlineOpen = true;
			if (detailView) { closeDetail(); return; }
			moveSelection(e.key === 'ArrowDown' ? 1 : -1);
			return;
		}
		// → opens the selected title's details (once the caret is at the end of
		// the query, so it still moves through the text), ← goes back.
		if (e.key === 'ArrowLeft' && detailView) {
			e.preventDefault();
			closeDetail();
			return;
		}
		if (e.key === 'ArrowRight' && !detailView && !e.shiftKey && inputEl?.selectionStart === query.length) {
			const item = flatItems.find((i) => i.key === selectedKey);
			if (item?.showDetail) {
				e.preventDefault();
				item.showDetail();
				return;
			}
		}
		// Backspace at empty input inside a filter → back to the app's scope
		if (e.key === 'Backspace' && activeFilter && query === '' && inputEl?.selectionStart === 0) {
			e.preventDefault();
			activeFilter = null;
			return;
		}
		// Backspace at empty input with a chip → clear the scope and put "!" back in the input
		if (e.key === 'Backspace' && activeScope && query === '' && inputEl?.selectionStart === 0) {
			e.preventDefault();
			activeScope = null;
			query = '!';
			requestAnimationFrame(() => inputEl?.setSelectionRange(1, 1));
			return;
		}
		// ⌘⇧C copies the selected item's link.
		if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
			const item = flatItems.find((i) => i.key === selectedKey);
			const copy = item?.actions.find((a) => a.label === 'Copy link');
			if (copy) { e.preventDefault(); copy.run(); }
			return;
		}
		if (e.key === 'Enter') {
			// A typed scope shortcut ("!photos") becomes a scope chip.
			const s = (query || '').trimStart();
			const m = !activeScope && s.match(/^!([a-zA-Z0-9_-]+)$/);
			if (m && shortcutMap.get(m[1].toLowerCase()) && !matchedActions.length) {
				e.preventDefault();
				activeScope = shortcutMap.get(m[1].toLowerCase());
				query = '';
				return;
			}
			// In the detail view Enter opens the title. Requesting only ever
			// happens on a click of the Request button.
			if (detail) {
				e.preventDefault();
				if (!e.repeat) detail.open?.run();
				return;
			}
			const item = flatItems.find((i) => i.key === selectedKey);
			if (item) {
				e.preventDefault();
				runItem(item, e);
			}
		}
	}

	// Auto-execute a no-arg action as soon as the bang is fully typed (no space needed),
	// provided no other bang could still extend this prefix (e.g. `!set` vs `!settings`).
	// Returns true when an action ran (and runAction has already cleared state),
	// so callers can skip any "reopen the palette" work that would otherwise
	// undo the blur/close (e.g. the search-active body dim staying on for !wall).
	function maybeAutoExecAction() {
		if (activeScope) return false;
		const s = (query || '').trimStart();
		const m = s.match(/^!([a-zA-Z0-9_-]+)\s*$/);
		if (!m) return false;
		const bang = m[1].toLowerCase();
		const hits = ACTIONS.filter((a) => a.bang === bang);
		if (!(hits.length === 1 && !hits[0].arg && !hits[0].manual)) return false;
		// Collision check — if another bang is a proper extension of this one, wait.
		const hasLongerBang = ACTIONS.some((a) => a.bang !== bang && a.bang.startsWith(bang));
		if (hasLongerBang) return false;
		runAction(hits[0]);
		return true;
	}

	function handleInput() {
		maybePromoteScope();
		if (maybeAutoExecAction()) return;
		inlineOpen = true;
	}

	// Toggle a body class while the search palette is open so the rest of
	// the dashboard can dim/blur via CSS without fighting stacking contexts.
	// Ancestors of the search bar use `transform` (fade-in-up animation),
	// which creates a containing block and breaks `position: fixed` overlays
	// placed inside the component tree — hence the body-level class.
	$effect(() => {
		if (typeof document === 'undefined') return;
		if (inlineOpen) document.body.classList.add('search-active');
		else document.body.classList.remove('search-active');
		return () => document.body.classList.remove('search-active');
	});

	// On phones the open palette is pinned under the status bar by a lift
	// measured from where the bar sits in the page, so the page must not
	// scroll underneath it: a scroll carried the input up off the screen,
	// and the lift chasing it made the scroll stutter. Fixing the body at
	// its current offset freezes the page without a jump, and closing puts
	// the scroll position back. The results list still scrolls on its own.
	$effect(() => {
		if (!inlineOpen || !window.matchMedia('(max-width: 767px)').matches) return;
		const y = window.scrollY;
		const s = document.body.style;
		Object.assign(s, { position: 'fixed', top: `-${y}px`, left: '0', right: '0' });
		return () => {
			Object.assign(s, { position: '', top: '', left: '', right: '' });
			window.scrollTo(0, y);
		};
	});

	const listId = 'launcher-list';
	const emptyText = $derived(
		(query || '').trim().startsWith('!') && !activeScope ? 'No command or scope by that name. Type ! on its own to see them all.' : ''
	);
</script>

<!-- Close when keyboard focus leaves the palette (Tab-out); click-outside is
     handled by onClickOutside. A null relatedTarget is a click on a
     non-focusable spot, which may be inside the panel, so it's ignored. -->
<div class="relative hero-search {isPaletteOpen ? 'is-open' : ''}" data-glass={glassLevel} bind:this={containerEl} style="--results-max-h: {resultsMaxHeight}px; --search-lift: {lift}px"
	onfocusout={(e) => { if (inlineOpen && e.relatedTarget && !containerEl.contains(e.relatedTarget)) { inlineOpen = false; panelOpen = false; } }}>
	<form
		class="hero-search-form relative flex items-center px-4 md:px-6"
		action={searchConfig.url}
		method="GET"
		target="_blank"
		role="search"
		onsubmit={handleSubmit}
	>
		<svg class="text-content-dim shrink-0 w-4 h-4 md:w-5 md:h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>

		{#if activeIntegration}
			<span class="scope-chip flex items-center gap-1 shrink-0 ml-2 text-[0.7rem] font-mono px-2 py-1 rounded-lg border">
				{activeIntegration.name}{#if activeFilter}<span class="text-content-dim" aria-hidden="true">›</span>{activeFilter.label}{/if}
				<button
					type="button"
					class="scope-chip-clear bg-transparent border-none cursor-pointer leading-none p-0 ml-0.5"
					onclick={() => { activeScope = null; inputEl?.focus(); }}
					aria-label="Clear scope"
				>&times;</button>
			</span>
		{/if}

		<input
			bind:this={inputEl}
			bind:value={query}
			type="text"
			name={searchConfig.param || 'q'}
			class="hero-search-input w-full h-[48px] md:h-[52px] bg-transparent border-none px-3 md:px-4 outline-none font-mono"
			placeholder={activeFilter ? `Search in ${activeFilter.label}…` : activeIntegration ? `Search in ${activeIntegration.name}…` : placeholderText}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			enterkeyhint="go"
			role="combobox"
			aria-label="Search apps, files and commands"
			aria-expanded={isPaletteOpen}
			aria-controls={listId}
			aria-autocomplete="list"
			aria-activedescendant={isPaletteOpen && selectedKey ? (panelOpen ? `${listId}-action-${panelIndex}` : `${listId}-${selectedKey}`) : undefined}
			onfocus={handleFocus}
			oninput={handleInput}
			onkeydown={handleInputKeydown}
		/>

		{#if query}
			<button type="button" class="clear-btn text-sm md:text-base bg-transparent border-none cursor-pointer px-1" aria-label="Clear search" onclick={() => { query = ''; inputEl?.focus(); }}>&times;</button>
		{:else}
			<kbd class="hero-search-kbd hidden md:inline-flex items-center gap-0.5 text-[0.7rem] py-1 px-2 rounded border font-mono shrink-0">{#if macKeys}<svg class="kbd-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Command"><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z"/></svg>{:else}Ctrl&nbsp;{/if}K</kbd>
		{/if}
		<!-- One thin line while an app is still searching, so "still looking"
		     and "found nothing" don't look the same. -->
		{#if isPaletteOpen && sections.some((s) => s.loading)}<span class="search-progress" aria-hidden="true"></span>{/if}
	</form>

	{#if isPaletteOpen}
		<SearchResults
			bind:this={resultsEl}
			{sections}
			{selectedKey}
			{panelOpen}
			bind:panelIndex
			{listId}
			{emptyText}
			{detail}
			ondetailclose={() => { closeDetail(); inputEl?.focus(); }}
			ontaskcheck={checkTask}
			onselect={(k) => { selectedKey = k; userMoved = true; }}
			onrun={runItem}
			onaction={(item, action) => { panelOpen = false; action.run(); }}
			answerCopied={answerCopied?.query === query ? answerCopied.index : -1}
			oncopyanswer={(item, i) => item.actions[i]?.run()}
			onpanel={() => { panelOpen = !panelOpen; inputEl?.focus(); }}
		/>
	{/if}
</div>
