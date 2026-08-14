import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../report_paths.js';

export const cannonMarketRegistry = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'cannon-market-families.json'), 'utf8'));
const { families, aliases, references, policy } = cannonMarketRegistry;
const directBySymbol = new Map(Object.entries(families).flatMap(([family, value]) => [...value.direct_symbols, ...value.members].map(symbol => [symbol, family])));

function ordinaryCrypto(symbol) {
  const s = symbol.toUpperCase();
  return /^(COINBASE:)?[A-Z0-9-]+(?:USD|USDC)(?:\.P)?$/.test(s) && !/^(COINBASE:)?(?:CHNZ2030|TEKZ2030|DEFZ2030|PAXG(?:USD|USDC\.P))$/.test(s);
}

export function resolveCannonMarketFamily(symbol, { instrumentType = 'futures' } = {}) {
  const raw = String(symbol || '').toUpperCase();
  const cryptoDirect = instrumentType !== 'futures' && ['COINBASE:BTCUSD', 'COINBASE:BTCUSDC.P'].includes(raw);
  const family = cryptoDirect ? 'bitcoin' : directBySymbol.get(raw) || references[raw];
  let relationship = family ? (cryptoDirect || directBySymbol.has(raw) ? 'DIRECT' : 'REFERENCE') : aliases[raw]?.relationship || 'NONE';
  let resolvedFamily = family || null;
  if (!family && !aliases[raw] && instrumentType !== 'futures' && ordinaryCrypto(raw)) { resolvedFamily = policy.ordinary_crypto_reference_family; relationship = 'REFERENCE'; }
  const f = resolvedFamily ? families[resolvedFamily] : null;
  return { symbol, family: resolvedFamily, family_name: f?.name || null, cannon_market_code: f?.cannon_market_code || null, cannon_reference_symbol: f?.cannon_reference_symbol || null, relationship, levels_portable: relationship === 'DIRECT', rationale: relationship === 'DIRECT' ? 'Same audited market family' : relationship === 'REFERENCE' ? 'Directional benchmark only; target keeps native price levels' : 'No audited Cannon relationship', source: 'config/cannon-market-families.json' };
}

export function portableCannonContext(cannon, resolution) {
  if (resolution.relationship === 'DIRECT') return cannon;
  if (resolution.relationship === 'NONE') return null;
  return { provider: cannon?.provider, available: cannon?.available, status: cannon?.status, reason: cannon?.reason, market_code: resolution.cannon_market_code, bias: cannon?.bias, short: cannon?.short, long: cannon?.long, freshness: cannon?.freshness, relationship: 'REFERENCE', levels_portable: false, reference_symbol: resolution.cannon_reference_symbol, family: resolution.family, family_name: resolution.family_name };
}
