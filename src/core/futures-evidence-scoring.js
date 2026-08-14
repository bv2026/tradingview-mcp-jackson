const TIERS = {
  EP: 1, ENQ: 1,
  USA: 2, NGE: 2, KCE: 2, ZCE: 2, GLE: 2, BTC: 2, HE: 2, SBE: 2,
  CLE: 3, ZSE: 3, CCE: 3, ZWA: 3, GCE: 3, SIE: 3, CPE: 3,
};
const TACTICAL = ['S3', 'S2', 'S1', 'Pivot', 'R1', 'R2', 'R3'];

const num = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const pct = (a, b) => a != null && b != null && b !== 0 ? Math.abs(a - b) / Math.abs(b) * 100 : null;
const dir = v => v === 'UP' ? 'LONG' : v === 'DOWN' ? 'SHORT' : null;

function nativeCannon(c) {
  const s = c?.short || {}, l = c?.long || {};
  const slots = x => ({ up: x.up === 'UP', down: x.down === 'DOWN' });
  const ss = slots(s), ls = slots(l);
  const contradictory = x => x.up && x.down;
  let rule, bias = 'NEUTRAL', action = 'SKIP', confidence = 'LOW', bucket = 'SKIP';
  if (contradictory(ss) || contradictory(ls)) rule = 'MANUAL_REVIEW', bias = 'MIXED', action = 'MANUAL_REVIEW', bucket = 'MANUAL_REVIEW';
  else if (ss.up && ls.up) rule = 'ALIGN_LONG', bias = 'LONG', action = 'FOCUS_LONG', confidence = 'HIGH', bucket = 'A_SETUP';
  else if (ss.down && ls.down) rule = 'ALIGN_SHORT', bias = 'SHORT', action = 'FOCUS_SHORT', confidence = 'HIGH', bucket = 'A_SETUP';
  else if (ss.up && ls.down) rule = 'CONFLICT_FADE_RALLIES', bias = 'MIXED', action = 'SCALP_ONLY', bucket = 'SCALP_ONLY';
  else if (ss.down && ls.up) rule = 'CONFLICT_DIP_BUYS', bias = 'MIXED', action = 'SCALP_ONLY', bucket = 'SCALP_ONLY';
  else if (ss.up) rule = 'PARTIAL_LONG_SIGNAL', bias = 'LONG', action = 'WATCHLIST', confidence = 'MEDIUM', bucket = 'WATCHLIST';
  else if (ss.down) rule = 'PARTIAL_SHORT_SIGNAL', bias = 'SHORT', action = 'WATCHLIST', confidence = 'MEDIUM', bucket = 'WATCHLIST';
  else if (ls.up) rule = 'PARTIAL_LONG_TREND_ONLY', bias = 'LONG', action = 'WATCHLIST', confidence = 'MEDIUM', bucket = 'WATCHLIST';
  else if (ls.down) rule = 'PARTIAL_SHORT_TREND_ONLY', bias = 'SHORT', action = 'WATCHLIST', confidence = 'MEDIUM', bucket = 'WATCHLIST';
  else rule = 'NO_SIGNAL';
  return { rule, bias, action, confidence, bucket, reasons: [], freshness: c?.freshness?.status || 'UNAVAILABLE', reliability_tier_if_known: TIERS[c?.market_code] || null, modifiers: [] };
}

