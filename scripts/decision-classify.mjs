#!/usr/bin/env node
/**
 * Applies weekly-decision-routine's STEP 4 hard filter + L3 qualification to
 * a scan-<type>.json file and buckets every symbol for report writing:
 *   - passes hard filter (score > -99) then qualifies by nw_position + rr
 *     into ready / watch_extended / watch_early / watch_low_rr / watch_unknown
 *   - fails get a short reason derived from S&O rating/signal/PAC structure
 *
 * Usage: node decision-classify.mjs <scanFile> <outFile>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , scanFile, outFile] = process.argv;

if (!scanFile || !outFile) {
  console.error('Usage: node decision-classify.mjs <scanFile> <outFile>');
  process.exit(1);
}

const d = JSON.parse(readFileSync(scanFile, 'utf-8'));

function failReason(s) {
  const rating = s.so?.RATING || '';
  const signal = s.so?.SIGNAL || '';
  const structure = s.pac?.STRUCTURE || '';
  if (!rating.includes('Bullish')) return `Fail — ${rating || 'no S&O rating'}`;
  if (!structure.startsWith('BOS')) return `Fail — ${structure || 'no PAC structure'}`;
  if (signal !== '▲' && signal !== '▲+') return `Fail — ${signal || 'no signal'}`;
  return 'Fail — hard filter';
}

function qualify(s) {
  if (s.nw_position === 'inside' && typeof s.rr === 'number' && s.rr >= 2.0) return 'ready';
  if (s.nw_position === 'inside') return 'watch_low_rr';
  if (s.nw_position === 'extended') return 'watch_extended';
  if (s.nw_position === 'early') return 'watch_early';
  return 'watch_unknown';
}

const passers = [];
const fails = [];
for (const s of d.symbols_raw) {
  if (s.score > -99) {
    passers.push({ ...s, qualification: qualify(s) });
  } else {
    fails.push({ ...s, reason: failReason(s) });
  }
}

passers.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

const buckets = {
  ready: passers.filter(p => p.qualification === 'ready'),
  watch_extended: passers.filter(p => p.qualification === 'watch_extended'),
  watch_early: passers.filter(p => p.qualification === 'watch_early'),
  watch_low_rr: passers.filter(p => p.qualification === 'watch_low_rr'),
  watch_unknown: passers.filter(p => p.qualification === 'watch_unknown'),
};

const out = {
  instrument_type: d.instrument_type,
  symbol_count: d.symbol_count,
  passer_count: passers.length,
  ready_count: buckets.ready.length,
  watch_count: passers.length - buckets.ready.length,
  fail_count: fails.length,
  buckets,
  fails,
};

writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(
  `${d.instrument_type}: ${d.symbol_count} scanned, ${passers.length} passed, ` +
  `${buckets.ready.length} ready, ${passers.length - buckets.ready.length} watch, ${fails.length} failed ` +
  `-> ${outFile}`
);
