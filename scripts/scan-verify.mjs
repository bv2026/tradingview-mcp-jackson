#!/usr/bin/env node
/**
 * Verifies a set of scan-<type>.json report files: each must exist, parse as
 * JSON, have no top-level "error" key, and pass both structural validation
 * (every field present/typed correctly) and semantic health checks (silent
 * corruption that a structurally-valid payload can still contain — see
 * checkScanHealth's doc comment for the incident that motivated this).
 * Prints one OK/WARN/MISSING/ERROR line per file. Exits 1 if any file is
 * missing, malformed, structurally invalid, or semantically unhealthy
 * (checkScanHealth errors) — WARN-level findings print but don't fail the
 * exit code, since they're narrower/heuristic signals, not confirmed corruption.
 *
 * Usage: node scan-verify.mjs <file1> [file2 ...]
 */
import { readFileSync, existsSync } from 'node:fs';
import { validateLuxScanPayload, checkScanHealth } from '../src/core/lux-scan-contract.js';

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error('Usage: node scan-verify.mjs <file1> [file2 ...]');
  process.exit(1);
}

let allOk = true;
for (const f of files) {
  if (!existsSync(f)) {
    console.log(`${f}: MISSING`);
    allOk = false;
    continue;
  }
  try {
    const d = JSON.parse(readFileSync(f, 'utf-8'));
    if ('error' in d) {
      console.log(`${f}: ERROR - ${d.error}`);
      allOk = false;
    } else {
      const contract = validateLuxScanPayload(d, d.instrument_type);
      if (!contract.valid) { console.log(`${f}: ERROR - ${contract.errors.slice(0, 3).join('; ')}`); allOk = false; continue; }
      const health = checkScanHealth(d);
      if (!health.healthy) {
        console.log(`${f}: ERROR - ${health.errors.join(' | ')}`);
        allOk = false;
        continue;
      }
      const count = d.symbols_raw ? d.symbols_raw.length : d.symbol_count;
      console.log(`${f}: OK, symbols=${count}`);
      for (const w of health.warnings) console.log(`${f}: WARN - ${w}`);
    }
  } catch (e) {
    console.log(`${f}: ERROR - ${e.message}`);
    allOk = false;
  }
}

process.exit(allOk ? 0 : 1);
