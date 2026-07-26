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

const [, , sourceFile, outFile, instrumentType, flag] = process.argv;

if (!sourceFile || !outFile || !instrumentType) {
  console.error('Usage: node scan-extract.mjs <sourceFile> <outFile> <instrumentType> [--full]');
  process.exit(1);
}

const data = JSON.parse(readFileSync(sourceFile, 'utf-8'));

// Keep only the fields weekly-decision-routine's glossary/rules actually use:
// score + nw_position/nw_upper/nw_lower/rr/price for the L3 hard filter and
// signals JSON, so.RATING/SIGNAL/SQUEEZE, pac.STRUCTURE/"P&D ZONES",
// osc.DIVERGENCES/"MONEY FLOW" for the per-symbol decision + conviction notes,
// theme/sub_group for thematic scans.
function trimSymbol(s) {
  const out = { symbol: s.symbol, score: s.score };
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
  return out;
}

let out;
if (flag === '--full') {
  const { success, ...rest } = data;
  out = rest;
} else {
  const symbolsRaw = (data.symbols_raw || []).map(trimSymbol);
  out = { instrument_type: instrumentType, symbol_count: data.symbol_count, symbols_raw: symbolsRaw };
}

writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`Extracted ${out.symbols_raw ? out.symbols_raw.length : out.symbol_count} symbols -> ${outFile}`);
