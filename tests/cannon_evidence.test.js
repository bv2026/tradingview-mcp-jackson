import test from 'node:test';
import assert from 'node:assert/strict';
import { cannonEvidence, cannonMapping } from '../src/core/external-evidence/cannon.js';

test('Cannon mapping and live read-only evidence shape', () => {
  assert.equal(Object.keys(cannonMapping).length, 18);
  assert.equal(cannonMapping['ICEUS:CC1!'], 'CCE');
  assert.equal(cannonMapping['CME:ETH1!'], undefined);
  const missing = cannonEvidence('CBOT_MINI:YM1!', { captureDate: '2026-08-14' });
  assert.equal(missing.reason, 'NO_MARKET_MAPPING');
  const e = cannonEvidence('CME_MINI:ES1!', { captureDate: '2026-08-14', timeframe: 'D' });
  assert.equal(e.available, true); assert.equal(e.freshness.status, 'FRESH');
  assert.equal(e.timeframe_relation, 'same_daily_context');
  assert.deepEqual(Object.keys(e.levels), ['R3','R2','R1','Pivot','S1','S2','S3']);
  assert.equal(cannonEvidence('CME_MINI:ES1!', { captureDate: '2026-08-15' }).freshness.status, 'AGING');
  assert.equal(cannonEvidence('CME_MINI:ES1!', { captureDate: '2026-08-18', timeframe: '4H' }).freshness.status, 'STALE');
  assert.equal(cannonEvidence('CME_MINI:ES1!', { dbPath: 'C:\\missing\\cannonedge.db' }).reason, 'DATABASE_UNAVAILABLE');
});
