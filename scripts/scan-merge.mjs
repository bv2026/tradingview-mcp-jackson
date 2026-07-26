#!/usr/bin/env node
/**
 * Merges two scan-extract.mjs outputs (from a split lux_screener_scan call
 * pair — offset=0 and offset=N) into one deduped, score-sorted result.
 *
 * Usage: node scan-merge.mjs <fileA> <fileB> <instrumentType> <outFile>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , fileA, fileB, instrumentType, outFile] = process.argv;

if (!fileA || !fileB || !instrumentType || !outFile) {
  console.error('Usage: node scan-merge.mjs <fileA> <fileB> <instrumentType> <outFile>');
  process.exit(1);
}

const a = JSON.parse(readFileSync(fileA, 'utf-8'));
const b = JSON.parse(readFileSync(fileB, 'utf-8'));

const seen = new Map();
for (const s of [...a.symbols_raw, ...b.symbols_raw]) {
  seen.set(s.symbol, s);
}
const deduped = [...seen.values()].sort((x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity));

const out = { instrument_type: instrumentType, symbol_count: deduped.length, symbols_raw: deduped };
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`Merged ${a.symbols_raw.length} + ${b.symbols_raw.length} -> ${deduped.length} unique -> ${outFile}`);
