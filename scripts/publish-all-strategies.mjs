#!/usr/bin/env node
/** Publish a complete dated bundle from canonical evidence without inventing LLM decisions. */
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { reportDirFor } from '../src/core/report_paths.js';
import { validateLuxScanPayload } from '../src/core/lux-scan-contract.js';

const root = process.env.TRADINGVIEW_ROOT || process.cwd();
const evidenceDir = join(root, 'evidence', 'latest');
const date = process.argv[2] ? new Date(`${process.argv[2]}T12:00:00`) : new Date();
const outDir = process.argv[3] || reportDirFor(date);
const families = ['momentum_stocks','momentum_etf','momentum_ark','sp_ndx','r2k','thematic_stocks','thematic_etfs','futures','crypto','crypto_perps'];
const rowsOf = d => d.symbols_scanned || d.symbols_raw || d.rows || [];
const esc = v => String(v ?? 'N/A').replaceAll('|', '\\|').replaceAll('\n', ' ');
const score = r => Number.isFinite(r.rank_score) ? r.rank_score : Number.isFinite(r.score) ? r.score : 'N/A';
const direction = r => r.setup_direction || r.direction || r.bias || 'UNKNOWN';
const status = r => r.eligibility || r.status || 'UNKNOWN';
mkdirSync(outDir, { recursive: true });

// CT/TV is a required futures evidence stage. Run it before replacing the
// compatibility futures.md so its parser sees the normal legacy brief format.
const { execFileSync } = await import('node:child_process');
const dateArg = date.toISOString().slice(0, 10);
const futuresSource = join(evidenceDir, 'futures.raw.json');
if (existsSync(futuresSource)) {
  const fd = JSON.parse(readFileSync(futuresSource, 'utf8'));
  const fr = rowsOf(fd);
  const ctInput = ['# FUTURES Morning Brief', '', '### Screener List', '', '| SYMBOL | BIAS | SIGNAL | WATCH |', '|---|---|---|---|',
    ...fr.map(r => `| ${esc(r.symbol)} | ${esc(r.bias)} | Hist ${r.hist ?? 'N/A'} above sig ${r.sig ?? 'N/A'} (${esc(r.regime)}) | NW ${esc(r.nw_position)} |`), ''].join('\n');
  writeFileSync(join(outDir, 'futures.md'), ctInput);
}
const ctJson = execFileSync('python', [join(root, 'scripts', 'ct_tv_data.py'), dateArg], {
  cwd: root, encoding: 'utf8', env: process.env,
});
const ctData = JSON.parse(ctJson);
if (ctData.error) throw new Error(`CT/TV fetch failed: ${ctData.error}`);
writeFileSync(join(outDir, 'ct_tv_data.json'), JSON.stringify(ctData, null, 2));


