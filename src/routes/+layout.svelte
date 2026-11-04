<script>
	import '../app.css';
	import { setContext } from 'svelte';
	let { children, data } = $props();

	const config = data.config;
	setContext('config', config);

	const brandName = config?.branding?.name || 'Holm';
	const brandDesc = config?.branding?.description || 'Self-hosted dashboard';
	const themeColor = config?.branding?.theme_color || '#09090b';
	const accentColor = config?.branding?.accent_color || '#f5b942';
	const shortName = config?.branding?.short_name || brandName.toLowerCase();
	const fontFamily = config?.branding?.font?.family || 'JetBrains Mono';
	// JetBrains Mono ships in the bundle (app.css); a url is only needed for a custom font.
	const fontUrl = config?.branding?.font?.url || null;
</script>

<svelte:head>
	<title>{brandName}</title>
	<meta name="description" content={brandDesc}>
	<meta property="og:title" content={brandName}>
	<meta property="og:description" content={brandDesc}>
	<meta property="og:type" content="website">
	<meta name="twitter:card" content="summary">
	<meta name="twitter:title" content={brandName}>
	<meta name="twitter:description" content={brandDesc}>
	<meta name="theme-color" content={themeColor}>
	<meta name="apple-mobile-web-app-title" content={shortName}>
	{#if fontUrl}
		<link href={fontUrl} rel="stylesheet">
	{/if}
	{@html `<style>:root { --font-family: '${fontFamily}', monospace; --accent: ${accentColor}; } body { font-family: var(--font-family); }</style>`}
</svelte:head>

<div class="pwa-top-strip" aria-hidden="true"></div>
{@render children()}
