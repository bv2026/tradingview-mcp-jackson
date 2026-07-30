#!/usr/bin/env node
/**
 * Verifies a set of scan-<type>.json report files: each must exist, parse as
 * JSON, and have no top-level "error" key. Prints one OK/MISSING/ERROR line
 * per file and exits 1 if any file failed, 0 if all passed.
 *
 * Usage: node scan-verify.mjs <file1> [file2 ...]
 */
import { readFileSync, existsSync } from 'node:fs';

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
      const count = d.symbols_raw ? d.symbols_raw.length : d.symbol_count;
      console.log(`${f}: OK, symbols=${count}`);
    }
  } catch (e) {
    console.log(`${f}: ERROR - ${e.message}`);
    allOk = false;
  }
}

process.exit(allOk ? 0 : 1);
