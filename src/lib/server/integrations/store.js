import {
	getIntegrationRow,
	listIntegrationRows,
	upsertIntegrationRow,
	deleteIntegrationRow
} from '../db.js';
import { encryptConfig, decryptConfig } from '../secrets.js';
import { getAdapter, getOperatorDefaults, getRegistry } from './index.js';
import { applyOperatorUrls } from './urlPolicy.js';

// Wraps user_integrations row access with transparent encryption / decryption.
// Callers always deal in plain JS objects; the encrypted blob never leaves
// this module.

function parseSurfaces(json) {
	if (!json) return {};
	try {
		const obj = JSON.parse(json);
		return obj && typeof obj === 'object' ? obj : {};
	} catch {
		return {};
	}
}

function rowToConnection(row) {
	if (!row) return null;
	const config = row.config_blob
		? decryptConfig(row.username, row.integration_id, row.config_blob)
		: null;
	return {
		integrationId: row.integration_id,
		connected: !!config,
		// The operator's URL wins over one saved before it was pinned.
		config: config ? withOperatorUrls(row.integration_id, config) : {},
		surfaces: parseSurfaces(row.surfaces_json),
		updatedAt: row.updated_at
	};
}

// On every account of a connection that holds several.
function withOperatorUrls(id, config) {
	const adapter = getAdapter(id);
	const operator = getOperatorDefaults(id);
	const out = applyOperatorUrls(adapter, operator, config);
	if (Array.isArray(out.accounts)) out.accounts = out.accounts.map((a) => applyOperatorUrls(adapter, operator, a));
	return out;
}

// A shared integration (Invidious) is the operator's, the same for everyone:
// every user is connected to the URL in config.yml, and nothing is stored.
function sharedConnection(integrationId) {
	const adapter = getAdapter(integrationId);
	if (!adapter?.shared) return null;
	return {
		integrationId,
		connected: true,
		config: applyOperatorUrls(adapter, getOperatorDefaults(integrationId), {}),
		surfaces: { search: true },
		updatedAt: null
	};
}

export async function getConnection(username, integrationId) {
	const shared = sharedConnection(integrationId);
	if (shared) return shared;
	const row = await getIntegrationRow(username, integrationId);
	return rowToConnection(row);
}

export async function listConnections(username) {
	const rows = await listIntegrationRows(username);
	const out = rows.map(rowToConnection).filter((c) => !getAdapter(c.integrationId)?.shared);
	for (const { adapter } of getRegistry()) {
		if (adapter.shared) out.push(sharedConnection(adapter.id));
	}
	return out;
}

export async function upsertConnection(username, integrationId, { config, surfaces }) {
	const blob = config && Object.keys(config).length > 0
		? encryptConfig(username, integrationId, config)
		: '';
	const surfacesJson = JSON.stringify(surfaces || {});
	await upsertIntegrationRow(username, integrationId, blob, surfacesJson);
}

export async function deleteConnection(username, integrationId) {
	return await deleteIntegrationRow(username, integrationId);
}
