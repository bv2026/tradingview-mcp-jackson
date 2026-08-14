#!/usr/bin/env node
/** Build the canonical, evidence-only input package for the LLM decision layer. */
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { validateLuxScanPayload } from '../src/core/lux-scan-contract.js';

const root = process.env.TRADINGVIEW_ROOT || process.cwd();
const out = process.argv[2] || join(root, 'evidence', 'latest', 'all-strategies-llm-input.json');
const families = ['momentum_stocks','momentum_etf','momentum_ark','sp_ndx','r2k','thematic_stocks','thematic_etfs','futures','crypto','crypto_perps'];
const luxFamilies = new Set(['momentum_stocks','momentum_etf','momentum_ark','sp_ndx','r2k','thematic_stocks','thematic_etfs']);
const freshnessHours = Math.max(1, Number(process.env.LLM_FRESHNESS_HOURS || 48));
const strategyContexts = {
  momentum_stocks: { instrument_type: 'equity', universe: 'Momentum-stock Lux universe', policy: 'long-only', score_semantics: 'Lux evidence-state score; strategy-local', authoritative_evidence: ['Lux S&O', 'Lux PAC', 'Lux OSC', 'NW/location'], allowed_provider_context: ['Lux evidence only'], eligibility_semantics: 'Lux hard gates plus evidence-state eligibility', manual_checks: ['current chart/location', 'stop/target', 'manual R:R'], allowed_inference: 'Infer setup quality only from supplied momentum-stock evidence.', prohibited_inference: 'Do not import ETF, futures, crypto, or other strategy evidence.' },
  momentum_etf: { instrument_type: 'etf', universe: 'Momentum-ETF Lux universe', policy: 'long-only', score_semantics: 'Lux evidence-state score; strategy-local', authoritative_evidence: ['Lux S&O', 'Lux PAC', 'Lux OSC', 'NW/location'], allowed_provider_context: ['Lux evidence only'], eligibility_semantics: 'Lux hard gates plus evidence-state eligibility', manual_checks: ['current chart/location', 'stop/target', 'manual R:R'], allowed_inference: 'Infer setup quality only from supplied momentum-ETF evidence.', prohibited_inference: 'Do not import stock, futures, crypto, or other strategy evidence.' },
  momentum_ark: { instrument_type: 'equity', universe: 'ARK-specific Lux universe and clusters/themes', policy: 'long-only', score_semantics: 'Lux evidence-state score with ARK cluster context; strategy-local', authoritative_evidence: ['Lux evidence', 'ARK cluster/theme context'], allowed_provider_context: ['Lux and ARK context supplied in candidate'], eligibility_semantics: 'ARK/Lux eligibility with cluster constraints', manual_checks: ['cluster concentration', 'current chart/location', 'manual R:R'], allowed_inference: 'Use ARK grouping and cluster context within this strategy only.', prohibited_inference: 'Do not transfer cluster conclusions to other strategies.' },
  sp_ndx: { instrument_type: 'equity', universe: 'S&P 500 and Nasdaq 100 strategy universe', policy: 'long-only', score_semantics: 'Lux evidence-state score; strategy-local', authoritative_evidence: ['Lux evidence', 'S&P/Nasdaq universe membership'], allowed_provider_context: ['Lux and universe context'], eligibility_semantics: 'Strategy universe membership plus Lux eligibility', manual_checks: ['current chart/location', 'manual R:R'], allowed_inference: 'Infer only from S&P/Nasdaq strategy evidence.', prohibited_inference: 'Do not use the score to rank against another strategy.' },
  r2k: { instrument_type: 'equity', universe: 'Russell 2000 / small-cap strategy universe', policy: 'long-only', score_semantics: 'Lux evidence-state score; strategy-local', authoritative_evidence: ['Lux evidence', 'Russell/small-cap universe membership'], allowed_provider_context: ['Lux and universe context'], eligibility_semantics: 'Strategy universe membership plus Lux eligibility', manual_checks: ['liquidity', 'current chart/location', 'manual R:R'], allowed_inference: 'Infer only from Russell/small-cap strategy evidence.', prohibited_inference: 'Do not use another strategy to suppress a valid candidate.' },
  thematic_stocks: { instrument_type: 'equity', universe: 'Thematic-stock groupings and strategy universe', policy: 'long-only', score_semantics: 'Lux evidence-state score; strategy-local', authoritative_evidence: ['Lux evidence', 'thematic grouping context'], allowed_provider_context: ['Lux and thematic context'], eligibility_semantics: 'Thematic membership plus Lux eligibility', manual_checks: ['theme concentration', 'current chart/location', 'manual R:R'], allowed_inference: 'Use thematic grouping only within this strategy.', prohibited_inference: 'Do not merge thematic evidence with thematic ETFs or other strategies.' },
  thematic_etfs: { instrument_type: 'etf', universe: 'Thematic-ETF groupings and strategy universe', policy: 'long-only', score_semantics: 'Lux evidence-state score; strategy-local', authoritative_evidence: ['Lux evidence', 'thematic ETF grouping context'], allowed_provider_context: ['Lux and thematic ETF context'], eligibility_semantics: 'Thematic ETF membership plus Lux eligibility', manual_checks: ['theme concentration', 'current chart/location', 'manual R:R'], allowed_inference: 'Use thematic ETF grouping only within this strategy.', prohibited_inference: 'Do not merge ETF evidence with thematic stocks or other strategies.' },
  futures: { instrument_type: 'futures', universe: 'Approved futures universe', policy: 'bidirectional', score_semantics: 'Futures evidence-state score; strategy-local', authoritative_evidence: ['TradingView futures evidence', 'Cannon futures context'], allowed_provider_context: ['Cannon and TradingView futures context only'], eligibility_semantics: 'Futures setup/direction/entry eligibility with manual R:R gate', manual_checks: ['live levels', 'stop/target', 'manual R:R', 'contract conditions'], allowed_inference: 'Infer direction only from approved futures evidence and explicit provider conflicts.', prohibited_inference: 'Do not use futures score or bias to influence equities or crypto.' },
  crypto: { instrument_type: 'crypto_spot', universe: 'Approved crypto spot universe', policy: 'long-only', score_semantics: 'Crypto spot evidence-state score; strategy-local', authoritative_evidence: ['TradingView crypto evidence', 'approved Cannon context', 'Coinbase Weekly context where present'], allowed_provider_context: ['Approved Cannon and Coinbase context only'], eligibility_semantics: 'Spot eligibility; bearish evidence cannot create a short', manual_checks: ['live chart', 'location', 'stop/target', 'freshness'], allowed_inference: 'Infer long-side setup quality from approved spot evidence.', prohibited_inference: 'Never infer a short or import perp/futures direction.' },
  crypto_perps: { instrument_type: 'crypto_perp', universe: 'Approved perpetual-futures crypto universe', policy: 'bidirectional', score_semantics: 'Crypto perp evidence-state score; strategy-local', authoritative_evidence: ['TradingView perp evidence', 'BTC session/broad crypto context', 'approved Cannon context', 'Coinbase Weekly context where present'], allowed_provider_context: ['Approved Cannon/Coinbase context plus BTC session and broad crypto context'], eligibility_semantics: 'Perp bidirectional eligibility with live funding/positioning checks', manual_checks: ['live funding', 'positioning', 'BTC session context', 'stop/target', 'freshness'], allowed_inference: 'Use BTC/broad context only as explicitly supplied in this perp model.', prohibited_inference: 'Do not transfer perp signals to spot, futures, or equities.' },
};
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const rowsOf = d => d.symbols_scanned || d.symbols_raw || d.rows || [];
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const finite = v => typeof v === 'number' && Number.isFinite(v);
const statusOf = r => String(r.eligibility ?? r.status ?? 'UNKNOWN').toUpperCase();
const scoreVersion = rows => [...new Set(rows.map(r => r.score_version).filter(Boolean))];
const freshness = (d, p) => { const m = statSync(p).mtime; const age = (Date.now() - m.getTime()) / 3600000; return { generated_at: d.generated_at || null, captured_at: d.captured_at || null, fresh: d.scan_quality?.fresh ?? d.fresh ?? null, stale: d.scan_quality?.stale ?? null, source_mtime: m.toISOString(), age_hours: Number(age.toFixed(2)), threshold_hours: freshnessHours, status: age <= freshnessHours ? 'FRESH' : 'STALE' }; };
function manualChecks(r, family) {
  const checks = Array.isArray(r.manual_checks) ? [...r.manual_checks] : [];
  if (family === 'crypto') checks.push('Spot crypto is long-only; bearish evidence cannot create a short recommendation.');
  if (family === 'crypto_perps') checks.push('Confirm live funding and positioning before execution; weekly context is non-live.');
  if (family === 'futures' || luxFamilies.has(family)) checks.push('Confirm current location, stop, target, and manual R:R before action.');
  if (r.rr == null && (luxFamilies.has(family) || family === 'futures')) checks.push('NW bands/R:R unavailable; manual R:R is required.');
  return [...new Set(checks)];
}
function candidate(r, family) {
  const evidence = r.evidence_state || r.futures_evidence_state || r.crypto_evidence_state || r.perp_evidence_state || null;
  const strategyContext = { ...strategyContexts[family], strategy: family, strategy_context_version: 'v1-independent-context' };
  return {
    strategy: family, strategy_context_version: strategyContext.strategy_context_version, strategy_context: strategyContext, universe: family, instrument_type: r.instrument_type || family, symbol: r.symbol || null,
    full_symbol: r.full_symbol || null, description: r.description || null, exchange: r.exchange || null, type: r.type || null,
    score: finite(r.score) ? r.score : null, rank_score: finite(r.rank_score) ? r.rank_score : null, score_version: r.score_version || null,
    setup_direction: r.setup_direction ?? r.direction ?? r.bias ?? null, setup_quality: r.setup_quality ?? r.setup ?? null,
    entry_quality: r.entry_quality ?? r.entry ?? null, eligibility: r.eligibility ?? r.status ?? null,
    rejection_reasons: r.rejection_reasons || [], missing_evidence: r.missing_evidence || [], data_confidence: r.data_confidence ?? null,
    freshness: { fresh: r.fresh ?? null, captured_at: r.captured_at ?? null }, provenance: r.provenance || { source: 'evidence/latest', source_tool: r.source_tool || null },
    status: statusOf(r), evidence_state: evidence, manual_checks: manualChecks(r, family),
    // Preserve family-specific evidence without inventing or flattening provider values.
    evidence: r,
  };
}
function summarize(rows, d, p) {
  const counts = { total_scanned: rows.length, REVIEW: 0, WATCH: 0, REJECT: 0, AVOID: 0, INSUFFICIENT: 0, UNKNOWN: 0 };
  for (const r of rows) { const s = statusOf(r); counts[s] = (counts[s] || 0) + 1; if (!['REVIEW','WATCH','REJECT','AVOID','INSUFFICIENT'].includes(s)) counts.UNKNOWN++; }
  const missing = rows.filter(r => (r.missing_evidence || []).length || r.evidence_state?.status === 'UNKNOWN').length;
  return { ...counts, missing_or_unknown_evidence: missing, score_versions: scoreVersion(rows), freshness: freshness(d, p) };
}
const strategies = {}; const invalid = []; const sources = []; const excluded = [];
for (const family of families) {
  const p = join(root, 'evidence', 'latest', `${family}.raw.json`);
  if (!existsSync(p)) { invalid.push({ strategy: family, reason: 'MISSING_CANONICAL_ARTIFACT', path: relative(root, p) }); continue; }
  const d = read(p); sources.push({ strategy: family, path: relative(root, p).replaceAll('\\','/'), sha256: hash(p), freshness: freshness(d, p) });
  if (luxFamilies.has(family)) { const contract = validateLuxScanPayload(d, d.instrument_type); if (!contract.valid) { invalid.push({ strategy: family, reason: 'INVALID_LUX_PAYLOAD', errors: contract.errors }); continue; } }
  const rows = rowsOf(d); const all = rows.map(r => candidate(r, family));
  strategies[family] = { summary: summarize(rows, d, p), candidates: all, selection: { included: all.length, omitted: 0, total_rows: all.length } };
}
const pkg = { generated_at: new Date().toISOString(), schema_version: 'all-strategies-llm-input.v2-independent-contexts', decision_contract: { mode: 'TEN_INDEPENDENT_STRATEGY_CONTEXTS', instruction: 'Perform independent decision analysis within each strategy context. Do not synthesize a consolidated strategy, global score, or cross-strategy recommendation.', input_partition: 'Evaluate candidates_by_strategy entries independently; never combine evidence across keys.', output_shape: 'Group decisions by strategy and retain strategy_context_version on every decision.', prohibited_outputs: ['global score sort', 'best overall ranking', 'global bullish/bearish call', 'cross-strategy candidate comparison', 'cross-strategy suppression'] }, strategy_contexts: Object.fromEntries(Object.entries(strategyContexts).map(([k,v]) => [k, { ...v, strategy: k, strategy_context_version: 'v1-independent-context' }])), source_artifacts: sources, strategy_summaries: Object.fromEntries(Object.entries(strategies).map(([k,v]) => [k,v.summary])), candidates_by_strategy: Object.fromEntries(Object.entries(strategies).map(([k,v]) => [k,v.candidates])), invalid_or_insufficient_strategies: invalid, manual_checks_global: ['Scores are strategy-local and must never be globally re-ranked or compared.', 'Use evidence, not score alone; UNKNOWN is not negative.', 'Provider conflicts must be explained, never averaged away.', 'No order execution is implied by this package.'], excluded_inputs: { research_intelligence: 'EXCLUDED_FROM_OPERATIONAL_LLM_INPUT', coinbase_transitions: 'EXCLUDED_FROM_OPERATIONAL_LLM_INPUT' } };
pkg.retrieval_policy = { included: 'all valid rows produced by each strategy, preserving strategy-local order and status', omitted: 0, freshness_threshold_hours: freshnessHours };
pkg.freshness = { status: sources.some(s => s.freshness.status === 'STALE') ? 'WARN' : 'FRESH', warnings: sources.filter(s => s.freshness.status === 'STALE').map(s => `${s.strategy}: source is stale`), per_strategy: Object.fromEntries(sources.map(s => [s.strategy, s.freshness])) };
mkdirSync(join(out, '..'), { recursive: true }); writeFileSync(out, JSON.stringify(pkg, null, 2) + '\n'); console.log(out);
