const PRESENT = 'PRESENT';

function text(value) { return String(value || ''); }
function has(value, pattern) { return pattern.test(text(value)); }

function trendState(so, status) {
  if (status !== PRESENT) return { state: 'UNKNOWN', confirmation: 'NONE' };
  const rating = text(so.RATING);
  const signal = text(so.SIGNAL);
  let state = 'NEUTRAL';
  if (rating.includes('Strong Bullish')) state = 'STRONG_BULLISH';
  else if (rating.includes('Bullish')) state = 'BULLISH';
  else if (rating.includes('Strong Bearish')) state = 'STRONG_BEARISH';
  else if (rating.includes('Bearish')) state = 'BEARISH';
  const confirmation = signal.includes('▲+') ? 'STRONG' : signal.includes('▲') ? 'POSITIVE' : /▼/.test(signal) ? 'NEGATIVE' : 'NONE';
  return { state, confirmation };
}

function structureState(pac, status) {
  if (status !== PRESENT) return { state: 'UNKNOWN', bos_count: null };
  const value = text(pac.STRUCTURE);
  const match = value.match(/BOS\s*\((\d+)\)/i);
  return { state: value.includes('CHoCH') ? 'TRANSITION' : value.includes('BOS') ? 'BULLISH_CONTINUATION' : 'NEUTRAL', bos_count: match ? Number(match[1]) : null };
}

function momentumState(osc, status) {
  if (status !== PRESENT) return { state: 'UNKNOWN', reasons: [] };
  const hwo = text(osc.HWO || osc.SIGNAL);
  const divergence = text(osc.DIVERGENCES);
  const reversal = text(osc.REVERSALS);
  const confluence = text(osc.CONFLUENCE);
  const bullish = /bullish|up|▲/i.test(hwo);
  const bearish = /bearish|down|▼/i.test(hwo);
  const bearishDiv = /bearish|negative|down/i.test(divergence);
  const bullishDiv = /bullish|positive|up/i.test(divergence);
  const bearishRev = /bearish|negative|down|revers/i.test(reversal);
  const bullishRev = /bullish|positive|up/i.test(reversal);
  const reasons = [];
  if (bullish) reasons.push('bullish_hwo');
  if (bearish) reasons.push('bearish_hwo');
  if (bearishDiv) reasons.push('bearish_divergence');
  if (bullishDiv) reasons.push('bullish_divergence');
  if (bearishRev) reasons.push('bearish_reversal');
  if (bullishRev) reasons.push('bullish_reversal');
  if (/strong|bullish/i.test(confluence)) reasons.push('bullish_confluence');
  let state = 'MIXED';
  if (bearish && (bearishRev || bearishDiv)) state = 'REVERSING';
  else if (bullish && (bearishDiv || bearishRev)) state = 'DETERIORATING';
  else if (bullish && (/strong|bullish/i.test(confluence)) && !bearishDiv && !bearishRev) state = 'STRONG';
  else if (bullish) state = 'HEALTHY';
  else if (bearish) state = 'DETERIORATING';
  else if (!bearish && !bullish && !bearishDiv && !bearishRev) state = 'MIXED';
  return { state, reasons };
}

function locationState(pac, status) {
  if (status !== PRESENT) return 'UNKNOWN';
  const value = text(pac['P&D ZONES']);
  if (/Within Discount|Under Equilibrium/i.test(value)) return 'FAVORABLE';
  if (/Within Equilibrium/i.test(value)) return 'NEUTRAL';
  if (/Above Equilibrium/i.test(value)) return 'ELEVATED';
  if (/Within Premium/i.test(value)) return 'EXTENDED';
  return 'UNKNOWN';
}

