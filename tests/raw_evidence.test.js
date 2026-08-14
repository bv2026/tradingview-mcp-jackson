import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { persistRawEvidence, rawEvidenceTestHelpers } from '../src/core/raw-evidence.js';

const setup = () => ({ localDir: mkdtempSync(join(tmpdir(), 'tv-evidence-')), driveDir: mkdtempSync(join(tmpdir(), 'tv-drive-')) });
const payload = (rows) => ({ instrument_type: 'sp_ndx', timeframe: '1W', symbols_raw: rows, captured_at: '2026-08-13T00:00:00.000Z' });

test('deterministic filename mapping and atomic overwrite mirror', () => {
  const { localDir, driveDir } = setup();
  const first = persistRawEvidence(payload([{ symbol: 'AAA', so: { RATING: 'Bullish' } }]), { instrumentType: 'sp_ndx', sourceTool: 'lux_screener_scan', localDir, driveDir });
  const second = persistRawEvidence(payload([{ symbol: 'BBB' }]), { instrumentType: 'sp_ndx', sourceTool: 'lux_screener_scan', localDir, driveDir });
  assert.equal(first.filename, rawEvidenceTestHelpers.FILENAMES.sp_ndx);
  assert.equal(second.filename, 'sp_ndx.raw.json');
  assert.deepEqual(JSON.parse(readFileSync(join(localDir, second.filename), 'utf8')).symbols_raw.map(r => r.symbol), ['BBB']);
  assert.deepEqual(JSON.parse(readFileSync(join(driveDir, second.filename), 'utf8')).symbols_raw.map(r => r.symbol), ['BBB']);
  assert.equal(JSON.parse(readFileSync(join(localDir, 'manifest.json'), 'utf8')).sp_ndx.status, 'success');
});

test('failed run does not replace last good local snapshot', () => {
  const { localDir, driveDir } = setup();
  persistRawEvidence(payload([{ symbol: 'GOOD' }]), { instrumentType: 'sp_ndx', sourceTool: 'test', localDir, driveDir });
  const broken = payload([{ symbol: 'BROKEN' }]);
  broken.circular = broken;
  const result = persistRawEvidence(broken, { instrumentType: 'sp_ndx', sourceTool: 'test', localDir, driveDir });
  assert.equal(result.success, false);
  assert.deepEqual(JSON.parse(readFileSync(join(localDir, 'sp_ndx.raw.json'), 'utf8')).symbols_raw.map(r => r.symbol), ['GOOD']);
});

test('split Lux persistence stages first slice and atomically publishes merged snapshot', () => {
  const { localDir, driveDir } = setup();
  const first = persistRawEvidence(payload([{ symbol: 'A' }]), { instrumentType: 'sp_ndx', sourceTool: 'lux_screener_scan', localDir, driveDir, complete: false });
  assert.equal(first.staged, true);
  assert.equal(existsSync(join(localDir, 'sp_ndx.raw.json')), false);
  persistRawEvidence(payload([{ symbol: 'B' }]), { instrumentType: 'sp_ndx', sourceTool: 'lux_screener_scan', localDir, driveDir, complete: true });
  assert.deepEqual(JSON.parse(readFileSync(join(localDir, 'sp_ndx.raw.json'), 'utf8')).symbols_raw.map(r => r.symbol), ['A', 'B']);
});
