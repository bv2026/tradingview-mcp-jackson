import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { luxScreenerTestHelpers, computeNwTimeoutMs } from '../src/core/lux_screener.js';
import { checkScanHealth } from '../src/core/lux-scan-contract.js';
import { trimSymbol, buildExtractedOutput } from '../scripts/scan-extract.mjs';

// Regression coverage for the 2026-08-15 incident: an r2k scan shipped with 10 symbols'
// so/pac/osc entirely blank (a typo'd ticker put S&O/OSC into TradingView's error state,
// which silently stopped accepting new tickers for the rest of the scan) — the payload was
// contract-valid throughout, so nothing caught it, and it was initially misdiagnosed as an
// "illiquid small-cap data quirk" rather than the actual bug. These tests cover the fixes:
// parseTableRows' not-found tracking, the scan-level health check, the NW-check timeout
// scaling, and scan-extract.mjs no longer silently dropping the new diagnostic fields.

describe('parseTableRows not-found tracking', () => {
  const { parseTableRows } = luxScreenerTestHelpers;

  it('counts "str not found" rows separately from real data rows', () => {
    const rows = [
      'TICKER | RATING',
      'ABC • W | ▲ Strong Bullish',
      'str not found • W | ',
      'DEF • W | ▽ Bearish',
    ];
    const { map, notFoundCount } = parseTableRows(rows);
    assert.deepEqual(Object.keys(map).sort(), ['ABC', 'DEF']);
    assert.equal(notFoundCount, 1);
  });

  it('returns zero notFoundCount when every row resolves', () => {
    const rows = ['TICKER | RATING', 'ABC • W | ▲ Strong Bullish'];
    const { notFoundCount } = parseTableRows(rows);
    assert.equal(notFoundCount, 0);
  });

  it('handles missing/short rows without throwing', () => {
    assert.deepEqual(parseTableRows(undefined), { map: {}, notFoundCount: 0 });
    assert.deepEqual(parseTableRows(['TICKER | RATING']), { map: {}, notFoundCount: 0 });
  });
});

describe('computeNwTimeoutMs', () => {
  it('scales with the number of passing symbols instead of a flat budget', () => {
    // 2026-08-15 sp_ndx incident: 29 REVIEW symbols, old flat 50000ms cut off after ~21.
    // The new formula must give 29 symbols comfortably more than the old flat budget.
    assert.ok(computeNwTimeoutMs(29) > 50000);
  });

  it('is monotonically increasing in passing-symbol count', () => {
    assert.ok(computeNwTimeoutMs(30) > computeNwTimeoutMs(10));
    assert.ok(computeNwTimeoutMs(10) > computeNwTimeoutMs(0));
  });

  it('covers the documented worst case (30 symbols, the passingSymbols slice cap)', () => {
    // Observed real-world pace was ~2.4s/symbol; the formula's 3000ms/symbol should clear
    // that with margin even for the maximum 30-symbol batch.
    assert.ok(computeNwTimeoutMs(30) >= 30 * 2400);
  });
});

