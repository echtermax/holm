// Server → client serialization helpers for integrations.
//
// Two responsibilities:
//   1. Strip non-serializable adapter pieces (functions, schema metadata) so
//      the registry can be sent over the wire.
//   2. Redact secret fields to a fixed bullet string so credentials never
//      leak through API responses.

const REDACTED = '••••••••';

export function adapterToClient(adapter, { icon, name, tip, shortcut } = {}) {
	return {
		id: adapter.id,
		name: name || adapter.name,
		icon: icon || adapter.icon || null,
		shortcut: (shortcut || adapter.shortcut || '').toLowerCase() || null,
		description: adapter.description,
		tip: tip || null,
		configSchema: (adapter.configSchema || []).map((f) => ({
			key: f.key,
			type: f.type,
			label: f.label,
			required: !!f.required,
			placeholder: f.placeholder || '',
			help: f.help || '',
			helpUrl: f.helpUrl || null,
			fromOperatorDefault: f.fromOperatorDefault || null,
			advanced: !!f.advanced,
			options: f.options || null,
			default: f.default ?? null,
			hidden: !!f.hidden
		})),
		signIn: adapter.signIn ? { label: adapter.signIn.label, help: adapter.signIn.help || '' } : null,
		linkedTo: adapter.linkedTo || null,
		searchProviders: Object.fromEntries(
			Object.entries(adapter.searchProviders || {}).map(([key, p]) => [
				key,
				{ label: p.label, mode: p.mode, kind: p.kind || null, layout: p.layout || null, shelf: p.shelf || null, scoped: !!p.scoped, plainOnly: !!p.plainOnly, filters: !!p.filters, delay: p.delay || 0 }
			])
		),
		widgets: Object.entries(adapter.widgets || {}).map(([key, w]) => ({
			key,
			label: w.label,
			description: w.description || ''
		})),
		widgetsOnConnect: !!adapter.widgetsOnConnect,
		// Shared integrations have nothing for the user to connect: Settings
		// shows this line, and their ⋯ menu opens only the Use for switches.
		operatorNote: adapter.shared ? 'Set by your admin' : null,
		multiAccount: !!adapter.multiAccount
	};
}

export function redactConfig(adapter, config) {
	const out = {};
	const schema = adapter.configSchema || [];
	const secretKeys = new Set(schema.filter((f) => f.type === 'secret').map((f) => f.key));
	for (const [k, v] of Object.entries(config || {})) {
		if (v == null || v === '') continue;
		// The other accounts of a Calendar: each redacted the same way.
		if (k === 'accounts') {
			if (adapter.multiAccount && Array.isArray(v)) {
				out.accounts = v.filter((a) => typeof a?.id === 'string').map((a) => ({ ...redactConfig(adapter, a), id: a.id }));
			}
			continue;
		}
		out[k] = secretKeys.has(k) ? REDACTED : v;
	}
	return out;
}

export function isRedacted(value) {
	return value === REDACTED;
}
