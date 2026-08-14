import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSymbolFields } from '../src/core/classify.js';

const reading = (nw_envelope_signals) => ({ indicators: { studies: [] }, nw_envelope_signals });

test('readable NW study with no crossing label remains inside', () => {
  assert.equal(computeSymbolFields(reading({ studies: [{ labels: [] }] })).nw_position, 'inside');
});

test('missing or unreadable NW study remains unavailable, never inside', () => {
  for (const signals of [undefined, null, { studies: [] }]) {
    const position = computeSymbolFields(reading(signals)).nw_position;
    assert.equal(position, 'n/a');
    assert.notEqual(position, 'inside');
  }
});
