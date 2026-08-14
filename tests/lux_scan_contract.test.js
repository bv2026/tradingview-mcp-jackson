import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLuxScanPayload } from '../src/core/lux-scan-contract.js';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const row = (x = {}) => ({ symbol:'NASDAQ:TEST', so:{RATING:'Bullish'}, pac:{STRUCTURE:'BOS'}, osc:{}, score:5, eligibility:'REVIEW', so_status:'AVAILABLE', pac_status:'AVAILABLE', osc_status:'AVAILABLE', ...x });
test('rejects morning_brief-shaped Lux captures', () => { const r = validateLuxScanPayload({instrument_type:'sp_ndx',symbols_raw:[{symbol:'TEST',indicators:{},quote:{}}]}); assert.equal(r.valid,false); assert.match(r.errors.join(' '),/so is missing/); });
test('rejects missing symbols_raw and undefined Lux output', () => { assert.equal(validateLuxScanPayload({instrument_type:'momentum_etf'}).valid,false); assert.equal(validateLuxScanPayload({instrument_type:'r2k',symbols_raw:[row({score:undefined})]}).valid,false); });
test('accepts a complete Lux evidence-state capture', () => { assert.equal(validateLuxScanPayload({instrument_type:'sp_ndx',symbols_raw:[row()]}).valid,true); });
test('accepts insufficient-evidence rows without treating them as actionable', () => {
  assert.equal(validateLuxScanPayload({instrument_type:'r2k',symbols_raw:[row({ eligibility:'INSUFFICIENT', score:2 })]}).valid,true);
});
test('publisher report renders invalid Lux family from canonical package without undefined rows', async () => {
  const d = mkdtempSync(join(tmpdir(), 'lux-report-'));
  try {
    const root = join(d, 'reports', '2026-Wk33', '2026-Aug-14');
    mkdirSync(root, { recursive: true });
    mkdirSync(join(d, 'evidence', 'latest'), { recursive: true });
    writeFileSync(join(d, 'evidence', 'latest', 'all-strategies-llm-input.json'), JSON.stringify({
      freshness: { status: 'FRESH' }, strategy_summaries: {
        momentum_etf: { status: 'INVALID', errors: ['symbols_raw must be an array'], REVIEW: 0, WATCH: 0 }
      }, candidates_by_strategy: { momentum_etf: [] }
    }));
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['scripts/all-strategies-report.mjs', join(root, 'all.md')], { env: { ...process.env, TRADINGVIEW_ROOT: d } });
    const report = readFileSync(join(root, 'all.md'), 'utf8');
    assert.match(report, /momentum etf.*INVALID \/ SKIPPED/i);
    assert.doesNotMatch(report, /undefined/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('publisher report explicitly reports missing canonical package without legacy fallback', async () => {
  const d = mkdtempSync(join(tmpdir(), 'lux-report-missing-'));
  try {
    const root = join(d, 'reports', '2026-Wk33', '2026-Aug-14'); mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'scan-momentum_etf.invalid.json'), JSON.stringify({ errors: ['symbols_raw must be an array'] }));
    const { execFileSync } = await import('node:child_process');
    execFileSync(process.execPath, ['scripts/all-strategies-report.mjs', join(root, 'all.md')], { env: { ...process.env, TRADINGVIEW_ROOT: d } });
    const report = readFileSync(join(root, 'all.md'), 'utf8');
    assert.match(report, /canonical package is missing/i);
    assert.doesNotMatch(report, /Momentum ETF.*INVALID \/ SKIPPED/i);
    assert.doesNotMatch(report, /undefined/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
