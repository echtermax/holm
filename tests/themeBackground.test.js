// Unit tests for config.yml's branding.background: the household's page
// colour for the Dark and Light themes.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, themeBackgroundError, themeBackgroundCss } from '../src/lib/themeBackground.js';

test('no background, or an empty one, is fine', () => {
	assert.equal(themeBackgroundError({}), null);
	assert.equal(themeBackgroundError(undefined), null);
	assert.equal(themeBackgroundError({ background: {} }), null);
	assert.equal(themeBackgroundCss({}), '');
});

test('true black and a warm white pass', () => {
	assert.equal(themeBackgroundError({ background: { dark: '#000000', light: '#faf6ee' } }), null);
	assert.equal(themeBackgroundError({ background: { dark: '#09090B' } }), null);
});

test('only #rrggbb is accepted', () => {
	for (const value of ['#000', 'black', '#0000000', '000000', 'rgb(0,0,0)', '#000000; } body { display: none', 0]) {
		assert.match(themeBackgroundError({ background: { dark: value } }), /must be a #rrggbb colour/);
	}
});

test("a colour the theme's dim text can't be read on is rejected", () => {
	assert.match(themeBackgroundError({ background: { dark: '#ffffff' } }), /too light for the dark theme/);
	assert.match(themeBackgroundError({ background: { light: '#09090b' } }), /too dark for the light theme/);
	// Mid grey sits under 4.5:1 against both dim texts.
	assert.match(themeBackgroundError({ background: { dark: '#555555' } }), /4\.5:1/);
});

test('unknown keys and a non-mapping are rejected', () => {
	assert.match(themeBackgroundError({ background: { dynamic: '#000000' } }), /only dark and light/);
	assert.match(themeBackgroundError({ background: '#000000' }), /must be a mapping/);
});

test('contrast ratio matches WCAG', () => {
	assert.equal(contrastRatio('#000000', '#ffffff').toFixed(1), '21.0');
	assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
});

test('the CSS sets --bg per theme', () => {
	assert.equal(themeBackgroundCss({ background: { dark: '#000000' } }), 'html:root { --bg: #000000; }');
	assert.equal(
		themeBackgroundCss({ background: { dark: '#000000', light: '#faf6ee' } }),
		'html:root { --bg: #000000; } body.theme-light { --bg: #faf6ee; }'
	);
});
