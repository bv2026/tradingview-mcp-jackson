import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../report_paths.js';

const ROOT = join(PROJECT_ROOT, 'evidence', 'coinbase-weekly');
const WEEKLY = ['BTCUSD', 'BTCUSDC.P'];
const ETH = ['ETHUSD', 'ETHUSDC.P'];
const NON_CORE = /(?:PAXG(?:USD|USDC\.P)|TEKZ2030|DEFZ2030|CHNZ2030)$/;

function baseSymbol(symbol) { return String(symbol || '').toUpperCase().replace(/^COINBASE:/, ''); }
function freshness(reportDate, now = new Date()) {
  if (!reportDate) return { status: 'UNAVAILABLE', age_days: null, cadence_days: 7 };
  const age = Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${reportDate}T00:00:00Z`)) / 86400000);
  if (!Number.isFinite(age) || age < 0) return { status: 'UNAVAILABLE', age_days: null, cadence_days: 7 };
  return { status: age <= 7 ? 'CURRENT_ISSUE' : age <= 14 ? 'AGING' : 'STALE', age_days: age, cadence_days: 7 };
}
export function resolveCoinbaseWeeklyRelationship(symbol, instrumentType) {
  if (!['crypto', 'crypto_perps'].includes(instrumentType)) return 'NONE';
  const s = baseSymbol(symbol);
  if (NON_CORE.test(s)) return 'NONE';
  if (WEEKLY.includes(s) || ETH.includes(s)) return 'DIRECT';
  return /(?:USD|USDC)(?:\.P)?$/.test(s) ? 'REFERENCE' : 'NONE';
}
function riskContext(latest) {
  const e = latest?.derivatives || {}, p = latest?.perpetuals || {}, f = latest?.flows || {};
  return { funding: p.btc?.funding ?? null, open_interest: p.btc?.OI ?? null, dvol: e.btc?.DVOL ?? null, realized_volatility: null, vrp: e.btc?.VRP ?? null, skew: e.btc?.skew ?? null, leverage_positioning: p.btc?.OI_direction ?? null, flows_liquidity: f.source_text ?? null, event_week_ahead: latest?.week_ahead?.events ?? [] };
}
export function loadCoinbaseWeeklyLatest({ evidenceRoot = ROOT } = {}) {
  try { const path = join(evidenceRoot, 'latest.json'); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; } catch (_) { return null; }
}
export function attachCoinbaseWeekly(row, { instrumentType, latest = loadCoinbaseWeeklyLatest(), now = new Date() } = {}) {
  const relationship = resolveCoinbaseWeeklyRelationship(row?.symbol, instrumentType);
  const unavailable = { provider: 'coinbase_weekly', available: false, relationship, freshness: { status: 'UNAVAILABLE', age_days: null, cadence_days: 7 }, completeness: null, asset_context: relationship === 'REFERENCE' ? { broad_market: null } : null, risk_context: null, provenance: null };
  if (relationship === 'NONE' || !latest?.report_date) return unavailable;
  const freshnessState = freshness(latest.report_date, now);
  const key = baseSymbol(row.symbol).startsWith('BTC') ? 'btc' : baseSymbol(row.symbol).startsWith('ETH') ? 'eth' : null;
  const scenarios = latest.trade_scenarios?.[key];
  return { provider: 'coinbase_weekly', available: freshnessState.status !== 'UNAVAILABLE', relationship, freshness: freshnessState, completeness: { status: latest.completeness?.completeness ?? 'unknown', missing_sections: latest.completeness?.missing_sections ?? [], section_availability: latest.completeness?.section_availability ?? null }, asset_context: relationship === 'DIRECT' ? { ...(scenarios || {}) } : { broad_market: latest.market_view?.summary_text ?? null }, risk_context: riskContext(latest), provenance: { report_date: latest.report_date, source_received_at: latest.freshness?.source_received_at ?? null, issue_id: latest.provenance?.issue_id ?? null, content_sha256: latest.provenance?.content_sha256 ?? null, parser_version: latest.provenance?.parser_version ?? null, source_locator: latest.provenance?.source_locator ?? null } };
}
export function attachCoinbaseWeeklyToRows(rows, options = {}) { return rows.map(row => ({ ...row, market_context: { ...(row.market_context || {}), coinbase_weekly: attachCoinbaseWeekly(row, options) } })); }
