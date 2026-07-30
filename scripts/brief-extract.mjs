#!/usr/bin/env node
/**
 * Extracts the fields a morning_brief report actually needs from a morning_brief
 * tool result, dropping the raw per-symbol indicators/nw_envelope_signals payload
 * (full LuxAlgo study dumps) that classify.js already parsed into hist/sig/gap/bias/
 * nw_position/sr_-fields/regime — those raw blocks are the reason a 30-symbol scan blows
 * past the inline tool-output size limit and gets auto-saved to a scratch file.
 *
 * Two source shapes are handled, same convention as scan-extract.mjs:
 *  - The result auto-saved to a file when it exceeds the tool's inline-output size
 *    limit (path comes from the tool's "Output saved to <path>" message).
 *  - A result that printed inline: save it verbatim to a scratch file first
 *    (e.g. C:\Windows\Temp\<type>_raw.json), then run this script on that file.
 *
 * Usage:
 *   node brief-extract.mjs <sourceFile> <outFile>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , sourceFile, outFile] = process.argv;

if (!sourceFile || !outFile) {
  console.error('Usage: node brief-extract.mjs <sourceFile> <outFile>');
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

// Keep only the fields a brief write-up (per CLAUDE.md's formatting convention) actually
// reads: fresh/error/stale, the precomputed hist/sig/gap/bias/nw_position/sr_*/regime/
// momentum_tag/ark_status/cluster fields classify.js already added, current price/volume
// from quote, and any stocktwits metadata. Drops raw `indicators` (full study dump),
// `nw_envelope_signals` (raw pine labels, already reduced to nw_position), and the
// per-symbol `timeframe` (constant across the whole scan).
function trimSymbol(s) {
  if (s.error) return { symbol: s.symbol, error: s.error, fresh: false, stale: true };

  const out = { symbol: s.symbol, fresh: s.fresh };
  if (s.stale) out.stale = s.stale;
  if (s.note) out.note = s.note;

  if (s.quote?.close != null) out.price = s.quote.close;
  if (s.quote?.volume != null) out.volume = s.quote.volume;

  for (const key of [
    'hist', 'sig', 'gap', 'bias', 'nw_position',
    'sr_resistance', 'sr_support', 'sr_break',
    'regime', 'momentum_tag', 'ark_status', 'cluster',
  ]) {
    if (s[key] !== undefined) out[key] = s[key];
  }
  if (s.stocktwits) out.stocktwits = s.stocktwits;

  return out;
}

const { instruction, ...rest } = data;
const out = {
  ...rest,
  symbols_scanned: (data.symbols_scanned || []).map(trimSymbol),
};

writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`Extracted ${out.symbols_scanned.length} symbols -> ${outFile}`);
