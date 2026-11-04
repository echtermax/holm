<script>
	import { marked } from 'marked';
	import AppIcon from './AppIcon.svelte';
	import Keys from './Keys.svelte';

	// Raycast-style result list. SearchBar owns the data, the selection and
	// the keyboard; this only renders. Focus never leaves the input: the
	// selected row is announced through aria-activedescendant.
	//
	// sections: [{ id, label, layout: 'list'|'grid'|'poster'|'tracks', loading, error, items }]
	// item:     { key, title, subtitle?, accessory?, appIcon?, svg?, thumbnail?, kind?, color?, badge?, play?,
	//             iconStyle?, play?: { run }, request?: { label, busy, run }, actions: [{ label, hint?, run }],
	//             answer?: { from: { value, label }, to: { value, label }, also?: [{ value, label }] } }
	let {
		sections = [],
		selectedKey = null,
		panelOpen = false,
		panelIndex = $bindable(0),
		listId = 'launcher-list',
		emptyText = '',
		detail = null,
		ondetailclose = () => {},
		ontaskcheck = () => {},
		onselect = () => {},
		onrun = () => {},
		onaction = () => {},
		onpanel = () => {},
		answerCopied = -1,
		oncopyanswer = () => {}
	} = $props();

	const flat = $derived(sections.flatMap((s) => s.items));
	// The ⌘K panel floats over the list, so a short list (one web result) would
	// cut it off at the top: the launcher grows to fit it while it's open. 54px
	// is its offset above the footer (46px) plus a gap above it.
	let actionsHeight = $state(0);
	const selected = $derived(flat.find((i) => i.key === selectedKey) || null);
	$effect(() => {
		if (panelOpen) panelIndex = 0;
	});

	export function panelKey(e) {
		if (!panelOpen || !selected) return false;
		const n = selected.actions.length;
		if (e.key === 'ArrowDown') panelIndex = (panelIndex + 1) % n;
		else if (e.key === 'ArrowUp') panelIndex = (panelIndex - 1 + n) % n;
		else if (e.key === 'Enter') onaction(selected, selected.actions[panelIndex]);
		else return false;
		e.preventDefault();
		return true;
	}

	// Text with its https links split out, so a description's links can be
	// clicked (a meeting's join link, an agenda).
	function linkParts(text) {
		const parts = [];
		let last = 0;
		for (const m of text.matchAll(/https:\/\/[^\s<>"]+/g)) {
			const href = m[0].replace(/[).,;:!?]+$/, '');
			if (m.index > last) parts.push({ text: text.slice(last, m.index) });
			parts.push({ href });
			last = m.index + href.length;
		}
		if (last < text.length) parts.push({ text: text.slice(last) });
		return parts;
	}

	const KIND_ICONS = {
		document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>',
		file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
		card: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7h8"/><path d="M8 11h4"/>',
		bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
		photo: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
		media: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="m10 8 6 4-6 4Z"/>',
		event: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 2v4"/><path d="M16 2v4"/>',
		model: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
		collection: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
		tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>'
	};

	function thumbFailed(e) {
		e.currentTarget.classList.remove('is-loading');
		e.currentTarget.style.display = 'none';
	}

	// In the white and grey styles the source icon is the app's flat mark; an
	// app without one shows its colour icon as a silhouette (same filter). A
	// failed icon hides.
	function sourceIconFailed(e, fallback) {
		const img = e.currentTarget;
		if (fallback && img.getAttribute('src') !== fallback) img.src = fallback;
		else img.parentElement.style.display = 'none';
	}

	// Thumbnails start hidden behind a shimmer and fade in once decoded. A
	// cached image can finish before the handler is attached, so check
	// `complete` on mount too.
	function thumbLoading(node) {
		const done = () => node.classList.remove('is-loading');
		if (node.complete && node.naturalWidth) done();
		else node.addEventListener('load', done, { once: true });
	}

	// Rows ease in as they arrive, and the list slides back in when a title's
	// details close. Closing remounts the list, so `back` keeps its rows from
	// replaying; it lasts only for the render that remounts them.
	let back = false;
	let hadDetail = false;
	$effect.pre(() => {
		back = hadDetail && !detail;
		hadDetail = !!detail;
		if (back) queueMicrotask(() => (back = false));
	});
	function enter(node, cls) {
		if (!cls) return;
		node.classList.add(cls);
		const done = (e) => {
			if (e.target !== node) return;
			node.classList.remove(cls);
			node.removeEventListener('animationend', done);
		};
		node.addEventListener('animationend', done);
	}

	// Kinds whose detail view is compact (an icon, not a poster), also while loading.
	const COMPACT = new Set(['event', 'document', 'card']);

	// A memo's Markdown or a work item's HTML, sanitized in the browser (on the
	// server, DOMPurify runs on jsdom, which leaks per call). Links open in a
	// new tab; images without an absolute address (Plane's own assets) go.
	// With `checklist`, the boxes are live: a change asks `ontoggle`, the box
	// stays as saved until the Markdown says otherwise, and `states` marks a
	// box saving (a spinner in its place) or failed (an error with Retry).
	function richText(node, opts) {
		let o = opts;
		let purify;
		let shown;
		const boxes = () => [...node.querySelectorAll('input[type=checkbox]')];
		const textOf = (li) => {
			const copy = li.cloneNode(true);
			copy.querySelectorAll('ul, ol, .launcher-check-error').forEach((n) => n.remove());
			return copy.textContent.trim();
		};
		function paint() {
			if (!purify) return;
			const source = o.markdown != null ? marked.parse(o.markdown, { gfm: true, breaks: true }) : o.html || '';
			if (source !== shown) {
				shown = source;
				node.innerHTML = purify.sanitize(source);
				node.querySelectorAll('a[href]').forEach((a) => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
				node.querySelectorAll('img').forEach((img) => { if (!/^https?:\/\//.test(img.getAttribute('src') || '')) img.remove(); });
			}
			node.querySelectorAll('.launcher-check-spin, .launcher-check-error').forEach((n) => n.remove());
			boxes().forEach((box, i) => {
				const li = box.closest('li');
				box.disabled = !o.checklist;
				if (!li) return;
				li.classList.remove('is-saving', 'is-error');
				box.setAttribute('aria-label', textOf(li));
				const st = o.states?.[i];
				if (st === 'saving') {
					li.classList.add('is-saving');
					box.insertAdjacentHTML('beforebegin', '<span class="launcher-check-spin" role="status" aria-label="Saving"></span>');
				} else if (st?.error) {
					li.classList.add('is-error');
					const err = document.createElement('span');
					err.className = 'launcher-check-error';
					err.setAttribute('role', 'alert');
					err.textContent = `Couldn’t save. ${st.error} `;
					const retry = document.createElement('button');
					retry.type = 'button';
					retry.textContent = 'Retry';
					retry.dataset.retry = String(i);
					err.append(retry);
					li.append(err);
				}
			});
		}
		function onchange(e) {
			const box = e.target;
			const i = boxes().indexOf(box);
			if (i < 0 || !o.checklist) return;
			const checked = box.checked;
			box.checked = !checked; // stays as saved until the save lands
			o.ontoggle(i, checked, textOf(box.closest('li')));
		}
		function onclick(e) {
			const retry = e.target.closest?.('[data-retry]');
			const st = retry && o.states?.[Number(retry.dataset.retry)];
			if (st?.error) o.ontoggle(Number(retry.dataset.retry), st.checked, st.text);
		}
		// Focus stays in the search input, as for every other button here.
		const keepFocus = (e) => { if (e.target.closest?.('input, button')) e.preventDefault(); };
		node.addEventListener('change', onchange);
		node.addEventListener('click', onclick);
		node.addEventListener('mousedown', keepFocus);
		import('isomorphic-dompurify').then(({ default: DOMPurify }) => { purify = DOMPurify; paint(); });
		return {
			update(next) { o = next; paint(); },
			destroy() {
				node.removeEventListener('change', onchange);
				node.removeEventListener('click', onclick);
				node.removeEventListener('mousedown', keepFocus);
			}
		};
	}

	// Request → Requested pops once, when the request lands; a title that was
	// already requested opens without it.
	function landed(node, done) {
		return {
			update(now) {
				if (now && !done) enter(node, 'is-landed');
				done = now;
			}
		};
	}

	function scrollIntoView(node, isSelected) {
		const run = (sel) => { if (sel) node.scrollIntoView({ block: 'nearest' }); };
		run(isSelected);
		return { update: run };
	}
</script>

<div class="launcher-panel hero-search-results" style:min-height={panelOpen && actionsHeight ? `${actionsHeight + 54}px` : null}>
	{#if detail}
		<!-- Detail view: one title, Spotlight-style, in place of the list. -->
		<div class="launcher-scroll launcher-detail" role="region" aria-label="Details for {detail.title}">
			<!-- An event never has a backdrop, so it gets the short hero while loading
			     too, rather than a movie-sized one that collapses when it lands. -->
			<div class="launcher-detail-hero" class:is-empty={!detail.data?.backdrop && (!detail.loading || COMPACT.has(detail.r?.meta?.kind))}>
				{#if detail.data?.backdrop}
					<img class="launcher-detail-backdrop is-loading" use:thumbLoading src={detail.data.backdrop} alt="" referrerpolicy="no-referrer" onerror={thumbFailed} />
				{/if}
				<button type="button" class="launcher-detail-back" onmousedown={(e) => e.preventDefault()} onclick={ondetailclose}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
					Results
				</button>
			</div>
			<!-- An event, memo or work item is compact: its icon, then title and facts, with the buttons on the right. -->
			<div class="launcher-detail-body" class:is-compact={!detail.thumbnail && COMPACT.has(detail.r?.meta?.kind)}>
				<div class="launcher-detail-poster launcher-thumb-wrap" class:is-icon={!detail.thumbnail && COMPACT.has(detail.r?.meta?.kind)} style:color={detail.r?.meta?.color}>
					{#if detail.thumbnail}
						<img class="is-loading" use:thumbLoading src={detail.thumbnail} alt="" referrerpolicy="no-referrer" onerror={thumbFailed} />
					{/if}
					<svg class="launcher-thumb-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{@html KIND_ICONS[detail.r?.meta?.kind] || KIND_ICONS.media}</svg>
				</div>
				<div class="launcher-detail-info">
					<div class="launcher-detail-head">
						<h3 class="launcher-detail-title">{detail.title}</h3>
						{#if detail.data}
							<div class="launcher-detail-facts">
								{#each detail.data.facts || [] as fact}<span>{fact}</span>{/each}
								{#if detail.data.pinned}<span class="launcher-detail-pinned"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>Pinned</span>{/if}
								{#if detail.data.rating}
									<span class="launcher-detail-rating">
										<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>
										{detail.data.rating}
									</span>
								{/if}
							</div>
							{#if detail.data.genres?.length}
								<div class="launcher-tags">{#each detail.data.genres as g}<span class="launcher-tag">{g}</span>{/each}</div>
							{/if}
						{:else if detail.r?.subtitle}
							<div class="launcher-detail-facts"><span>{detail.r.subtitle}</span></div>
						{/if}
						{#if detail.badge}<div class="launcher-error launcher-detail-error">{detail.badge}</div>{/if}
					</div>
					<div class="launcher-detail-buttons">
						{#if detail.request}
							<button
								type="button"
								class="launcher-detail-btn is-primary"
								class:is-done={detail.request.done}
								use:landed={detail.request.done}
								disabled={detail.request.busy || detail.request.done}
								onmousedown={(e) => e.preventDefault()}
								onclick={() => detail.request.run?.()}
							>
								{#if detail.request.done}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>{/if}
								{detail.request.busy ? `${detail.request.label}…` : detail.request.label}
							</button>
						{/if}
						{#if detail.link}
							<button type="button" class="launcher-detail-btn" class:is-primary={!detail.request} onmousedown={(e) => e.preventDefault()} onclick={detail.link.run}>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/></svg>
								{detail.link.label}
							</button>
						{/if}
						{#if detail.open}
							<button type="button" class="launcher-detail-btn" class:is-primary={!detail.request && !detail.link} onmousedown={(e) => e.preventDefault()} onclick={detail.open.run}>
								{#if detail.open.label.startsWith('Play')}<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>{/if}
								{detail.open.label}
							</button>
						{/if}
					</div>
				</div>
			</div>
			{#if detail.loading}
				<div class="launcher-detail-text launcher-detail-placeholder" role="status" aria-label="Loading details"><span class="launcher-skeleton-line"></span><span class="launcher-skeleton-line"></span><span class="launcher-skeleton-line is-short"></span></div>
			{:else if detail.error}
				<div class="launcher-error">{detail.error}</div>
			{:else if detail.data}
				{#if detail.data.fields?.length}
					<dl class="launcher-detail-fields">
						{#each detail.data.fields as f}
							<dt>{f.label}</dt>
							<dd>
								{#if f.chips}
									{#each f.chips as c}<span class="launcher-field-chip">{#if c.color}<i style:background={c.color}></i>{/if}{#if c.initials}<b>{c.initials}</b>{/if}{c.text}</span>{/each}
								{:else}
									<span class="launcher-field-value" class:is-warn={f.warn}>{#if f.color}<i style:background={f.color}></i>{/if}{f.value}</span>
								{/if}
							</dd>
						{/each}
					</dl>
				{/if}
				{#if detail.data.markdown || detail.data.html}
					<div
						class="launcher-detail-md"
						use:richText={{ markdown: detail.data.markdown ?? null, html: detail.data.html, checklist: !!detail.data.checklist, states: detail.taskStates, ontoggle: ontaskcheck }}
					></div>
				{/if}
				<div class="launcher-detail-text">
					{#if detail.data.tagline}<p class="launcher-detail-tagline">{detail.data.tagline}</p>{/if}
					{#if detail.data.overview}<p>{#each linkParts(detail.data.overview) as part}{#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.href}</a>{:else}{part.text}{/if}{/each}</p>{/if}
					{#if detail.data.cast?.length}
						<p class="launcher-detail-cast"><span>Cast</span> {detail.data.cast.join(' · ')}</p>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
	<div class="launcher-scroll" id={listId} role="listbox" aria-label="Results" use:enter={back && 'is-back'}>
		{#each sections as section (section.id)}
			{#if section.items.length || section.error || section.skeleton}
				<div class="launcher-section" role="group" aria-labelledby="{listId}-{section.id}">
					<div class="launcher-section-label" id="{listId}-{section.id}">
						<span>{section.label}</span>
					</div>
					{#if section.error}
						<div class="launcher-error">{section.error}</div>
					{/if}
					<div class={section.layout === 'grid' ? 'launcher-grid' : section.layout === 'poster' ? 'launcher-posters' : section.layout === 'tracks' ? 'launcher-tracks' : section.layout === 'video' ? 'launcher-videos' : section.layout === 'answer' ? 'launcher-answers' : 'launcher-rows'}>
						{#if section.skeleton}
							{#each [0, 1, 2] as n}
								<div class="launcher-item is-video is-skeleton" aria-hidden="true">
									<div class="launcher-thumb-wrap launcher-skeleton-block"></div>
									<span class="launcher-skeleton-line"></span>
									<span class="launcher-skeleton-line is-short"></span>
								</div>
							{/each}
						{/if}
						{#each section.items as item, i (item.key)}
							{@const isSel = item.key === selectedKey}
							<!-- Keyboard lives on the search input (combobox + aria-activedescendant). -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id="{listId}-{item.key}"
								role="option"
								aria-selected={isSel}
								aria-label={section.layout === 'list' ? undefined : item.answer ? `${item.answer.from.value} = ${[item.answer.to, ...(item.answer.also || [])].map((r) => r.value).join(' = ')}` : [item.title, item.subtitle, item.badge].filter(Boolean).join(', ')}
								tabindex="-1"
								class="launcher-item {section.layout === 'grid' ? 'is-tile' : section.layout === 'poster' ? 'is-poster' : section.layout === 'tracks' ? 'is-track' : section.layout === 'video' ? 'is-video' : section.layout === 'answer' ? 'is-answer' : 'is-row'}"
								class:is-selected={isSel}
								use:scrollIntoView={isSel}
								use:enter={!back && 'is-rising'}
								style:--i={Math.min(i, 5)}
								onpointermove={() => { if (!isSel) onselect(item.key); }}
								onmousedown={(e) => e.preventDefault()}
								onclick={(e) => onrun(item, e)}
								onauxclick={(e) => { if (e.button === 1) { e.preventDefault(); onrun(item, e); } }}
							>
								{#if item.answer}
									<!-- Instant answer: the question on the left, the answer on the right. -->
									<div class="launcher-answer-side">
										<span class="launcher-answer-value">{item.answer.from.value}</span>
										<span class="launcher-answer-label">{item.answer.from.label}</span>
									</div>
									<svg class="launcher-answer-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>
									<div class="launcher-answer-results">
										{#each [item.answer.to, ...(item.answer.also || [])] as result, j}
											<!-- Each value copies itself; the card copies the first. -->
											<button
												type="button"
												tabindex="-1"
												class="launcher-answer-side launcher-answer-copy"
												class:is-copied={answerCopied === j}
												title="Copy {result.value}"
												onclick={(e) => { e.stopPropagation(); oncopyanswer(item, j); }}
											>
												<span class="launcher-answer-value is-result">{result.value}</span>
												<span class="launcher-answer-label">{answerCopied === j ? '✓ Copied' : result.label}</span>
											</button>
										{/each}
									</div>
								{:else if section.layout === 'tracks'}
									<!-- Music: small square cover, title over details. -->
									<div class="launcher-icon-box launcher-track-art">
										{#if item.more}
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{@html item.svg}</svg>
										{:else}
											<svg class="launcher-thumb-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{@html KIND_ICONS[item.kind] || KIND_ICONS.file}</svg>
											{#if item.thumbnail}
												<img class="is-loading" use:thumbLoading src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={thumbFailed} />
											{/if}
											{#if item.play}
												<button
													type="button"
													class="launcher-art-action"
													tabindex="-1"
													aria-label="Play {item.title}"
													onmousedown={(e) => e.preventDefault()}
													onclick={(e) => { e.stopPropagation(); item.play.run(); }}
												>
													<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>
												</button>
											{/if}
										{/if}
									</div>
									<span class="launcher-text">
										<span class="launcher-title">{item.title}</span>
										<!-- An album or playlist that couldn't load says so in place of its details. -->
										{#if item.badge}<span class="launcher-subtitle is-error">{item.badge}</span>
										{:else if item.subtitle}<span class="launcher-subtitle">{item.subtitle}</span>{/if}
									</span>
								{:else if item.more && section.layout !== 'list'}
									<div class="launcher-thumb-wrap launcher-more">{item.title}</div>
								{:else if section.layout === 'video'}
									<!-- Video: 16:9 thumbnail with its length, title, channel, then views and age. -->
									<div class="launcher-thumb-wrap">
										<svg class="launcher-thumb-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/></svg>
										{#if item.thumbnail}
											<img class="is-loading" use:thumbLoading src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={thumbFailed} />
										{/if}
										{#if item.duration}<span class="launcher-duration">{item.duration}</span>{/if}
									</div>
									<div class="launcher-poster-title">{item.title}</div>
									{#if item.subtitle}<div class="launcher-poster-sub">{item.subtitle}</div>{/if}
									{#if item.info}<div class="launcher-poster-sub">{item.info}</div>{/if}
								{:else if section.layout === 'grid' || section.layout === 'poster'}
									<div class="launcher-thumb-wrap">
										{#if item.thumbnail}
											<img class="is-loading" use:thumbLoading src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={thumbFailed} />
										{/if}
										<svg class="launcher-thumb-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{@html KIND_ICONS[item.kind] || KIND_ICONS.file}</svg>
										{#if item.play}
											<button
												type="button"
												class="launcher-art-action"
												tabindex="-1"
												aria-label="Play {item.title}"
												onmousedown={(e) => e.preventDefault()}
												onclick={(e) => { e.stopPropagation(); item.play.run(); }}
											>
												<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>
											</button>
										{:else if item.request}
											<button
												type="button"
												class="launcher-request"
												class:is-busy={item.request.busy}
												class:is-done={item.request.done}
												use:landed={item.request.done}
												tabindex="-1"
												disabled={item.request.busy || item.request.done}
												onmousedown={(e) => e.preventDefault()}
												onclick={(e) => { e.stopPropagation(); item.request.run?.(); }}
											>
												{#if item.request.busy}
													<span class="launcher-spinner" aria-hidden="true"></span>
												{:else if item.request.done}
													<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
												{:else}
													<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
												{/if}
												{item.request.busy ? 'Requesting' : item.request.label}
											</button>
										{/if}
										{#if item.badge}<span class="launcher-badge">{item.badge}</span>{/if}
										{#if item.source}<span class="launcher-source is-{item.source.style}" title={item.source.name}><img src={item.source.icon} alt={item.source.name} onerror={(e) => sourceIconFailed(e, item.source.fallback)} /></span>{/if}
									</div>
									{#if section.layout === 'poster'}
										<div class="launcher-poster-title">{item.title}</div>
										{#if item.subtitle}<div class="launcher-poster-sub">{item.subtitle}</div>{/if}
									{/if}
								{:else}
									<span class="launcher-icon">
										{#if item.appIcon !== undefined}
											<AppIcon icon={item.appIcon} name={item.title} size="w-[18px] h-[18px]" wrapSize="w-7 h-7" iconStyle={item.iconStyle || 'colored'} wrap />
										{:else if item.thumbnail}
											<span class="launcher-icon-box">
												<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{@html KIND_ICONS[item.kind] || KIND_ICONS.file}</svg>
												<img class="is-loading" use:thumbLoading src={item.thumbnail} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={thumbFailed} />
											</span>
										{:else}
											<span class="launcher-icon-box" style:color={item.color}>
												<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{@html item.svg || KIND_ICONS[item.kind] || KIND_ICONS.file}</svg>
											</span>
										{/if}
									</span>
									<span class="launcher-text">
										<span class="launcher-title">{item.title}</span>
										{#if item.subtitle}<span class="launcher-subtitle">{item.subtitle}</span>{/if}
									</span>
									{#if item.progress}<span class="launcher-progress" class:is-done={item.progress.done === item.progress.total}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/></svg>{item.progress.done}/{item.progress.total} done</span>{/if}
									{#if item.tags?.length}
										<span class="launcher-tags">
											{#each item.tags.slice(0, 3) as tag}<span class="launcher-tag">{tag}</span>{/each}
										</span>
									{/if}
									<!-- Outside .launcher-tags so it still shows on phones. -->
									{#if item.badge}<span class="launcher-tag">{item.badge}</span>{/if}
									{#if item.accessory}<span class="launcher-accessory">{item.accessory}</span>{/if}
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/each}
		{#if !flat.length && emptyText && !sections.some((s) => s.loading)}
			<div class="launcher-empty">{emptyText}</div>
		{/if}
	</div>
	{/if}

	<!-- Footer bar: what Enter does, and where the rest of the actions live. -->
	<div class="launcher-footer">
		{#if detail}
			<span class="launcher-footer-hint">
				<Keys keys="←" /> <Keys keys="esc" /> back
			</span>
			{@const enter = detail.open}
			{#if enter}
				<button type="button" class="launcher-footer-btn" onmousedown={(e) => e.preventDefault()} onclick={() => enter.run()}>
					{enter.label} <Keys keys="↵" />
				</button>
			{/if}
		{:else}
		<span class="launcher-footer-hint">
			<Keys keys="↑ ↓" /> to move
		</span>
		{#if selected}
			<button type="button" class="launcher-footer-btn" onmousedown={(e) => e.preventDefault()} onclick={(e) => onrun(selected, e)}>
				{selected.actions[0]?.label || 'Open'} <Keys keys="↵" />
			</button>
			{#if selected.actions.length > 1}
				<span class="launcher-footer-sep"></span>
				<button type="button" class="launcher-footer-btn" aria-expanded={panelOpen} onmousedown={(e) => e.preventDefault()} onclick={onpanel}>
					Actions <Keys keys="⌘ K" />
				</button>
			{/if}
		{/if}
		{/if}
	</div>

	{#if panelOpen && selected && !detail}
		<div class="launcher-actions" role="menu" aria-label="Actions for {selected.title}" bind:offsetHeight={actionsHeight}>
			<div class="launcher-actions-title">{selected.title}</div>
			{#each selected.actions as action, i}
				<button
					type="button"
					id="{listId}-action-{i}"
						role="menuitem"
					class="launcher-action"
					class:is-selected={i === panelIndex}
					onpointermove={() => (panelIndex = i)}
					onmousedown={(e) => e.preventDefault()}
					onclick={() => onaction(selected, action)}
				>
					<span>{action.label}</span>
					{#if action.hint}<span class="launcher-action-hint"><Keys keys={action.hint} /></span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
