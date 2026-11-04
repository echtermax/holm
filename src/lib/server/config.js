import { readFileSync, statSync, watchFile } from 'fs';
import { resolve, dirname } from 'path';
import yaml from 'js-yaml';
import { marked } from 'marked';
import { version as APP_VERSION } from '../../../package.json';
import { getBrandColor } from './brandColors.js';
import { canSeeApp, canSeeSection, sectionsFor } from './appAccess.js';
import { latestRelease, updateFor } from './updateCheck.js';
import { substituteEnvVars } from './envVars.js';
import { searchOnFocusError } from '../searchOnFocus.js';
import { searchLookError } from '../searchLook.js';
import { themeBackgroundError } from '../themeBackground.js';
import { wallpapersError, wallpaperCount, wallpaperVersion, hasResizer } from './wallpapers.js';
import { healthError, healthSource, appHealth } from './health/config.js';

let _config = null;

// Watch config file for changes and invalidate cache
const configPath = process.env.CONFIG_PATH || 'config.yml';
try {
	watchFile(configPath, { interval: 2000 }, () => {
		console.log('[holm] Config file changed, reloading on next request');
		_config = null;
	});
} catch { /* file may not exist yet */ }

// Fails closed: a missing, unreadable or invalid config throws, so Holm
// refuses to start (and errors on each request after a bad edit) instead of
// running on defaults with sign-in switched off.
function loadConfig() {
	if (_config) return _config;

	let raw;
	try {
		raw = readFileSync(configPath, 'utf-8');
	} catch (err) {
		throw new Error(`Could not read config at ${configPath} (${err.message}). Copy config.minimal.yml to config.yml to get started.`);
	}

	let parsed;
	try {
		parsed = yaml.load(raw);
	} catch (err) {
		throw new Error(`Invalid YAML in ${configPath}: ${err.message}`);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`${configPath} must be a YAML mapping of settings`);
	}
	const config = substituteEnvVars(parsed);
	const invalid = searchOnFocusError(config.search) || searchLookError(config.search) || themeBackgroundError(config.branding) || wallpapersError(config.wallpapers) || healthError(config, flatApps(config.apps));
	if (invalid) throw new Error(`Invalid setting in ${configPath}: ${invalid}`);
	_config = config;
	return _config;
}

function getDefaults() {
	return {
		branding: { name: 'Holm', short_name: 'holm', description: 'Self-hosted dashboard', logo: null, favicon: null, font: { family: 'JetBrains Mono', url: null }, theme_color: '#09090b', accent_color: '#f5b942', show_footer: true },
		auth: { enabled: false, oidc: {}, password_change_url: null, registration: { enabled: false, url: null } },
		apps: [],
		customization: { enabled: false },
		search: { enabled: true, url: 'https://www.google.com/search', param: 'q' },
		wallpapers: { enabled: false },
		weather: { enabled: false },
		onboarding: { enabled: false },
		privacy: { enabled: false },
		tips: { enabled: false },
		database: { enabled: true },
	};
}

export function getConfig() {
	return loadConfig();
}

export function getBranding() {
	return getConfig().branding || getDefaults().branding;
}

export function getAuth() {
	return getConfig().auth || getDefaults().auth;
}

// Returns the configured apps as a flat list. Tolerates both the new shape
// (apps: [{id, ...}]) and the legacy nested shape (apps: [{category, items}]) —
// the legacy form is silently flattened so existing operator configs keep
// loading. Each item is enriched in place with brand color metadata.
function flatApps(raw = []) {
	const isLegacy = Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]?.items);
	return isLegacy ? raw.flatMap((c) => (Array.isArray(c?.items) ? c.items : [])) : Array.isArray(raw) ? raw : [];
}

export function getAppsConfig() {
	const items = flatApps(getConfig().apps || []);
	for (const item of items) {
		const brand = getBrandColor(item.icon, item.tile_color);
		if (brand) {
			item.brandColor = brand.brandColor;
			item.brandFg = brand.brandFg;
			item.brandExplicit = !!item.tile_color;
		}
	}
	return items;
}

export function getSearchConfig() {
	return getConfig().search || { enabled: true, url: 'https://www.google.com/search', param: 'q' };
}

export function getWallpaperConfig() {
	return getConfig().wallpapers || { enabled: true, source: 'gitlab', count: 326 };
}

