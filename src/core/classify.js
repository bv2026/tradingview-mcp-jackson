/**
 * Deterministic per-symbol classification, computed server-side instead of by hand in a
 * throwaway Python script each morning. Parses the TWB oscillator's string values (which
 * carry commas, unicode minus signs, and bond-tick notation like "0'19" or "−0'15'0" for
 * ZB/ZN/ZC/ZW/ZS) into numbers, derives a gap/bias/NW-position per symbol, and layers a
 * light instrument-specific regime tag on top. Narrative judgment (entries, market read,
 * cross-report corroboration) stays with the caller — this only replaces the mechanical
 * extraction step.
 */

// "0'19" -> 0 + 19/32; "−0'15'0" -> -(0 + 15/32 + 0/(32*8)); everything else is a plain float
// once commas and the unicode minus (−, U+2212) are normalized to ASCII.
export function parseTwbValue(str) {
  if (str == null) return null;
  let s = String(str).trim().replace(/−/g, '-').replace(/,/g, '');
  if (s === '') return null;

  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);

  if (s.includes("'")) {
    const parts = s.split("'").map(Number);
    if (parts.some(Number.isNaN)) return null;
    const [whole, thirtySeconds = 0, eighths = 0] = parts;
    const value = whole + thirtySeconds / 32 + eighths / (32 * 8);
    return neg ? -value : value;
  }

  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return neg ? -n : n;
}

const round4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

function findTwbStudy(indicators) {
  return (indicators?.studies || []).find(s => /trendlines with breaks/i.test(s.name || ''));
}

// Most-recent NW Envelope label ("▲" = price crossed above a band, "▼" = below).
// Callers should request max_labels: 1 from getPineLabels since only labels[0] is ever used.
function nwPositionFrom(nwSignals) {
  const label = nwSignals?.studies?.[0]?.labels?.[0]?.text;
  if (label === '▲') return 'extended';
  if (label === '▼') return 'early';
  return 'n/a';
}

// Mutates nothing — returns the fields to merge onto a scanSymbol() reading.
export function computeSymbolFields(reading) {
  const twb = findTwbStudy(reading.indicators);
  const hist = twb ? parseTwbValue(twb.values?.Histogram) : null;
  const sig = twb ? parseTwbValue(twb.values?.Signal) : null;
  const gap = hist != null && sig != null ? round4(hist - sig) : null;
  const bias = gap == null ? 'n/a' : gap > 0 ? 'bullish' : gap < 0 ? 'bearish' : 'neutral';
  const nw_position = nwPositionFrom(reading.nw_envelope_signals);

  return { hist, sig, gap, bias, nw_position };
}

// bullish-early / bullish-extended / bearish-neutral / neutral — used by momentum_stocks,
// momentum_etf, sp_ndx, r2k.
function classifyMomentum(fields) {
  if (fields.bias === 'bullish') {
    return fields.nw_position === 'extended' ? 'bullish-extended' : 'bullish-early';
  }
  if (fields.bias === 'bearish') return 'bearish-neutral';
  return 'neutral';
}

// BASE_BUILDING / BREAKOUT_READY / EXTENDED / SKIP.
// NOTE: this is a partial approximation. RS-vs-QQQ-over-20-days and the earnings-within-5-days
// check are NOT computed here — BREAKOUT_READY requires that RS check and is never auto-assigned.
// TWB is no longer in ARK's required_indicators; lux_screener_scan (BOS + Bullish rating + ▲
// signal) is the L2 filter. Symbols reaching this function have already passed that gate, so
// bias='n/a' (no TWB) → default to BASE_BUILDING rather than SKIP.
function classifyArk(fields, symbol, correlationClusters) {
  let status;
  if (fields.nw_position === 'extended') status = 'EXTENDED';
  else if (fields.bias === 'bullish' || fields.bias === 'n/a') status = 'BASE_BUILDING';
  else status = 'SKIP'; // bias === 'bearish' or unexpected value

  let cluster = null;
  for (const [name, members] of Object.entries(correlationClusters || {})) {
    if (members.includes(symbol.replace(/^.*:/, ''))) { cluster = name; break; }
  }
  return { status, cluster };
}

// TRENDING_LONG / TRENDING_SHORT / MEAN_REVERTING.
// NOTE: also a single-bar approximation. The strategy's regime_detection calls for "TWB
// Histogram clearly directional for 3+ bars" — only the current bar's Histogram/Signal is
// available here, so persistence isn't checked. Treat this tag as a starting hypothesis, not
// a substitute for the multi-bar/cross-report judgment (e.g. BTC1!/ETH1! corroboration against
// the same day's crypto/crypto_perps briefs) called out in the strategy file.
function classifyFutures(fields) {
  if (fields.bias === 'n/a' || fields.hist == null) return 'MEAN_REVERTING';
  const magnitude = Math.abs(fields.gap ?? 0);
  const relative = fields.sig ? magnitude / Math.abs(fields.sig) : 0;
  if (relative < 0.02) return 'MEAN_REVERTING'; // histogram and signal nearly on top of each other
  return fields.bias === 'bullish' ? 'TRENDING_LONG' : 'TRENDING_SHORT';
}

// Applies computeSymbolFields to every reading in-place-ish (returns new objects), then adds
// an instrument-specific regime/status tag. correlationClusters comes from
// strategy.asset_notes.correlation_clusters (momentum_ark only).
export function classifyResults(results, instrumentType, { correlationClusters } = {}) {
  return results.map(reading => {
    if (reading.error || reading.stale) return reading;
    const fields = computeSymbolFields(reading);

    if (instrumentType === 'momentum_ark') {
      const { status, cluster } = classifyArk(fields, reading.symbol, correlationClusters);
      return { ...reading, ...fields, ark_status: status, cluster };
    }
    if (instrumentType === 'futures') {
      return { ...reading, ...fields, regime: classifyFutures(fields) };
    }
    if (['momentum_stocks', 'momentum_etf', 'sp_ndx', 'r2k'].includes(instrumentType)) {
      return { ...reading, ...fields, momentum_tag: classifyMomentum(fields) };
    }
    return { ...reading, ...fields };
  });
}
