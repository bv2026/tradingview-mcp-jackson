export const LUX_EQUITY_TYPES = Object.freeze(['momentum_stocks','momentum_etf','momentum_ark','sp_ndx','r2k','thematic_stocks','thematic_etfs']);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export function validateLuxScanPayload(payload, instrumentType = payload?.instrument_type) {
  if (!LUX_EQUITY_TYPES.includes(instrumentType)) return { valid: true, errors: [] };
  const errors = [];
  if (!Array.isArray(payload?.symbols_raw)) errors.push('symbols_raw must be an array');
  for (const [i, row] of (payload?.symbols_raw || []).entries()) {
    const p = `symbols_raw[${i}]`;
    if (!row?.symbol) errors.push(`${p}.symbol is required`);
    for (const f of ['so','pac','osc']) if (!object(row?.[f])) errors.push(`${p}.${f} is missing (morning_brief or malformed capture)`);
    if (typeof row?.score !== 'number' || !Number.isFinite(row.score)) errors.push(`${p}.score must be numeric`);
    if (!['REVIEW','REJECT','INSUFFICIENT'].includes(row?.eligibility)) errors.push(`${p}.eligibility must be REVIEW, REJECT, or INSUFFICIENT`);
    for (const f of ['so_status','pac_status','osc_status']) if (!['AVAILABLE','PRESENT','ABSENT','UNVERIFIED'].includes(row?.[f])) errors.push(`${p}.${f}=${row?.[f] ?? 'missing'}; Lux evidence state is invalid`);
  }
  return { valid: errors.length === 0, errors };
}
export function assertLuxScanPayload(payload, instrumentType = payload?.instrument_type) {
  const result = validateLuxScanPayload(payload, instrumentType);
  if (!result.valid) throw new Error(`Invalid Lux scan capture for ${instrumentType}: ${result.errors.slice(0, 8).join('; ')}`);
  return payload;
}

// Semantic health check, distinct from validateLuxScanPayload's structural check — a payload
// can be perfectly well-formed (every field present, every enum value valid) while still being
// silently corrupted data. Added 2026-08-15 after an r2k scan shipped with 10 symbols'
// so/pac/osc entirely blank (a typo'd ticker put S&O/OSC into TradingView's error state,
// which silently stopped accepting new tickers for the rest of the scan) — the payload was
// contract-valid the whole time (UNVERIFIED is a legal status), so validateLuxScanPayload
// never caught it, and it was initially misdiagnosed as an "illiquid small-cap data quirk"
// rather than the actual bug. All decisions downstream (decision-classify.mjs, and ultimately
// the LLM writing trade decisions) are built entirely on this JSON, so catching this class of
// silent corruption before it reaches them is the whole point of this function.
//
// errors: confirmed corruption — halt, don't let this data flow downstream.
// warnings: narrower or heuristic signals — surface loudly (report/log/email), but a single
// bad ticker or an unconfirmed pattern isn't grounds to block an entire unattended scan run,
// which could then silently stall data collection for days waiting on a human.
const WIPEOUT_RUN_THRESHOLD = 5; // 5+ consecutive symbols, unexplained, matches a batch-corruption signature
const NW_STARVATION_MIN_REVIEW = 5; // below this, one-off gaps are too noisy to be meaningful
const NW_STARVATION_RATIO = 0.15; // >15% of REVIEW symbols missing nw_position is suspicious

export function checkScanHealth(payload) {
  const errors = [];
  const warnings = [];
  const symbols = payload?.symbols_raw || payload?.symbols_scanned || [];

  if (payload?.indicator_error_warning) {
    errors.push(`Indicator entered an error state mid-scan: ${payload.indicator_error_warning}`);
  }

  const resolutionErrors = symbols.filter(s => s?.resolution_error);
  if (resolutionErrors.length > 0) {
    warnings.push(
      `${resolutionErrors.length} symbol(s) could not be resolved by TradingView: ` +
      `${resolutionErrors.map(s => s.symbol).join(', ')}. Check the source watchlist ` +
      `(CSV/config) for a typo'd or delisted ticker.`
    );
  }

  // Batch-wipeout heuristic: a run of consecutive symbols (original scan order) with so/pac/osc
  // ALL unverified and no already-attributed cause is the signature of an indicator race or
  // error-state we haven't specifically detected — a backstop for failure modes not yet coded for.
  let run = 0, runStart = -1, maxRun = 0, worstRunStart = -1;
  symbols.forEach((s, i) => {
    const fullyVoid = s?.so_status === 'UNVERIFIED' && s?.pac_status === 'UNVERIFIED' &&
      s?.osc_status === 'UNVERIFIED' && !s?.resolution_error;
    if (fullyVoid) {
      if (run === 0) runStart = i;
      run++;
      if (run > maxRun) { maxRun = run; worstRunStart = runStart; }
    } else {
      run = 0;
    }
  });
  if (maxRun >= WIPEOUT_RUN_THRESHOLD) {
    const affected = symbols.slice(worstRunStart, worstRunStart + maxRun).map(s => s.symbol);
    warnings.push(
      `${maxRun} consecutive symbols have so/pac/osc all UNVERIFIED with no attributed cause ` +
      `(${affected.join(', ')}) — matches the signature of an indicator race or error-state, ` +
      `not genuine data unavailability. Treat with suspicion; consider re-running this scan.`
    );
  }

  // NW-starvation heuristic: REVIEW-eligible symbols should get an NW check (see
  // lux_screener.js's passingSymbols step) — a large share missing nw_position usually means
  // that step got cut off (e.g. its own timeout), not that NW is genuinely unavailable for them.
  const reviewSymbols = symbols.filter(s => s?.eligibility === 'REVIEW');
  const nwMissing = reviewSymbols.filter(s => s?.nw_position == null);
  if (reviewSymbols.length >= NW_STARVATION_MIN_REVIEW && nwMissing.length / reviewSymbols.length > NW_STARVATION_RATIO) {
    warnings.push(
      `${nwMissing.length}/${reviewSymbols.length} REVIEW-eligible symbols are missing nw_position ` +
      `(${nwMissing.map(s => s.symbol).join(', ')}) — likely the NW-check step was cut off ` +
      `(check nw_pass_error) rather than a genuine per-symbol failure.`
    );
  }

  return { healthy: errors.length === 0, errors, warnings };
}
