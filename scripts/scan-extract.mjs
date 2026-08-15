#!/usr/bin/env node
/**
 * Extracts the fields weekly-decision-routine actually consumes from a
 * lux_screener_scan result, dropping the markdown table/top_candidates/
 * avoid_list/chatter_section duplication and the per-symbol SO/PAC/OSC
 * fields the decision routine never reads.
 *
 * Two source shapes are handled:
 *  - The scan result auto-saved to a file when it exceeds the tool's
 *    inline-output size limit (path comes from the tool error message).
 *  - A scan result that printed inline: save it verbatim to a scratch
 *    file first (e.g. C:\Windows\Temp\<name>.json), then run this script
 *    on that scratch file the same way.
 *
 * Usage:
 *   node scan-extract.mjs <sourceFile> <outFile> <instrumentType>
 *   node scan-extract.mjs <sourceFile> <outFile> <instrumentType> --full
 *
 * Default mode writes a trimmed { instrument_type, symbol_count, symbols_raw }
 * for split scans (combine the two halves afterward with scan-merge.mjs).
 * --full keeps the whole scan object (minus "success") for single-call
 * scans that must be saved as-is (sp_ndx, r2k).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Keep only the fields weekly-decision-routine's glossary/rules actually use:
// score + nw_position/nw_upper/nw_lower/rr/price for the L3 hard filter and
// signals JSON, so.RATING/SIGNAL/SQUEEZE, pac.STRUCTURE/"P&D ZONES",
// osc.DIVERGENCES/"MONEY FLOW" for the per-symbol decision + conviction notes,
// theme/sub_group for thematic scans.
// V1 evidence-scoring fields required by lux-scan-contract + decision-classify:
// eligibility, so_status, pac_status, osc_status, rank_score, setup_quality,
// entry_quality, evidence_state, rejection_reasons.
// Exported (not just used internally) so tests can assert directly that new fields survive
// this trim step — this function is exactly where the 2026-08-15 field-strip gap lived.
export function trimSymbol(s) {
  const out = { symbol: s.symbol, score: s.score };
  if (s.rank_score != null) out.rank_score = s.rank_score;
  if (s.eligibility != null) out.eligibility = s.eligibility;
  if (s.setup_quality != null) out.setup_quality = s.setup_quality;
  if (s.entry_quality != null) out.entry_quality = s.entry_quality;
  if (s.evidence_state != null) out.evidence_state = s.evidence_state;
  if (s.rejection_reasons != null) out.rejection_reasons = s.rejection_reasons;
  if (s.so_status != null) out.so_status = s.so_status;
  if (s.pac_status != null) out.pac_status = s.pac_status;
  if (s.osc_status != null) out.osc_status = s.osc_status;
  if (s.theme != null) out.theme = s.theme;
  if (s.sub_group != null) out.sub_group = s.sub_group;
  if (s.nw_position != null) out.nw_position = s.nw_position;
  if (s.nw_upper != null) out.nw_upper = s.nw_upper;
  if (s.nw_lower != null) out.nw_lower = s.nw_lower;
  if (s.price != null) out.price = s.price;
  if (s.rr != null) out.rr = s.rr;
  if (s.so) out.so = { RATING: s.so.RATING, SIGNAL: s.so.SIGNAL, SQUEEZE: s.so.SQUEEZE };
  if (s.pac) out.pac = { STRUCTURE: s.pac.STRUCTURE, 'P&D ZONES': s.pac['P&D ZONES'] };
  if (s.osc) out.osc = { DIVERGENCES: s.osc.DIVERGENCES, 'MONEY FLOW': s.osc['MONEY FLOW'] };
  // 2026-08-15: unresolved-ticker marker from lux_screener.js's "str not found" detection.
  // Same field-strip gap class as the V1 evidence fields above — silently dropping this
  // would make a bad ticker (e.g. a typo'd symbol in the source watchlist) indistinguishable
  // from ordinary INSUFFICIENT/UNVERIFIED data on disk, for every instrument type that goes
  // through this default (non---full) trim path.
  if (s.resolution_error != null) out.resolution_error = s.resolution_error;
  if (s.resolution_error_reason != null) out.resolution_error_reason = s.resolution_error_reason;
  return out;
}

export function buildExtractedOutput(data, instrumentType, flag) {
  if (flag === '--full') {
    const { success, ...rest } = data;
    return rest;
  }
  const symbolsRaw = (data.symbols_raw || []).map(trimSymbol);
  const out = { instrument_type: instrumentType, symbol_count: data.symbol_count, symbols_raw: symbolsRaw };
  // Scan-level warnings (2026-08-15) — same rationale as the per-symbol resolution_error
  // fields above: these were being silently dropped for every split-scan instrument type
  // (this default branch), while --full-mode types (sp_ndx, r2k) kept them for free.
  // NOTE: split scans call lux_screener_scan once per offset batch, and each call runs its
  // own NW-check pass — if a later offset batch's warning isn't present on the source file
  // this script reads (e.g. persistRawEvidence's merge only kept the last batch's), that's
  // a gap in the accumulation step, not here; this only forwards whatever the source file has.
  if (data.nw_pass_error != null) out.nw_pass_error = data.nw_pass_error;
  if (data.indicator_error_warning != null) out.indicator_error_warning = data.indicator_error_warning;
  if (data.unresolved_symbols != null) out.unresolved_symbols = data.unresolved_symbols;
  return out;
}

// Only run the CLI when this file is executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , sourceFile, outFile, instrumentType, flag] = process.argv;

  if (!sourceFile || !outFile || !instrumentType) {
    console.error('Usage: node scan-extract.mjs <sourceFile> <outFile> <instrumentType> [--full]');
    process.exit(1);
  }

  const parsed = JSON.parse(readFileSync(sourceFile, 'utf-8'));

  // The harness sometimes persists large tool results wrapped in the raw MCP content
  // envelope ([{ type: "text", text: "<json string>" }]) instead of the tool's own
  // unwrapped JSON object. Detect and unwrap that shape so this script handles both
  // without a separate throwaway unwrap step.
  const data = Array.isArray(parsed) && parsed[0]?.text
    ? JSON.parse(parsed[0].text)
    : parsed;

  const out = buildExtractedOutput(data, instrumentType, flag);
  writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`Extracted ${out.symbols_raw ? out.symbols_raw.length : out.symbol_count} symbols -> ${outFile}`);
}