function location(c, close, setup) {
  const levels = c?.levels || {}, zones = c?.reaction_zones || {};
  let nearest = null, distance = null;
  for (const key of TACTICAL) { const p = num(levels[key]); const d = pct(close, p); if (d != null && (distance == null || d < distance)) { nearest = key; distance = d; } }
  let tactical_state = 'UNKNOWN';
  if (nearest && distance != null) {
    const price = levels[nearest]; const above = price > close; const near = distance <= 0.3;
    const supportive = setup === 'LONG' ? (!above && near) : setup === 'SHORT' ? (above && near) : false;
    const headwind = setup === 'LONG' ? (above && near) : setup === 'SHORT' ? (!above && near) : false;
    tactical_state = headwind ? 'HEADWIND' : supportive ? 'SUPPORTIVE' : 'OPEN';
  }
  let zn = null, zd = null;
  for (const [key, p] of [['30D_HIGH', zones.high_30d], ['30D_LOW', zones.low_30d], ['52W_HIGH', zones.high_52w], ['52W_LOW', zones.low_52w]]) { const d = pct(close, num(p)); if (d != null && (zd == null || d < zd)) { zn = key; zd = d; } }
  const structural_state = zn == null ? 'UNKNOWN' : zd <= 0.5 && zn.startsWith('30D_') ? `NEAR_${zn}` : zd <= 1 && zn.startsWith('52W_') ? `NEAR_${zn}` : 'MID_RANGE';
  return { tactical_state, nearest_tactical_level: nearest, nearest_tactical_distance_pct: distance, structural_state, nearest_structural_zone: zn, nearest_structural_distance_pct: zd, notes: ['30d/52wk zones are reaction/target/invalidation context, not entry triggers.'] };
}

