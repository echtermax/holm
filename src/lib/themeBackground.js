// The household's page background for the Dark and Light themes, from
// config.yml's branding.background.dark and .light. Either can be left out
// to keep the built-in colour.
//
// Only #rrggbb is accepted. The value goes into a server-rendered <style>
// tag, so the strict format also keeps any other text out of it. The
// theme's dim text has to stay readable on the colour: at least 4.5:1
// (WCAG AA), measured against the --text-dim each theme uses in app.css.

export const THEME_BACKGROUNDS = {
	dark: { fallback: '#09090b', textDim: '#bcbcc4' },
	light: { fallback: '#ffffff', textDim: '#52525b' }
};

const MIN_CONTRAST = 4.5;
const HEX = /^#[0-9a-f]{6}$/i;

function luminance(hex) {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

// Why a config's branding.background can't be used, or null when it can.
export function themeBackgroundError(branding) {
	const bg = branding?.background;
	if (bg === undefined || bg === null) return null;
	if (typeof bg !== 'object' || Array.isArray(bg)) {
		return 'branding.background must be a mapping with dark and/or light';
	}
	for (const key of Object.keys(bg)) {
		const theme = THEME_BACKGROUNDS[key];
		if (!theme) return `branding.background has no ${JSON.stringify(key)} setting, only dark and light`;
		const value = bg[key];
		if (value === undefined || value === null) continue;
		if (typeof value !== 'string' || !HEX.test(value)) {
			return `branding.background.${key} must be a #rrggbb colour, not ${JSON.stringify(value)}`;
		}
		const ratio = contrastRatio(value, theme.textDim);
		if (ratio < MIN_CONTRAST) {
			return `branding.background.${key} ${value} is too ${key === 'dark' ? 'light' : 'dark'} for the ${key} theme: its dim text reaches ${ratio.toFixed(1)}:1, and at least ${MIN_CONTRAST}:1 is needed`;
		}
	}
	return null;
}

// The CSS that applies the configured backgrounds, or '' when none are set.
// Assumes the config already passed themeBackgroundError. The selectors
// outrank app.css's :root and .theme-light, whatever order the styles load in.
export function themeBackgroundCss(branding) {
	const { dark, light } = branding?.background || {};
	return [dark && `html:root { --bg: ${dark}; }`, light && `body.theme-light { --bg: ${light}; }`]
		.filter(Boolean)
		.join(' ');
}