for (const family of families) {
  const source = join(evidenceDir, `${family}.raw.json`);
  if (!existsSync(source)) continue;
  const data = JSON.parse(readFileSync(source, 'utf8'));
  const contract = validateLuxScanPayload(data, data.instrument_type);
  const scanPath = join(outDir, `scan-${family}.json`);
  const invalidPath = join(outDir, `scan-${family}.invalid.json`);
  if (!contract.valid) {
    if (existsSync(scanPath)) unlinkSync(scanPath);
    writeFileSync(invalidPath, JSON.stringify({ family, status: 'INVALID', errors: contract.errors }, null, 2));
    const invalidBody = `# ${family.replaceAll('_', ' ').toUpperCase()} — INVALID / SKIPPED\n\nThe source artifact failed the Lux scan contract and was not published as actionable current-family output.\n\nValidation errors:\n${contract.errors.map(e => `- ${e}`).join('\n')}\n`;
    writeFileSync(join(outDir, family === 'momentum_ark' ? 'momentum_ark.md' : `${family}.md`), invalidBody);
    writeFileSync(join(outDir, family === 'momentum_ark' ? 'ark-decision.html' : family === 'crypto_perps' ? 'crypto-perps-decision.html' : `${family}-decision.html`), `<h1>${family} — INVALID / SKIPPED</h1><p>Lux scan contract validation failed. No actionable output was published.</p><pre>${esc(contract.errors.join('\n'))}</pre>`);
    continue;
  }
  if (existsSync(invalidPath)) unlinkSync(invalidPath);
  // scan-*.json is the compatibility input consumed by all-strategies-report.mjs.
  writeFileSync(scanPath, JSON.stringify(data, null, 2));
  const rows = rowsOf(data);
  const body = [
    `# ${family.replaceAll('_', ' ').toUpperCase()} Model Evidence`,
    `**Generated:** ${data.generated_at || new Date().toISOString()}`,
    '',
    '> This is deterministic model evidence published from the canonical fresh run. It is not an LLM decision and contains no fabricated recommendation.',
    '',
    `**Scanned:** ${rows.length} · **Fresh:** ${data.scan_quality?.fresh ?? 'N/A'} · **Stale:** ${data.scan_quality?.stale ?? 'N/A'}`,
    '',
    '| Symbol | Score | Direction | Setup | Entry | Eligibility | Evidence state |',
    '|---|---:|---|---|---|---|---|',
    ...rows.map(r => `| ${esc(r.symbol || r.full_symbol)} | ${score(r)} | ${esc(direction(r))} | ${esc(r.setup_quality || r.setup)} | ${esc(r.entry_quality || r.entry)} | ${esc(status(r))} | ${esc(JSON.stringify(r.evidence_state || r.futures_evidence_state || r.crypto_evidence_state || r.perp_evidence_state || {}))} |`),
    '',
    '## LLM Decision Input',
    '',
    'The structured rows above are the input for candidate-by-candidate LLM analysis. Final interpretation, conflicts, actionable recommendation, rationale, and manual checks must be added by the LLM layer.'
  ].join('\n');
  const mdName = family === 'momentum_ark' ? 'momentum_ark.md' : `${family}.md`;
  writeFileSync(join(outDir, mdName), body);
  const htmlName = family === 'momentum_ark' ? 'ark-decision.html' : family === 'crypto_perps' ? 'crypto-perps-decision.html' : `${family}-decision.html`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:1000px"><h1>${family} Decision Input</h1><p>Deterministic evidence only · Generated ${esc(data.generated_at)}</p><p><strong>No LLM recommendation has been generated in this publish step.</strong> Use the model evidence and structured rows in the dated bundle for the LLM decision layer.</p><h2>Decision status</h2><p>Pending LLM analysis and manual confirmation.</p><h2>Evidence</h2><pre style="white-space:pre-wrap">${esc(JSON.stringify(rows, null, 2))}</pre></div>`;
  writeFileSync(join(outDir, htmlName), html);
}

const allReport = join(outDir, 'all-strategies-decision.md');
process.env.TRADINGVIEW_ROOT = root;
// Invoke the existing presentation report after compatibility inputs are published.
execFileSync(process.execPath, [join(root, 'scripts', 'all-strategies-report.mjs'), allReport], { cwd: root, stdio: 'inherit', env: process.env });
const published = families.filter(f => existsSync(join(outDir, `scan-${f}.json`)));
const invalid = families.filter(f => existsSync(join(outDir, `scan-${f}.invalid.json`)));
const runLog = join(outDir, '_run-log.txt');
appendFileSync(runLog, `${new Date().toISOString()} PUBLISH COMPLETE — status=${invalid.length ? 'COMPLETED_WITH_INVALID_FAMILIES' : 'COMPLETED'}; source=evidence/latest validated; published=${published.join(',') || 'none'}; skipped_invalid=${invalid.join(',') || 'none'}; outputs=${outDir}; all-strategies=${allReport}\n`);
console.log(outDir);