export function scoreFuturesEvidence(row) {
  const c = row.external_evidence?.cannon || {}, native = nativeCannon(c), tv = row.bias === 'bullish' ? 'BULLISH' : row.bias === 'bearish' ? 'BEARISH' : row.bias === 'neutral' ? 'NEUTRAL' : 'UNKNOWN';
  const cannonDir = native.bias === 'LONG' ? 'LONG' : native.bias === 'SHORT' ? 'SHORT' : null;
  const tvDir = tv === 'BULLISH' ? 'LONG' : tv === 'BEARISH' ? 'SHORT' : null;
  let cross = 'UNKNOWN';
  if (cannonDir && tvDir) cross = cannonDir === tvDir ? (native.rule.startsWith('ALIGN_') ? `AGREEMENT_${cannonDir}` : `PARTIAL_AGREEMENT_${cannonDir}`) : 'CONFLICT';
  else if (tvDir) cross = 'TV_ONLY'; else if (cannonDir) cross = 'CANNON_ONLY';
  const change = num(c.change_pct), tier = native.reliability_tier_if_known, adverse = tier && change != null ? (tier <= 2 ? 1 : 0.5) : null, over = tier && change != null ? (tier <= 2 ? 2 : 1.5) : null;
  if (change != null && tier && ((cannonDir === 'LONG' && change < -adverse) || (cannonDir === 'SHORT' && change > adverse))) native.modifiers.push('ADVERSE_MOMENTUM'), native.reasons.push('Cannon change exceeds adverse threshold');
  if (change != null && tier && Math.abs(change) > over) native.modifiers.push('OVEREXTENDED'), native.reasons.push('Cannon move exceeds overextension threshold');
  if (c.market_code === 'EU6' && change != null && Math.abs(change) < 0.15) native.modifiers.push('EU6_FLAT_FILTER'), native.reasons.push('EU6 move is flat');
  const locationData = location(c, num(row.quote?.close), cannonDir || tvDir);
  if (locationData.tactical_state === 'HEADWIND') native.modifiers.push('SR_PROXIMITY'), native.reasons.push('Tactical level is a nearby headwind');
  if (change != null && Math.abs(change) > 3) native.modifiers.push('VOLATILITY_FLAG'), native.reasons.push('Cannon change exceeds 3%');
  if (native.modifiers.some(x => ['ADVERSE_MOMENTUM', 'OVEREXTENDED', 'SR_PROXIMITY'].includes(x)) && native.confidence === 'HIGH') native.confidence = 'MEDIUM';
  const momentum = cross === 'CONFLICT' ? 'MIXED' : tvDir && change != null && ((tvDir === 'LONG' && change < -(adverse || Infinity)) || (tvDir === 'SHORT' && change > (adverse || Infinity))) ? 'DIVERGENT' : cross.includes('AGREEMENT') ? 'STRONG_CONFIRMATION' : tvDir ? 'CONFIRMED' : tv === 'NEUTRAL' ? 'NEUTRAL' : 'UNKNOWN';
  const freshTv = row.fresh === true && !row.stale, cannonUsable = c.available === true && ['FRESH', 'AGING'].includes(c.freshness?.status);
  const dataConfidence = !freshTv && !cannonUsable ? 'INSUFFICIENT' : freshTv && cannonUsable && native.rule !== 'NO_SIGNAL' ? 'HIGH' : freshTv ? 'MEDIUM' : 'LOW';
  const setup = cross === 'CONFLICT' ? 'MIXED' : cannonDir || tvDir || 'UNKNOWN';
  let quality = dataConfidence === 'INSUFFICIENT' ? 'U' : native.rule === 'MANUAL_REVIEW' ? 'F' : cross === 'CONFLICT' || native.rule.startsWith('CONFLICT_') || (native.rule === 'NO_SIGNAL' && tvDir) ? 'D' : (cross.startsWith('AGREEMENT_') && native.bucket === 'A_SETUP' && momentum !== 'DIVERGENT') ? 'A' : (cross.startsWith('PARTIAL_') || (cross.startsWith('AGREEMENT_') && native.confidence !== 'HIGH')) ? 'B' : setup !== 'UNKNOWN' ? 'C' : 'U';
  const structuralAdverse = locationData.structural_state.startsWith('NEAR_') && ((setup === 'LONG' && /HIGH/.test(locationData.nearest_structural_zone)) || (setup === 'SHORT' && /LOW/.test(locationData.nearest_structural_zone)));
  const caution = locationData.tactical_state === 'HEADWIND' || structuralAdverse || momentum === 'DIVERGENT' || cross === 'CONFLICT';
  const entry = quality === 'F' ? 'AVOID' : ['A','B'].includes(quality) && !caution && ['STRONG_CONFIRMATION','CONFIRMED'].includes(momentum) && ['SUPPORTIVE','OPEN'].includes(locationData.tactical_state) ? 'FAVORABLE' : ['A','B','C'].includes(quality) && !caution ? 'ACCEPTABLE' : caution ? 'CAUTION' : 'UNKNOWN';
  const eligibility = quality === 'U' ? 'INSUFFICIENT' : quality === 'F' ? 'REJECT' : ['A','B','C'].includes(quality) && entry !== 'CAUTION' ? 'REVIEW' : 'WATCH';
  let score = quality === 'A' ? 8 : quality === 'B' ? 6 : quality === 'C' ? 4 : quality === 'D' ? 2 : quality === 'U' ? 1 : -99;
  if (score >= 0) { if (entry === 'FAVORABLE') score++; if (entry === 'CAUTION') score--; if (native.modifiers.includes('VOLATILITY_FLAG')) score--; score = Math.max(0, Math.min(10, score)); }
  return { futures_evidence_state: { cannon_native: native, tv_trend: tv, tv_regime: row.regime || 'UNKNOWN', cross_provider: cross, momentum_quality: momentum, momentum_reasons: [], location: locationData, risk_volatility: native.modifiers.includes('VOLATILITY_FLAG') ? 'HIGH_VOLATILITY' : native.modifiers.some(x => ['ADVERSE_MOMENTUM','OVEREXTENDED','SR_PROXIMITY'].includes(x)) ? 'ELEVATED' : 'NORMAL', data_confidence: dataConfidence }, setup_direction: setup, setup_quality: quality, entry_quality: entry, eligibility, rejection_reasons: quality === 'F' ? ['Contradictory Cannon slots require manual review'] : [], missing_evidence: dataConfidence === 'INSUFFICIENT' ? ['TradingView and Cannon directional evidence'] : [], score_version: 'v1-futures-evidence-state', score, rank_score: score };
}

export function applyFuturesEvidenceScoring(rows) { return rows.map(row => row.error ? row : { ...row, ...scoreFuturesEvidence(row) }); }
