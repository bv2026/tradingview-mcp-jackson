import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreEvidenceState } from '../src/core/evidence-scoring.js';

const statuses = { so_status: 'PRESENT', pac_status: 'PRESENT', osc_status: 'PRESENT' };
const make = (so = {}, pac = {}, osc = {}, extra = {}) => scoreEvidenceState({ so, pac, osc, ...statuses, ...extra });

test('V1 scoring matrix', async (t) => {
  await t.test('strong bullish continuation, healthy momentum, favorable location', () => {
    const r = make({ RATING: 'Strong Bullish', SIGNAL: '▲+', 'LUX VOLATILITY': 'Moderate' }, { STRUCTURE: 'BOS (3)', 'P&D ZONES': 'Within Discount' }, { HWO: 'Up', CONFLUENCE: 'Strong' });
    assert.deepEqual([r.setup_quality, r.entry_quality, r.eligibility], ['A', 'FAVORABLE', 'REVIEW']); assert.ok(r.score >= 9);
  });
  await t.test('bearish divergence deteriorates but does not reject bullish trend', () => {
    const r = make({ RATING: 'Bullish', SIGNAL: '▲' }, { STRUCTURE: 'BOS (2)' }, { HWO: 'Up', DIVERGENCES: 'Bearish' });
    assert.equal(r.setup_quality, 'B'); assert.equal(r.evidence_state.momentum_quality, 'DETERIORATING'); assert.notEqual(r.eligibility, 'REJECT');
  });
  await t.test('CHoCH is transition, not rejection', () => { const r = make({ RATING: 'Bullish' }, { STRUCTURE: 'CHoCH' }, { HWO: 'Up' }); assert.equal(r.setup_quality, 'C'); assert.equal(r.eligibility, 'REVIEW'); });
  await t.test('bearish trend rejects with legacy sentinel', () => { const r = make({ RATING: 'Bearish' }, { STRUCTURE: 'BOS (2)' }, { HWO: 'Down' }); assert.deepEqual([r.setup_quality, r.eligibility, r.score], ['F', 'REJECT', -99]); });
  await t.test('missing S&O is medium confidence, not rejection', () => { const r = make({}, { STRUCTURE: 'BOS' }, { HWO: 'Up' }, { so_status: 'ABSENT' }); assert.equal(r.evidence_state.data_confidence, 'MEDIUM'); assert.notEqual(r.score, -99); });
  await t.test('all missing is insufficient score 2', () => { const r = make({}, {}, {}, { so_status: 'ABSENT', pac_status: 'ABSENT', osc_status: 'ABSENT' }); assert.deepEqual([r.setup_quality, r.eligibility, r.score], ['U', 'INSUFFICIENT', 2]); });
  await t.test('premium changes entry only', () => { const r = make({ RATING: 'Bullish' }, { STRUCTURE: 'BOS', 'P&D ZONES': 'Within Premium' }, { HWO: 'Up' }); assert.equal(r.setup_quality, 'A'); assert.equal(r.entry_quality, 'EXTENDED'); });
  await t.test('high risk lowers score one point', () => { const r = make({ RATING: 'Bullish', 'LUX VOLATILITY': 'High', 'TREND STRENGTH': 'Weak' }, { STRUCTURE: 'BOS' }, { HWO: 'Up' }); assert.equal(r.evidence_state.risk_volatility, 'HIGH_RISK'); assert.equal(r.score, 7); });
  await t.test('BOS, signal strength and divergence are metadata, not additive points', () => { const a = make({ RATING: 'Bullish', SIGNAL: '▲' }, { STRUCTURE: 'BOS (1)' }, { HWO: 'Up' }); const b = make({ RATING: 'Bullish', SIGNAL: '▲+' }, { STRUCTURE: 'BOS (9)' }, { HWO: 'Up', DIVERGENCES: 'Bullish' }); assert.equal(a.setup_quality, b.setup_quality); assert.equal(a.entry_quality, b.entry_quality); });
});