describe('checkScanHealth', () => {
  const cleanSymbol = (symbol, overrides = {}) => ({
    symbol, score: 3, eligibility: 'REVIEW',
    so_status: 'PRESENT', pac_status: 'PRESENT', osc_status: 'PRESENT',
    nw_position: 'inside',
    ...overrides,
  });

  it('is healthy with no warnings for a clean payload', () => {
    const payload = { symbols_raw: [cleanSymbol('AAA'), cleanSymbol('BBB')] };
    const result = checkScanHealth(payload);
    assert.equal(result.healthy, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  it('errors (halts) when indicator_error_warning is present', () => {
    const payload = {
      symbols_raw: [cleanSymbol('AAA')],
      indicator_error_warning: 'S&O/OSC entered an error state during batch 1',
    };
    const result = checkScanHealth(payload);
    assert.equal(result.healthy, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /error state/);
  });

  it('warns (does not halt) on resolution_error symbols', () => {
    const payload = {
      symbols_raw: [
        cleanSymbol('AAA'),
        { symbol: 'FFAAI', score: -1, eligibility: 'INSUFFICIENT', so_status: 'UNVERIFIED', pac_status: 'UNVERIFIED', osc_status: 'UNVERIFIED', resolution_error: true, resolution_error_reason: 'not found' },
      ],
    };
    const result = checkScanHealth(payload);
    assert.equal(result.healthy, true);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /FFAAI/);
  });

  it('warns on a batch-wipeout run of 5+ consecutive unexplained fully-void symbols', () => {
    const voidSymbol = (symbol) => ({ symbol, score: 2, eligibility: 'INSUFFICIENT', so_status: 'UNVERIFIED', pac_status: 'UNVERIFIED', osc_status: 'UNVERIFIED' });
    const payload = {
      symbols_raw: [
        voidSymbol('A'), voidSymbol('B'), voidSymbol('C'), voidSymbol('D'), voidSymbol('E'),
        cleanSymbol('F'),
      ],
    };
    const result = checkScanHealth(payload);
    assert.equal(result.healthy, true);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /5 consecutive/);
  });

  it('does not double-count a resolution_error symbol toward the wipeout run', () => {
    const voidSymbol = (symbol) => ({ symbol, score: 2, eligibility: 'INSUFFICIENT', so_status: 'UNVERIFIED', pac_status: 'UNVERIFIED', osc_status: 'UNVERIFIED' });
    const payload = {
      symbols_raw: [
        voidSymbol('A'), voidSymbol('B'),
        { symbol: 'BAD', score: -1, eligibility: 'INSUFFICIENT', so_status: 'UNVERIFIED', pac_status: 'UNVERIFIED', osc_status: 'UNVERIFIED', resolution_error: true },
        voidSymbol('C'), voidSymbol('D'),
      ],
    };
    const result = checkScanHealth(payload);
    // Only 2 consecutive on either side of the resolution_error symbol — below the threshold.
    assert.ok(!result.warnings.some(w => /consecutive/.test(w)));
  });

  it('warns when too many REVIEW symbols are missing nw_position (NW-check truncation)', () => {
    const reviewNoNw = (symbol) => ({ symbol, score: 2, eligibility: 'REVIEW', so_status: 'PRESENT', pac_status: 'PRESENT', osc_status: 'PRESENT', nw_position: null });
    const symbols = [
      ...Array.from({ length: 5 }, (_, i) => cleanSymbol(`ok${i}`)),
      ...Array.from({ length: 5 }, (_, i) => reviewNoNw(`missing${i}`)),
    ];
    const result = checkScanHealth({ symbols_raw: symbols });
    assert.equal(result.healthy, true);
    assert.ok(result.warnings.some(w => /nw_position/.test(w)));
  });

  it('does not warn on a small number of REVIEW symbols even if all lack nw_position', () => {
    const reviewNoNw = (symbol) => ({ symbol, score: 2, eligibility: 'REVIEW', so_status: 'PRESENT', pac_status: 'PRESENT', osc_status: 'PRESENT', nw_position: null });
    const result = checkScanHealth({ symbols_raw: [reviewNoNw('A'), reviewNoNw('B')] });
    assert.ok(!result.warnings.some(w => /nw_position/.test(w)));
  });
});

describe('scan-extract.mjs preserves diagnostic fields (2026-08-15 field-strip gap)', () => {
  it('trimSymbol keeps resolution_error and resolution_error_reason', () => {
    const trimmed = trimSymbol({
      symbol: 'FFAAI', score: -1, eligibility: 'INSUFFICIENT',
      resolution_error: true, resolution_error_reason: 'not found',
    });
    assert.equal(trimmed.resolution_error, true);
    assert.equal(trimmed.resolution_error_reason, 'not found');
  });

  it('trimSymbol omits the fields entirely when absent (no false positives)', () => {
    const trimmed = trimSymbol({ symbol: 'AAA', score: 3, eligibility: 'REVIEW' });
    assert.equal('resolution_error' in trimmed, false);
  });

  it('default (non---full) extraction path forwards scan-level warnings', () => {
    const data = {
      symbol_count: 1,
      symbols_raw: [{ symbol: 'AAA', score: 3, eligibility: 'REVIEW' }],
      nw_pass_error: 'timeout after 50000ms',
      indicator_error_warning: 'S&O/OSC entered an error state during batch 1',
      unresolved_symbols: ['FFAAI'],
    };
    const out = buildExtractedOutput(data, 'momentum_stocks', undefined);
    assert.equal(out.nw_pass_error, 'timeout after 50000ms');
    assert.equal(out.indicator_error_warning, 'S&O/OSC entered an error state during batch 1');
    assert.deepEqual(out.unresolved_symbols, ['FFAAI']);
  });

  it('--full extraction path keeps scan-level warnings too (already worked, guard against regression)', () => {
    const data = {
      success: true,
      symbol_count: 1,
      symbols_raw: [{ symbol: 'AAA', score: 3, eligibility: 'REVIEW' }],
      indicator_error_warning: 'S&O/OSC entered an error state during batch 1',
    };
    const out = buildExtractedOutput(data, 'r2k', '--full');
    assert.equal(out.indicator_error_warning, 'S&O/OSC entered an error state during batch 1');
    assert.equal('success' in out, false);
  });
});
