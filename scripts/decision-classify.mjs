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

function qualifiesSetup(s) {
  return ['A', 'B'].includes(s.setup_quality) && ['FAVORABLE', 'ACCEPTABLE'].includes(s.entry_quality);
}

function qualify(s) {
  if (s.eligibility === 'REJECT') return 'reject';
  if (qualifiesSetup(s) && s.nw_position === 'inside' && typeof s.rr === 'number' && s.rr >= 2.0) return 'ready';
  if (qualifiesSetup(s) && s.nw_position === 'inside' && typeof s.rr !== 'number') return 'ready_norr';
  if (qualifiesSetup(s) && s.nw_position === 'inside') return 'watch_low_rr';
  if (s.nw_position === 'extended' && s.setup_quality === 'A' && ['LATE', 'EXTENDED'].includes(s.entry_quality) && ['STRONG', 'HEALTHY'].includes(s.evidence_state?.momentum_quality)) return 'extended_continuation';
  if (s.nw_position === 'extended') return 'watch_extended';
  if (s.nw_position === 'early') return 'watch_early';
  return 'watch_unknown';
}

const passers = [];
const fails = [];
for (const s of d.symbols_raw) {
  if (s.eligibility !== 'REJECT') {
    passers.push({ ...s, qualification: qualify(s) });
  } else {
    fails.push({ ...s, reason: failReason(s) });
  }
}

passers.sort((a, b) => (b.rank_score ?? b.score ?? -Infinity) - (a.rank_score ?? a.score ?? -Infinity) || (b.score ?? -Infinity) - (a.score ?? -Infinity));

const buckets = {
  ready: passers.filter(p => p.qualification === 'ready'),
  ready_norr: passers.filter(p => p.qualification === 'ready_norr'),
  extended_continuation: passers.filter(p => p.qualification === 'extended_continuation'),
  watch_extended: passers.filter(p => p.qualification === 'watch_extended'),
  watch_early: passers.filter(p => p.qualification === 'watch_early'),
  watch_low_rr: passers.filter(p => p.qualification === 'watch_low_rr'),
  watch_unknown: passers.filter(p => p.qualification === 'watch_unknown'),
};

const actionable = buckets.ready.length + buckets.ready_norr.length + buckets.extended_continuation.length;

const out = {
  instrument_type: d.instrument_type,
  symbol_count: d.symbol_count,
  passer_count: passers.length,
  ready_count: buckets.ready.length,
  ready_norr_count: buckets.ready_norr.length,
  extended_continuation_count: buckets.extended_continuation.length,
  actionable_count: actionable,
  watch_count: passers.length - actionable,
  fail_count: fails.length,
  buckets,
  fails,
};

// Sanity check: if many passers exist but none are actionable and all rr are null,
// the NW data pipeline is likely broken — warn loudly rather than silently producing all-watch output.
const allRrNull = passers.every(p => p.rr == null);
if (passers.length >= 3 && actionable === 0 && allRrNull) {
  console.warn(
    `WARNING [${d.instrument_type}]: ${passers.length} passers but 0 actionable and rr=null on all. ` +
    `NW band data is missing — check that Nadaraya-Watson Envelope is visible on the chart and ` +
    `getStudyValues() is returning its plot values. These passers landed in ready_norr (inside, no R:R).`
  );
}

writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(
  `${d.instrument_type}: ${d.symbol_count} scanned, ${passers.length} passed, ` +
  `${buckets.ready.length} ready, ${buckets.ready_norr.length} ready-norr, ` +
  `${buckets.extended_continuation.length} ext-continuation, ` +
  `${out.watch_count} watch, ${fails.length} failed -> ${outFile}`
);
