import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreCryptoEvidence } from '../src/core/crypto-evidence-scoring.js';

const row = (symbol, bias = 'bullish', extra = {}) => ({ symbol, bias, hist: 2, sig: 1, gap: 1, nw_position: 'inside', sr_break: 0, fresh: true, ...extra });
const cannon = (bias = 'UP', relationship = 'REFERENCE', levels = { Pivot: 1 }) => ({ available: true, status: 'AVAILABLE', bias, relationship, market_code: 'BTC', freshness: { status: 'FRESH' }, levels });

test('spot agreement and reference context never transfer Cannon prices', () => {
  const x = scoreCryptoEvidence(row('COINBASE:ETHUSD'), { instrumentType: 'crypto', cannonEvidence: cannon() });
  assert.equal(x.crypto_evidence_state.cross_context, 'AGREEMENT_LONG');
  assert.equal(x.setup_quality, 'A');
  assert.equal(x.market_context.cannon.levels, undefined);
  assert.equal(x.crypto_evidence_state.location.sr_support, null);
});
test('spot is long-only on bearish/conflict evidence', () => {
  const x = scoreCryptoEvidence(row('COINBASE:SOLUSD', 'bearish', { hist: -2, sig: -1, gap: -1 }), { instrumentType: 'crypto', cannonEvidence: cannon('UP') });
  assert.equal(x.crypto_evidence_state.cross_context, 'CONFLICT');
  assert.notEqual(x.setup_direction, 'SHORT');
  assert.equal(x.eligibility, 'WATCH');
});
test('PAXG resolves its Gold reference and Cannon absence stays usable TV-only', () => {
  const p = scoreCryptoEvidence(row('COINBASE:PAXGUSD'), { instrumentType: 'crypto', cannonEvidence: cannon('UP') });
  assert.equal(p.crypto_evidence_state.cannon_context.family, 'gold');
  const u = scoreCryptoEvidence(row('COINBASE:UNKNOWNUSD'), { instrumentType: 'crypto', cannonEvidence: { available: false, status: 'UNAVAILABLE' } });
  assert.equal(u.crypto_evidence_state.cross_context, 'TV_ONLY');
  assert.notEqual(u.eligibility, 'REJECT');
});
test('perps remain bidirectional and preserve location override semantics', () => {
  const x = scoreCryptoEvidence(row('COINBASE:BTCUSDC.P', 'bearish', { hist: -2, sig: -1, gap: -1, nw_position: 'extended', sr_break: 0 }), { instrumentType: 'crypto_perps', cannonEvidence: cannon('DOWN', 'DIRECT') });
  assert.equal(x.setup_direction, 'SHORT');
  assert.equal(x.perp_evidence_state.policy, 'PERP_BIDIRECTIONAL');
  assert.equal(x.entry_quality, 'CAUTION');
});