export function getWeatherConfig() {
	return getConfig().weather || { enabled: true, default_lat: 40.7128, default_lon: -74.0060 };
}

// Onboarding, the privacy notice and "What's new" for one user: off for
// anyone outside the section's `groups` (with auth off, the guest has none).
export function getOnboardingConfig(user) {
	return sectionsFor(getConfig(), user).onboarding;
}

export function getPrivacyConfig(user) {
	return sectionsFor(getConfig(), user).privacy;
}

export function getChangelogConfig(user) {
	return sectionsFor(getConfig(), user).changelog;
}

export function getTipsConfig() {
	return getConfig().tips || { enabled: false };
}

// Integrations store each user's credentials in the database, so with
// database.enabled: false they are switched off rather than appearing to
// connect while nothing is saved.
let warnedIntegrationsWithoutDb = false;
export function getIntegrationsConfig() {
	const config = getConfig();
	if (config.database?.enabled === false) {
		if (config.integrations && !warnedIntegrationsWithoutDb) {
			warnedIntegrationsWithoutDb = true;
			console.warn('[holm] config: integrations need the database; ignoring integrations: because database.enabled is false');
		}
		return {};
	}
	return config.integrations || {};
}

// Rendered once per file version: isomorphic-dompurify runs on jsdom, which
// leaks ~110 KB per sanitize call, and this runs on every layout load.
let _privacyCache = { key: null, html: null };

async function loadPrivacyHtml(privacy) {
	const file = privacy.enabled && privacy.file;
	if (!file) return null;
	try {
		const configPath = process.env.CONFIG_PATH || 'config.yml';
		const base = dirname(resolve(configPath));
		const path = resolve(base, file);
		const key = `${path}:${statSync(path).mtimeMs}`;
		if (_privacyCache.key === key) return _privacyCache.html;
		const md = readFileSync(path, 'utf-8');
		const { default: DOMPurify } = await import('isomorphic-dompurify');
		const html = DOMPurify.sanitize(marked.parse(md));
		_privacyCache = { key, html };
		return html;
	} catch {
		return null;
	}
}

// The picker needs only the switch and how many there are, never the source.
function clientWallpapers(config) {
	const enabled = config.wallpapers?.enabled ?? false;
	const w = config.wallpapers || {};
	if (!enabled) return { enabled, count: 0, resized: false };
	return { enabled, count: wallpaperCount(w), v: wallpaperVersion(w), resized: hasResizer(w) };
}

// Returns a client-safe subset (no secrets).
// When authenticated is false, only returns what the login page needs —
// branding, auth settings, privacy (for T&C), and wallpaper flag.
// Everything else (apps, integrations, search, etc.) stays server-side.
export async function getClientConfig({ authenticated = true, user = null } = {}) {
	const config = getConfig();
	const auth = {
		enabled: config.auth?.enabled ?? false,
		registration: config.auth?.registration || { enabled: false, url: null }
	};

	const privacy = getPrivacyConfig(user);
	if (!authenticated) {
		return {
			branding: getBranding(),
			auth,
			privacy: { ...privacy, html: await loadPrivacyHtml(privacy) },
			wallpapers: clientWallpapers(config)
		};
	}

	const visibleApps = getAppsConfig().filter((app) => canSeeApp(app, user));
	return {
		branding: getBranding(),
		auth: { ...auth, password_change_url: config.auth?.password_change_url || null },
		// How an app is checked stays on the server; /api/health has the answers.
		apps: visibleApps.map(({ health, ...app }) => app),
		// Whether any of them has a check, so Configure offers the switch.
		health: { enabled: visibleApps.some((app) => appHealth(app, healthSource(config))) },
		customization: { enabled: config.customization?.enabled ?? false },
		search: getSearchConfig(),
		wallpapers: clientWallpapers(config),
		weather: { enabled: config.weather?.enabled ?? false },
		onboarding: getOnboardingConfig(user),
		privacy: { ...privacy, html: await loadPrivacyHtml(privacy) },
		tips: getTipsConfig(),
		integrations: { enabled: config.database?.enabled !== false },
		version: APP_VERSION,
		changelog: getChangelogConfig(user),
		// GitHub is only asked for someone update_check lets see the notice.
		update: canSeeSection(config.update_check, user, true) ? updateFor(APP_VERSION, latestRelease()) : null
	};
}
