/**
 * Sanity tests — no TradingView connection needed.
 *
 * Covers:
 *   1. Config completeness  — rules.json consistent with ALL_INSTRUMENTS
 *   2. Strategy files       — all 6 exist and have required fields
 *   3. MCP wiring           — expected tool names registered in tool files + server.js
 *   4. Session round-trip   — saveSession / getSession file I/O logic
 *
 * Run: node --test tests/sanity.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG = join(ROOT, 'config');

const ALL_INSTRUMENTS = ['stocks', 'etf', 'ark', 'crypto', 'crypto_perps', 'futures'];

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ─── 1. Config completeness ──────────────────────────────────────────────────

describe('rules.json completeness', () => {
  const rules = loadJson(join(CONFIG, 'rules.json'));

  it('chart_tabs exists for every instrument', () => {
    for (const inst of ALL_INSTRUMENTS) {
      assert.ok(rules.chart_tabs?.[inst], `Missing chart_tabs["${inst}"]`);
      assert.ok(rules.chart_tabs[inst].chart_id,    `chart_tabs["${inst}"].chart_id is empty`);
      assert.ok(rules.chart_tabs[inst].layout_name, `chart_tabs["${inst}"].layout_name is empty`);
    }
  });

  it('screener_sources has an entry for every instrument', () => {
    for (const inst of ALL_INSTRUMENTS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(rules.screener_sources ?? {}, inst),
        `Missing screener_sources["${inst}"]`
      );
    }
  });

  it('screener-based instruments point to a non-null screener name', () => {
    for (const inst of ['stocks', 'etf', 'crypto', 'crypto_perps']) {
      assert.ok(rules.screener_sources[inst], `screener_sources["${inst}"] should be non-null`);
    }
  });

  it('futures has null screener source (uses static watchlist)', () => {
    assert.equal(rules.screener_sources['futures'], null);
  });

  it('global risk_rules is a non-empty array', () => {
    assert.ok(Array.isArray(rules.risk_rules) && rules.risk_rules.length > 0);
  });
});

// ─── 2. Strategy files ───────────────────────────────────────────────────────

describe('strategy files', () => {
  const REQUIRED_FIELDS = [
    'max_symbols', 'required_indicators', 'bias_criteria', 'entry_criteria', 'exit_criteria',
  ];
  const REQUIRED_INDICATORS = [
    'Trendlines with Breaks Oscillator [LuxAlgo]',
    'Nadaraya-Watson Envelope [LuxAlgo]',
    'Volume',
  ];

  for (const inst of ALL_INSTRUMENTS) {
    const path = join(CONFIG, `strategy-${inst}.json`);

    it(`strategy-${inst}.json exists`, () => {
      assert.ok(existsSync(path), `Missing ${path}`);
    });

    it(`strategy-${inst}.json has all required top-level fields`, () => {
      const s = loadJson(path);
      for (const field of REQUIRED_FIELDS) {
        assert.ok(field in s, `strategy-${inst}.json missing field: "${field}"`);
      }
    });

    it(`strategy-${inst}.json max_symbols is a positive integer`, () => {
      const { max_symbols } = loadJson(path);
      assert.ok(Number.isInteger(max_symbols) && max_symbols > 0,
        `max_symbols must be a positive integer, got ${max_symbols}`);
    });

    it(`strategy-${inst}.json required_indicators includes all 3 LuxAlgo indicators`, () => {
      const { required_indicators } = loadJson(path);
      for (const ind of REQUIRED_INDICATORS) {
        assert.ok((required_indicators ?? []).includes(ind),
          `strategy-${inst}.json missing indicator: "${ind}"`);
      }
    });
  }

  it('stocks and etf both have max_symbols = 20 (consistency)', () => {
    assert.equal(loadJson(join(CONFIG, 'strategy-stocks.json')).max_symbols, 20);
    assert.equal(loadJson(join(CONFIG, 'strategy-etf.json')).max_symbols, 20);
  });

  it('watchlist instruments (ark, futures) have non-empty watchlist array', () => {
    for (const inst of ['ark', 'futures']) {
      const { watchlist } = loadJson(join(CONFIG, `strategy-${inst}.json`));
      assert.ok(Array.isArray(watchlist) && watchlist.length > 0,
        `strategy-${inst}.json must have a non-empty watchlist array`);
    }
  });

  it('screener instruments have a screener_name string', () => {
    for (const inst of ['stocks', 'etf', 'ark', 'crypto', 'crypto_perps']) {
      const { screener_name } = loadJson(join(CONFIG, `strategy-${inst}.json`));
      assert.ok(typeof screener_name === 'string' && screener_name.length > 0,
        `strategy-${inst}.json must have a non-empty screener_name`);
    }
  });
});

// ─── 3. MCP wiring ──────────────────────────────────────────────────────────

describe('MCP tool wiring', () => {
  it('server.js imports every register* function', () => {
    const src = readFileSync(join(ROOT, 'src/server.js'), 'utf8');
    const expected = [
      'registerMorningTools', 'registerTabTools', 'registerScreenerTools',
      'registerChartTools',   'registerDataTools', 'registerHealthTools',
      'registerPineTools',    'registerCaptureTools', 'registerDrawingTools',
      'registerAlertTools',   'registerBatchTools', 'registerReplayTools',
      'registerUiTools',      'registerPaneTools',
    ];
    for (const fn of expected) {
      assert.ok(src.includes(fn), `server.js missing: ${fn}`);
    }
  });

  it('morning_brief, session_save, session_get are registered in tools/morning.js', () => {
    const src = readFileSync(join(ROOT, 'src/tools/morning.js'), 'utf8');
    for (const tool of ['morning_brief', 'session_save', 'session_get']) {
      assert.ok(src.includes(`'${tool}'`), `tools/morning.js missing tool: ${tool}`);
    }
  });

  it('tab_list, tab_switch, tab_new, tab_close are registered in tools/tab.js', () => {
    const src = readFileSync(join(ROOT, 'src/tools/tab.js'), 'utf8');
    for (const tool of ['tab_list', 'tab_switch', 'tab_new', 'tab_close']) {
      assert.ok(src.includes(`'${tool}'`), `tools/tab.js missing tool: ${tool}`);
    }
  });

  it('screener_get and screener_list are registered in tools/screener.js', () => {
    const src = readFileSync(join(ROOT, 'src/tools/screener.js'), 'utf8');
    for (const tool of ['screener_get', 'screener_list']) {
      assert.ok(src.includes(`'${tool}'`), `tools/screener.js missing tool: ${tool}`);
    }
  });

  it('morning_brief instrument_type enum includes all 6 instruments plus "all"', () => {
    const src = readFileSync(join(ROOT, 'src/tools/morning.js'), 'utf8');
    for (const inst of [...ALL_INSTRUMENTS, 'all']) {
      assert.ok(src.includes(`'${inst}'`), `morning_brief enum missing: '${inst}'`);
    }
  });

  it('session_save instrument_type enum includes daily_summary and all 6 instruments', () => {
    const src = readFileSync(join(ROOT, 'src/tools/morning.js'), 'utf8');
    for (const inst of [...ALL_INSTRUMENTS, 'daily_summary']) {
      assert.ok(src.includes(`'${inst}'`), `session_save enum missing: '${inst}'`);
    }
  });

  it('session_get instrument_type enum includes all 6 instruments', () => {
    const src = readFileSync(join(ROOT, 'src/tools/morning.js'), 'utf8');
    for (const inst of ALL_INSTRUMENTS) {
      assert.ok(src.includes(`'${inst}'`), `session_get enum missing: '${inst}'`);
    }
  });

  it('core/morning.js ALL_INSTRUMENTS matches the canonical 6', () => {
    const src = readFileSync(join(ROOT, 'src/core/morning.js'), 'utf8');
    // The array is a literal — check all 6 are present in the ALL_INSTRUMENTS line
    const match = src.match(/ALL_INSTRUMENTS\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, 'ALL_INSTRUMENTS array not found in core/morning.js');
    for (const inst of ALL_INSTRUMENTS) {
      assert.ok(match[1].includes(`'${inst}'`), `ALL_INSTRUMENTS missing: '${inst}'`);
    }
  });

  it('getSession types array in core/morning.js includes all 6 instruments', () => {
    const src = readFileSync(join(ROOT, 'src/core/morning.js'), 'utf8');
    // Find the types array inside getSession
    const match = src.match(/const types\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, 'types array not found in getSession in core/morning.js');
    for (const inst of ALL_INSTRUMENTS) {
      assert.ok(match[1].includes(`'${inst}'`), `getSession types missing: '${inst}'`);
    }
  });
});

// ─── 4. Session round-trip ───────────────────────────────────────────────────

describe('session file I/O round-trip', () => {
  // Replicate the minimal saveSession/getSession logic from core/morning.js
  // pointed at a temp dir so we don't touch real reports/

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tmpReports = join(tmpdir(), `tv-mcp-test-${Date.now()}`);

  function dateFolderName(date = new Date()) {
    return `${date.getFullYear()}-${MONTHS[date.getMonth()]}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function save({ brief, instrument_type = 'stocks', is_summary = false, date } = {}) {
    const now = date ? new Date(date) : new Date();
    const dir = join(tmpReports, dateFolderName(now));
    mkdirSync(dir, { recursive: true });
    const isDailySum = instrument_type === 'daily_summary';
    const filename = isDailySum ? 'daily-summary.md'
      : is_summary ? `${instrument_type}-summary.md`
      : `${instrument_type}.md`;
    const filePath = join(dir, filename);
    writeFileSync(filePath, `# Title\n${brief}`, 'utf8');
    return { success: true, path: filePath };
  }

  function get({ instrument_type, date } = {}) {
    const now = date ? new Date(date) : new Date();
    const filePath = join(tmpReports, dateFolderName(now), `${instrument_type}.md`);
    if (!existsSync(filePath)) return { success: false };
    return { success: true, content: readFileSync(filePath, 'utf8') };
  }

  before(() => mkdirSync(tmpReports, { recursive: true }));
  after(() => rmSync(tmpReports, { recursive: true, force: true }));

  const today = new Date().toISOString().split('T')[0];

  for (const inst of ALL_INSTRUMENTS) {
    it(`round-trip: ${inst}.md saves and reads back correctly`, () => {
      const text = `Test brief for ${inst}`;
      const saved = save({ brief: text, instrument_type: inst, date: today });
      assert.ok(saved.success);
      assert.ok(existsSync(saved.path), `File not created: ${saved.path}`);
      const got = get({ instrument_type: inst, date: today });
      assert.ok(got.success);
      assert.ok(got.content.includes(text));
    });
  }

  it('daily_summary writes to daily-summary.md, not stocks.md', () => {
    const saved = save({ brief: 'All 6 summaries here', instrument_type: 'daily_summary', date: today });
    assert.ok(saved.path.endsWith('daily-summary.md'), `Expected daily-summary.md, got: ${saved.path}`);
    assert.ok(existsSync(saved.path));
  });

  it('is_summary=true writes to {type}-summary.md', () => {
    const saved = save({ brief: 'Short summary', instrument_type: 'stocks', is_summary: true, date: today });
    assert.ok(saved.path.endsWith('stocks-summary.md'), `Expected stocks-summary.md, got: ${saved.path}`);
  });

  it('folder name format is YYYY-Mon-DD', () => {
    // Use a local date (not UTC string parse) to avoid timezone shift
    const d = new Date(2026, 5, 13); // month is 0-indexed: 5 = June
    assert.equal(dateFolderName(d), '2026-Jun-13');
  });
});
