import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

test('LLM request chunks cover each strategy exactly once without cross-strategy mixing', () => {
  const root = mkdtempSync(join(tmpdir(), 'llm-coverage-'));
  try {
    mkdirSync(join(root, 'evidence/latest'), { recursive: true });
    const families = ['momentum_stocks', 'momentum_etf'];
    const candidates = Object.fromEntries(families.map(strategy => [strategy, [1, 2, 3, 4, 5].map(i => ({ strategy, symbol: `${strategy}:${i}`, status: ['REVIEW', 'WATCH', 'REJECT', 'INSUFFICIENT', 'WATCH'][i - 1] }))]));
    const pkg = { freshness: { per_strategy: {} }, strategy_contexts: Object.fromEntries(families.map(strategy => [strategy, { strategy, strategy_context_version: 'v1' }])), candidates_by_strategy: candidates, decision_contract: {} };
    writeFileSync(join(root, 'evidence/latest/all-strategies-llm-input.json'), JSON.stringify(pkg));
    execFileSync(process.execPath, [join(process.cwd(), 'scripts/run-all-strategies-llm.mjs')], { env: { ...process.env, TRADINGVIEW_ROOT: root, LLM_STRATEGY_CHUNK_SIZE: '2' } });
    const manifest = JSON.parse(readFileSync(join(root, 'reports', new Date().toISOString().slice(0, 10), 'llm-decisions/manifest.json')));
    assert.equal(manifest.coverage_complete, true);
    for (const strategy of families) {
      const coverage = manifest.coverage[strategy];
      assert.deepEqual([coverage.expected_row_count, coverage.analyzed_row_count, coverage.missing_row_count], [5, 5, 0]);
      const seen = [];
      for (const chunk of coverage.chunks) {
        const request = JSON.parse(readFileSync(join(root, 'reports', new Date().toISOString().slice(0, 10), 'llm-decisions', chunk.file.split('/').pop())));
        assert.ok(request.candidates.every(row => row.strategy === strategy));
        seen.push(...request.candidates.map(row => row.symbol));
      }
      assert.deepEqual(seen.sort(), candidates[strategy].map(row => row.symbol).sort());
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
