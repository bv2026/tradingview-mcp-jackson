import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../evidence/latest/all-strategies-llm-input.json', import.meta.url)));
const families = ['momentum_stocks','momentum_etf','momentum_ark','sp_ndx','r2k','thematic_stocks','thematic_etfs','futures','crypto','crypto_perps'];

test('canonical all-strategies LLM package covers exactly the ten operational strategies', () => {
  assert.deepEqual(Object.keys(pkg.strategy_summaries), families);
  assert.deepEqual(Object.keys(pkg.candidates_by_strategy), families);
  assert.equal(pkg.invalid_or_insufficient_strategies.length, 0);
});

test('scores are populated for futures, spot crypto, and perps without cross-strategy ranking', () => {
  for (const family of ['futures','crypto','crypto_perps']) {
    assert.ok(pkg.strategy_summaries[family].score_versions.length);
    assert.ok(pkg.candidates_by_strategy[family].some(r => Number.isFinite(r.score)));
  }
  assert.match(pkg.manual_checks_global.join(' '), /strategy-local/i);
});

test('policy and exclusions are explicit and raw evidence is preserved', () => {
  assert.match(pkg.candidates_by_strategy.crypto[0].manual_checks.join(' '), /long-only/i);
  assert.equal(pkg.excluded_inputs.research_intelligence, 'EXCLUDED_FROM_OPERATIONAL_LLM_INPUT');
  assert.equal(pkg.excluded_inputs.coinbase_transitions, 'EXCLUDED_FROM_OPERATIONAL_LLM_INPUT');
  const perp = pkg.candidates_by_strategy.crypto_perps[0];
  assert.ok(perp.evidence && ('crypto_evidence_state' in perp.evidence || 'perp_evidence_state' in perp.evidence));
});

test('decision contract is ten independent analyses with strategy-local context on every candidate', () => {
  assert.equal(pkg.decision_contract.mode, 'TEN_INDEPENDENT_STRATEGY_CONTEXTS');
  assert.match(pkg.decision_contract.instruction, /independent decision analysis/i);
  assert.match(pkg.decision_contract.instruction, /Do not synthesize a consolidated strategy/i);
  assert.deepEqual(Object.keys(pkg.strategy_contexts), families);
  for (const family of families) {
    const context = pkg.strategy_contexts[family];
    assert.equal(context.strategy, family);
    assert.equal(context.strategy_context_version, 'v1-independent-context');
    for (const row of pkg.candidates_by_strategy[family]) {
      assert.equal(row.strategy, family);
      assert.equal(row.strategy_context_version, context.strategy_context_version);
      assert.deepEqual(row.strategy_context, context);
    }
  }
  assert.equal(pkg.strategy_contexts.crypto.policy, 'long-only');
  assert.equal(pkg.strategy_contexts.crypto_perps.policy, 'bidirectional');
  assert.equal(pkg.strategy_contexts.futures.policy, 'bidirectional');
  assert.ok(!('best_overall' in pkg));
  assert.ok(!('global_score' in pkg));
});
