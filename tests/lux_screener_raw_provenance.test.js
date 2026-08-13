import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { luxScreenerTestHelpers } from '../src/core/lux_screener.js';

describe('Lux raw provenance additions', () => {
  it('preserves the resolver-selected full symbol without changing the bare symbol', () => {
    assert.deepEqual(
      luxScreenerTestHelpers.resolveWatchlistEntry({ symbol: 'NASDAQ:ABC' }),
      { symbol: 'ABC', full_symbol: 'NASDAQ:ABC' },
    );
    assert.deepEqual(
      luxScreenerTestHelpers.resolveWatchlistEntry({ symbol: 'ABC', exchange: 'NYSE' }),
      { symbol: 'ABC', exchange: 'NYSE', full_symbol: 'NYSE:ABC' },
    );
  });

  it('reports only factual study availability states', () => {
    const { studyAvailability } = luxScreenerTestHelpers;
    assert.equal(studyAvailability({ ABC: { RATING: 'Bullish' } }, ['header', 'row'], 'ABC'), 'PRESENT');
    assert.equal(studyAvailability({}, ['header', 'row'], 'ABC'), 'ABSENT');
    assert.equal(studyAvailability({}, undefined, 'ABC'), 'UNVERIFIED');
  });

  it('keeps legacy fields and adds all four requested raw/provenance fields', () => {
    const src = readFileSync(new URL('../src/core/lux_screener.js', import.meta.url), 'utf8');
    for (const field of ['full_symbol', 'so_status', 'pac_status', 'osc_status', 'nw_raw_values', 'captured_at']) {
      assert.match(src, new RegExp(field));
    }
    for (const field of ['symbol:', 'so,', 'pac,', 'osc,', 'score: scoreSymbol']) {
      assert.match(src, new RegExp(field.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
    }
  });
});