function scoreEvidenceState({ so = {}, pac = {}, osc = {}, so_status, pac_status, osc_status }) {
  const trend = trendState(so, so_status);
  const structure = structureState(pac, pac_status);
  const momentum = momentumState(osc, osc_status);
  const location = locationState(pac, pac_status);
  const present = [so_status, pac_status, osc_status].filter(v => v === PRESENT).length;
  const data_confidence = present === 3 ? 'HIGH' : present === 2 ? 'MEDIUM' : present === 1 ? 'LOW' : 'INSUFFICIENT';
  const missing_evidence = [['S&O', so_status], ['PAC', pac_status], ['OSC', osc_status]].filter(([, v]) => v !== PRESENT).map(([name, v]) => `${name}:${v || 'UNVERIFIED'}`);
  const trendStrength = trend.state === 'STRONG_BULLISH' || trend.state === 'STRONG_BEARISH';
  const weakTrendStrength = /weak|low/i.test(text(so['TREND STRENGTH']));
  const volatility = text(so['LUX VOLATILITY']);
  const squeeze = text(so.SQUEEZE);
  const risk_volatility = so_status !== PRESENT ? 'UNKNOWN' : ((/high|warning/i.test(volatility) && (weakTrendStrength || !trendStrength || ['DETERIORATING', 'REVERSING'].includes(momentum.state))) ? 'HIGH_RISK' : (trendStrength && /moderate|normal/i.test(volatility) && !/adverse|warning/i.test(squeeze) && !['DETERIORATING', 'REVERSING'].includes(momentum.state)) ? 'SUPPORTIVE' : 'NEUTRAL');
  let setup_quality = 'D';
  if (data_confidence === 'INSUFFICIENT') setup_quality = 'U';
  else if (['BEARISH', 'STRONG_BEARISH'].includes(trend.state)) setup_quality = 'F';
  else if (['STRONG_BULLISH', 'BULLISH'].includes(trend.state) && structure.state === 'BULLISH_CONTINUATION' && ['STRONG', 'HEALTHY'].includes(momentum.state)) setup_quality = 'A';
  else if (['STRONG_BULLISH', 'BULLISH'].includes(trend.state) && structure.state === 'BULLISH_CONTINUATION') setup_quality = 'B';
  else if (['STRONG_BULLISH', 'BULLISH'].includes(trend.state)) setup_quality = 'C';
  const entry_quality = momentum.state === 'REVERSING' || setup_quality === 'F' ? 'AVOID' : location === 'FAVORABLE' && momentum.state !== 'REVERSING' ? 'FAVORABLE' : location === 'NEUTRAL' || location === 'UNKNOWN' ? (['A', 'B', 'C'].includes(setup_quality) ? 'ACCEPTABLE' : 'UNKNOWN') : location === 'ELEVATED' ? 'LATE' : location === 'EXTENDED' ? 'EXTENDED' : 'UNKNOWN';
  const rejection_reasons = setup_quality === 'F' ? ['bearish_trend'] : momentum.state === 'REVERSING' && ['BEARISH', 'STRONG_BEARISH'].includes(trend.state) ? ['reversing_momentum_with_bearish_trend'] : [];
  const eligibility = rejection_reasons.length ? 'REJECT' : data_confidence === 'INSUFFICIENT' ? 'INSUFFICIENT' : 'REVIEW';
  const base = { A: 7, B: 6, C: 4, D: 3, U: 2, F: -99 }[setup_quality];
  const entryMod = { FAVORABLE: 2, ACCEPTABLE: 1, LATE: 0, EXTENDED: -1, AVOID: -2, UNKNOWN: 0 }[entry_quality];
  const riskMod = { SUPPORTIVE: 1, HIGH_RISK: -1, NEUTRAL: 0, UNKNOWN: 0 }[risk_volatility];
  const score = eligibility === 'REJECT' ? -99 : setup_quality === 'U' ? 2 : Math.max(0, Math.min(10, base + entryMod + riskMod));
  return { evidence_state: { trend: trend.state, trend_confirmation: trend.confirmation, structure: structure.state, bos_count: structure.bos_count, momentum_quality: momentum.state, momentum_reasons: momentum.reasons, location, risk_volatility, data_confidence, missing_evidence }, setup_quality, entry_quality, eligibility, rejection_reasons, score_version: 'v1-evidence-state', rank_score: score, score };
}

export { scoreEvidenceState };
