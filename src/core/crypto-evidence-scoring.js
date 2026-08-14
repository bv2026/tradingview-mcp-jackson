import { portableCannonContext, resolveCannonMarketFamily } from './external-evidence/cannon-market-family.js';

const dir = v => /^(bullish|long|up)$/i.test(String(v || '')) ? 'LONG' : /^(bearish|short|down)$/i.test(String(v || '')) ? 'SHORT' : null;
const tvTrend = v => v === 'bullish' ? 'BULLISH' : v === 'bearish' ? 'BEARISH' : v === 'neutral' ? 'NEUTRAL' : 'UNKNOWN';
const tvDir = v => v === 'bullish' ? 'LONG' : v === 'bearish' ? 'SHORT' : null;

function cannonDirection(c) { return dir(c?.bias) || dir(c?.long?.derived) || dir(c?.short?.derived); }
function entry(row) {
  const reasons = [], nw = String(row.nw_position || 'n/a').toLowerCase();
  if (nw === 'extended') reasons.push('Target NW is extended');
  if (nw === 'early') reasons.push('Target NW is early/under lower band');
  if (row.sr_break > 0) reasons.push('Target resistance break supports longs');
  if (row.sr_break < 0) reasons.push('Target support break pressures longs');
  if (nw === 'extended' && !(row.sr_break > 0)) return { quality: 'CAUTION', reasons };
  if (nw === 'early' || row.sr_break < 0) return { quality: 'CAUTION', reasons };
  if (nw === 'n/a') return { quality: 'UNKNOWN', reasons: ['Target NW evidence is missing'] };
  return { quality: 'FAVORABLE', reasons: reasons.length ? reasons : ['Target location is not extended'] };
}
function score(row, cannon, policy) {
  const t = tvDir(row.bias), c = cannonDirection(cannon), cross = t && c ? (t === c ? `AGREEMENT_${t}` : 'CONFLICT') : t ? 'TV_ONLY' : c ? 'CANNON_ONLY' : 'UNKNOWN';
  const momentum = row.hist == null || row.sig == null || row.gap == null ? { quality: 'UNKNOWN', reasons: ['Histogram/signal/gap unavailable'] } : row.gap > 0 && t === 'LONG' || row.gap < 0 && t === 'SHORT' ? { quality: 'SUPPORTIVE', reasons: ['Histogram gap supports target direction'] } : { quality: 'ADVERSE', reasons: ['Histogram gap is adverse to target direction'] };
  const loc = entry(row), hasTarget = row.fresh !== false && (t || row.hist != null || row.nw_position !== 'n/a');
  let quality = 'U', setup = 'UNKNOWN', eligibility = 'INSUFFICIENT';
  if (hasTarget && t) {
    setup = policy === 'SPOT_LONG_ONLY' && t === 'SHORT' ? 'NEUTRAL' : cross === 'CONFLICT' ? 'MIXED' : t;
    if (cross === 'CONFLICT' || (policy === 'SPOT_LONG_ONLY' && t === 'SHORT')) { quality = 'D'; eligibility = 'WATCH'; }
    else if (momentum.quality === 'ADVERSE' || loc.quality === 'CAUTION') { quality = 'B'; eligibility = policy === 'SPOT_LONG_ONLY' && t === 'LONG' ? 'WATCH' : 'WATCH'; }
    else if (cross === 'AGREEMENT_LONG' || cross === 'AGREEMENT_SHORT') { quality = 'A'; eligibility = 'REVIEW'; }
    else { quality = 'C'; eligibility = 'REVIEW'; }
  }
  const base = { A: 8, B: 6, C: 4, D: 2, U: 1 }[quality];
  const state = { policy, instrument_trend: tvTrend(row.bias), cannon_context: { relationship: cannon?.relationship || 'NONE', family: cannon?.family || null, reference_market: cannon?.market_code || null, direction: cannonDirection(cannon), native_bias: cannon?.bias || null, confidence: cannon?.confidence || null, freshness: cannon?.freshness || { status: 'UNAVAILABLE' } }, cross_context: cross, momentum_quality: momentum.quality, momentum_reasons: momentum.reasons, location: { nw_position: row.nw_position || 'n/a', sr_support: row.sr_support ?? null, sr_resistance: row.sr_resistance ?? null, sr_break: row.sr_break ?? null, reasons: loc.reasons }, risk_volatility: 'UNKNOWN', data_confidence: row.fresh === false ? 'LOW' : row.hist != null || row.nw_position !== 'n/a' ? (cannon?.available ? 'HIGH' : 'MEDIUM') : 'INSUFFICIENT' };
  const score = Math.max(0, Math.min(10, base + (loc.quality === 'FAVORABLE' ? 1 : loc.quality === 'CAUTION' ? -1 : 0)));
  return { market_context: { ...(row.market_context || {}), cannon: cannon || null }, crypto_evidence_state: state, perp_evidence_state: policy === 'PERP_BIDIRECTIONAL' ? state : undefined, setup_direction: setup, setup_quality: quality, entry_quality: loc.quality, eligibility, rejection_reasons: [], missing_evidence: state.data_confidence === 'INSUFFICIENT' ? ['Target TradingView evidence'] : [], score_version: policy === 'SPOT_LONG_ONLY' ? 'v1-crypto-evidence-state' : 'v1-crypto-perp-evidence-state', score, rank_score: score };
}

export function scoreCryptoEvidence(row, { instrumentType, cannonEvidence, sessionContext = null } = {}) {
  const resolution = resolveCannonMarketFamily(row.symbol, { instrumentType });
  const portable = portableCannonContext(cannonEvidence, resolution);
  const out = score(row, { ...(portable || {}), relationship: resolution.relationship, family: resolution.family, market_code: resolution.cannon_market_code }, instrumentType === 'crypto' ? 'SPOT_LONG_ONLY' : 'PERP_BIDIRECTIONAL');
  if (sessionContext) out.perp_evidence_state.session_context = sessionContext;
  return out;
}
