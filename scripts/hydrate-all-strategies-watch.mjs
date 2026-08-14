#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.TRADINGVIEW_ROOT || process.cwd(); const [strategy, symbol] = process.argv.slice(2);
if (!strategy || !symbol) throw new Error('Usage: node scripts/hydrate-all-strategies-watch.mjs <strategy> <symbol>');
const pkg = JSON.parse(readFileSync(join(root,'evidence/latest/all-strategies-llm-input.json'),'utf8'));
const ref = (pkg.watch_references_by_strategy?.[strategy] || []).find(r => r.symbol === symbol || r.full_symbol === symbol);
if (!ref) throw new Error(`No omitted WATCH reference for ${strategy}/${symbol}`);
const source = JSON.parse(readFileSync(join(root, ref.evidence_artifact),'utf8')); const rows = source.symbols_scanned || source.symbols_raw || source.rows || [];
const row = rows.find(r => r.symbol === ref.symbol || r.full_symbol === ref.full_symbol); if (!row) throw new Error(`Reference not found in canonical source: ${strategy}/${symbol}`);
if (String(row.eligibility ?? row.status).toUpperCase() !== 'WATCH') throw new Error('Hydrated row is no longer WATCH');
process.stdout.write(JSON.stringify({ strategy, reference: ref, evidence: row }, null, 2) + '\n');
