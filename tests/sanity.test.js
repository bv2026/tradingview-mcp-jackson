/**
 * Sanity tests — no TradingView connection needed.
 *
 * Covers:
 *   1. Config completeness  — rules.json consistent with supported briefs
 *   2. Strategy files       — all supported briefs have the fields their pipeline needs
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
import { incomeEtfTestHelpers } from '../src/core/income_etf.js';
import { incomeEtfMonitorTestHelpers } from '../src/core/income_etf_monitor.js';
import {
  incomeEtfMonthlyReviewDirFor,
  incomeEtfWeekDirFor,
  reportDateFromInput,
  reportDirFor,
} from '../src/core/report_paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONFIG = join(ROOT, 'config');

const BRIEF_INSTRUMENTS = [
  'momentum_stocks', 'momentum_etf', 'momentum_ark',
  'crypto', 'crypto_perps', 'futures', 'sp_ndx', 'r2k',
];
const LIVE_SCREENER_INSTRUMENTS = ['momentum_stocks', 'momentum_etf'];
const STATIC_WATCHLIST_INSTRUMENTS = [
  'momentum_ark', 'crypto', 'crypto_perps', 'futures', 'sp_ndx', 'r2k',
];
const LUX_PIPELINE_INSTRUMENTS = [
  'momentum_stocks', 'momentum_etf', 'momentum_ark', 'sp_ndx', 'r2k',
];
const DIRECT_OSCILLATOR_INSTRUMENTS = ['crypto', 'crypto_perps', 'futures'];
const ALL_MODE_INSTRUMENTS = [
  'momentum_stocks', 'momentum_etf', 'crypto', 'crypto_perps', 'futures', 'sp_ndx', 'r2k',
];

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// ─── 1. Config completeness ──────────────────────────────────────────────────

describe('rules.json completeness', () => {
  const rules = loadJson(join(CONFIG, 'rules.json'));

  it('chart_tabs exists for every instrument', () => {
    for (const inst of BRIEF_INSTRUMENTS) {
      assert.ok(rules.chart_tabs?.[inst], `Missing chart_tabs["${inst}"]`);
      assert.ok(rules.chart_tabs[inst].chart_id,    `chart_tabs["${inst}"].chart_id is empty`);
      assert.ok(rules.chart_tabs[inst].layout_name, `chart_tabs["${inst}"].layout_name is empty`);
    }
  });

  it('screener_sources has an entry for every instrument', () => {
    for (const inst of BRIEF_INSTRUMENTS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(rules.screener_sources ?? {}, inst),
        `Missing screener_sources["${inst}"]`
      );
    }
  });

  it('live-screener instruments point to a non-null screener name', () => {
    for (const inst of LIVE_SCREENER_INSTRUMENTS) {
      assert.ok(rules.screener_sources[inst], `screener_sources["${inst}"] should be non-null`);
    }
  });

  it('static-watchlist instruments have null screener sources', () => {
    for (const inst of STATIC_WATCHLIST_INSTRUMENTS) {
      assert.equal(rules.screener_sources[inst], null,
        `screener_sources["${inst}"] should be null`);
    }
  });

  it('global risk_rules is a non-empty array', () => {
    assert.ok(Array.isArray(rules.risk_rules) && rules.risk_rules.length > 0);
  });
});

// ─── 2. Strategy files ───────────────────────────────────────────────────────

describe('strategy files', () => {
  const REQUIRED_FIELDS = [
    'instrument_type', 'max_symbols', 'default_timeframe', 'required_indicators',
    'entry_criteria', 'exit_criteria', 'risk_rules',
  ];
  const CHART_INDICATORS = [
    'Nadaraya-Watson Envelope [LuxAlgo]',
    'Volume',
  ];

  for (const inst of BRIEF_INSTRUMENTS) {
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

    it(`strategy-${inst}.json max_symbols is a non-negative integer (0 = uncapped, scan full screener)`, () => {
      const { max_symbols } = loadJson(path);
      assert.ok(Number.isInteger(max_symbols) && max_symbols >= 0,
        `max_symbols must be a non-negative integer, got ${max_symbols}`);
    });

    it(`strategy-${inst}.json includes the common chart indicators`, () => {
      const { required_indicators } = loadJson(path);
      for (const ind of CHART_INDICATORS) {
        assert.ok((required_indicators ?? []).includes(ind),
          `strategy-${inst}.json missing indicator: "${ind}"`);
      }
    });
  }

  it('direct oscillator strategies define bias criteria and require TWB', () => {
    for (const inst of DIRECT_OSCILLATOR_INSTRUMENTS) {
      const strategy = loadJson(join(CONFIG, `strategy-${inst}.json`));
      assert.ok(strategy.bias_criteria && typeof strategy.bias_criteria === 'object',
        `strategy-${inst}.json must define bias_criteria`);
      assert.ok(strategy.required_indicators.includes('Trendlines with Breaks Oscillator [LuxAlgo]'),
        `strategy-${inst}.json must require the TWB oscillator`);
    }
  });

  it('Lux screener strategies define their pipeline and NW position rules', () => {
    for (const inst of LUX_PIPELINE_INSTRUMENTS) {
      const strategy = loadJson(join(CONFIG, `strategy-${inst}.json`));
      assert.ok(typeof strategy.pipeline === 'string' && strategy.pipeline.length > 0,
        `strategy-${inst}.json must describe its Lux pipeline`);
      assert.ok(strategy.nw_position_rules && typeof strategy.nw_position_rules === 'object',
        `strategy-${inst}.json must define nw_position_rules`);
    }
  });

  it('momentum_stocks and momentum_etf both have max_symbols = 50 (capped to avoid tool timeout)', () => {
    // Uncapped (0) caused morning_brief to scan all ~100 screener symbols in one
    // MCP call and exceed the ~60-70s tool timeout — see ba2149f. 50 matches the
    // threshold already proven safe for thematic_etfs; the "all" workflow
    // auto-batches these two (offset 0 + 50) to still cover the full screener.
    assert.equal(loadJson(join(CONFIG, 'strategy-momentum_stocks.json')).max_symbols, 50);
    assert.equal(loadJson(join(CONFIG, 'strategy-momentum_etf.json')).max_symbols, 50);
  });

  it('static-watchlist instruments have non-empty watchlist arrays', () => {
    for (const inst of STATIC_WATCHLIST_INSTRUMENTS) {
      const { watchlist } = loadJson(join(CONFIG, `strategy-${inst}.json`));
      assert.ok(Array.isArray(watchlist) && watchlist.length > 0,
        `strategy-${inst}.json must have a non-empty watchlist array`);
    }
  });

  it('live-screener strategies have a screener_name string', () => {
    for (const inst of LIVE_SCREENER_INSTRUMENTS) {
      const { screener_name } = loadJson(join(CONFIG, `strategy-${inst}.json`));
      assert.ok(typeof screener_name === 'string' && screener_name.length > 0,
        `strategy-${inst}.json must have a non-empty screener_name`);
    }
  });

  it('static-watchlist strategies are uncapped or cover their full watchlist', () => {
    for (const inst of STATIC_WATCHLIST_INSTRUMENTS) {
      const { max_symbols, watchlist } = loadJson(join(CONFIG, `strategy-${inst}.json`));
      assert.ok(max_symbols === 0 || max_symbols >= watchlist.length,
        `strategy-${inst}.json max_symbols=${max_symbols} truncates its ${watchlist.length}-symbol watchlist`);
    }
  });

  it('CSV regeneration preserves uncapped crypto, perps, and futures scans', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'build-watchlist-configs.mjs'), 'utf8');
    assert.ok(!/delete\s+cfg\.max_symbols/.test(src),
      'watchlist builder must not delete max_symbols');
    assert.ok((src.match(/max_symbols:\s+0/g) ?? []).length >= 3,
      'watchlist builder must set max_symbols: 0 for crypto, perps, and futures');
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
    for (const tool of ['screener_get', 'screener_list', 'income_etf_scan', 'income_etf_monitor']) {
      assert.ok(src.includes(`'${tool}'`), `tools/screener.js missing tool: ${tool}`);
    }
  });

  it('screener_get exposes optional visible-column extraction', () => {
    const src = readFileSync(join(ROOT, 'src/tools/screener.js'), 'utf8');
    assert.ok(src.includes('include_columns'));
  });

  it('income ETF parsing handles TradingView percentages and scaled currency', () => {
    const { parseNumber, yieldQuality } = incomeEtfTestHelpers;
    assert.equal(parseNumber('−12.34%'), -12.34);
    assert.equal(parseNumber('+120.22 M USD'), 120_220_000);
    assert.equal(parseNumber('—'), null);
    assert.ok(yieldQuality(20) > yieldQuality(55),
      'sustainable indicated yields should score above extreme yields');
  });

  it('income ETF qualification uses score and hard gates instead of a fund-count target', () => {
    const { qualification } = incomeEtfTestHelpers;
    const healthy = {
      score: 78,
      indicated_yield_pct: 14,
      nav_total_return_3m_pct: 6,
      nav_total_return_1m_pct: 2,
      nav_total_return_1y_pct: 18,
      nav_performance_1y_pct: 5,
      aum: 500_000_000,
      daily_dollar_volume: 10_000_000,
      flags: [],
    };
    assert.equal(qualification(healthy, 55).status, 'QUALIFIED');
    assert.equal(
      qualification({ ...healthy, nav_total_return_1y_pct: -2 }, 55).status,
      'EXCLUDED'
    );
    assert.ok(
      qualification({ ...healthy, indicated_yield_pct: 65 }, 55)
        .rejection_reasons.includes('EXTREME_INDICATED_YIELD')
    );
  });

  it('income ETF exposure classification recognizes broad-index option funds before concentration', () => {
    const { exposureBucket } = incomeEtfTestHelpers;
    assert.equal(exposureBucket({
      ticker: 'IWMI',
      name: 'Russell 2000 High Income ETF',
      holdings_count: 1,
      top_10_weight_pct: 100,
    }), 'small_cap');
    assert.equal(exposureBucket({
      ticker: 'APLY',
      name: 'Single Stock Option Income ETF',
      holdings_count: 1,
      top_10_weight_pct: 100,
    }), 'single_asset_or_synthetic');
  });

  it('income ETF portfolio sizes by score, applies caps, and can retain cash', () => {
    const { buildPortfolio } = incomeEtfTestHelpers;
    const base = {
      tier: 'CORE_CANDIDATE',
      distribution_frequency: 'Monthly',
      indicated_yield_pct: 12,
      nav_total_return_3m_pct: 5,
      nav_total_return_1m_pct: 1,
      nav_total_return_1y_pct: 15,
      nav_performance_1y_pct: 4,
      aum: 500_000_000,
      daily_dollar_volume: 5_000_000,
      holdings_count: 100,
      top_10_weight_pct: 30,
      flags: [],
    };
    const portfolio = buildPortfolio([
      { ...base, symbol: 'AAA', ticker: 'AAA', name: 'Alpha Income', score: 85 },
      { ...base, symbol: 'BBB', ticker: 'BBB', name: 'Beta Income', score: 70 },
      {
        ...base,
        symbol: 'BAD',
        ticker: 'BAD',
        name: 'Eroding Income',
        score: 90,
        nav_total_return_1y_pct: -10,
      },
    ], { portfolioValue: 100_000, maximumPositionPct: 12 });

    assert.equal(portfolio.qualified_count, 2);
    assert.ok(portfolio.cash_pct > 0, 'position caps should permit unallocated cash');
    assert.ok(
      portfolio.positions.find(position => position.ticker === 'AAA').allocation_pct >
      portfolio.positions.find(position => position.ticker === 'BBB').allocation_pct,
      'the higher-scored qualifying fund should receive the larger allocation'
    );
    assert.equal(portfolio.excluded_count, 1);
  });

  it('income ETF monitor detects model exits, score moves, and cash changes', () => {
    const { compareSnapshots, alertSummary } = incomeEtfMonitorTestHelpers;
    const previous = {
      all: [
        { ticker: 'AAA', score: 80, indicated_yield_pct: 12, nav_total_return_1m_pct: 1 },
        { ticker: 'BBB', score: 70, indicated_yield_pct: 15, nav_total_return_1m_pct: 1 },
      ],
      portfolio: {
        cash_pct: 20,
        positions: [
          { ticker: 'AAA', score: 80, allocation_pct: 8 },
          { ticker: 'BBB', score: 70, allocation_pct: 6 },
        ],
      },
    };
    const current = {
      all: [
        { ticker: 'AAA', score: 65, indicated_yield_pct: 12, nav_total_return_1m_pct: -12.5 },
        { ticker: 'BBB', score: 60, indicated_yield_pct: 20, nav_total_return_1m_pct: 0 },
      ],
      portfolio: {
        cash_pct: 27,
        positions: [{ ticker: 'BBB', score: 60, allocation_pct: 4 }],
      },
    };
    const alerts = compareSnapshots(previous, current);
    assert.ok(alerts.some(alert => alert.id === 'MODEL_EXIT:AAA'));
    assert.ok(alerts.some(alert => alert.id === 'SCORE_MOVE:AAA'));
    assert.ok(alerts.some(alert => alert.id === 'SEVERE_DRAWDOWN:AAA'));
    assert.ok(alerts.some(alert => alert.id === 'MODEL_CASH_MOVE'));
    assert.equal(alertSummary(alerts).highest_severity, 'critical');
  });

  it('income ETF monitor compares external holdings without placing trades', () => {
    const { buildRebalanceComparison } = incomeEtfMonitorTestHelpers;
    const comparison = buildRebalanceComparison({
      maximum_position_pct: 8,
      cash_pct: 20,
      positions: [
        { ticker: 'AAA', score: 80, allocation_pct: 8 },
        { ticker: 'BBB', score: 70, allocation_pct: 6 },
      ],
    }, {
      as_of: '2026-07-25',
      cash: 10_000,
      positions: [
        { ticker: 'AAA', market_value: 20_000 },
        { ticker: 'OLD', market_value: 70_000 },
      ],
    });

    assert.equal(comparison.available, true);
    assert.equal(comparison.execution_policy, 'Recommendations only. No orders are created or submitted.');
    assert.equal(
      comparison.rows.find(row => row.ticker === 'OLD').action,
      'REVIEW_EXIT'
    );
    assert.ok(comparison.alerts.some(alert => alert.id === 'POSITION_CAP_BREACH:AAA'));
  });

  it('income ETF monitor aggregates duplicate broker CSV lots by ticker', () => {
    const { parseBrokerPortfolioCsv } = incomeEtfMonitorTestHelpers;
    const portfolio = parseBrokerPortfolioCsv([
      'Ticker,Name,Sh,Total Cost,Mkt Value',
      'AAA,\"Alpha, Income ETF\",10,\"$1,000\",\"$1,200\"',
      'AAA,\"Alpha, Income ETF\",5,\"$550\",\"$600\"',
      'BBB,Beta ETF,20,\"$2,000\",\"$1,900\"',
    ].join('\n'), { cash: 500, asOf: '2026-07-25' });

    assert.equal(portfolio.cash, 500);
    assert.equal(portfolio.positions.length, 2);
    assert.deepEqual(
      portfolio.positions.find(position => position.ticker === 'AAA'),
      { ticker: 'AAA', market_value: 1800, shares: 15, cost_basis: 1550 }
    );
    assert.deepEqual(
      portfolio.source.duplicate_tickers,
      [{ ticker: 'AAA', lots: 2 }]
    );
  });

  it('income ETF monitor treats omitted CSV cash as unknown and allows flexible funding', () => {
    const { parseBrokerPortfolioCsv, buildRebalanceComparison } =
      incomeEtfMonitorTestHelpers;
    const portfolio = parseBrokerPortfolioCsv([
      'Ticker,Mkt Value',
      'AAA,"$10,000"',
    ].join('\n'));
    const comparison = buildRebalanceComparison({
      maximum_position_pct: 100,
      cash_pct: 0,
      positions: [
        { ticker: 'AAA', score: 80, allocation_pct: 50 },
        { ticker: 'BBB', score: 75, allocation_pct: 50 },
      ],
    }, portfolio, { allowAdditionalFunding: true });

    assert.equal(portfolio.cash, null);
    assert.equal(portfolio.source.cash_source, 'not_reported');
    assert.equal(comparison.actual_cash, null);
    assert.equal(comparison.cash_status, 'not_reported');
    assert.equal(comparison.allow_additional_funding, true);
    assert.match(comparison.buying_power_policy, /external funding or margin/i);
    assert.equal(
      comparison.rows.find(row => row.ticker === 'BBB').action,
      'BUY_CANDIDATE'
    );
  });

  it('income ETF monitor stages taxable-account reductions by aggregate gain or loss', () => {
    const { buildRebalanceComparison } = incomeEtfMonitorTestHelpers;
    const comparison = buildRebalanceComparison({
      maximum_position_pct: 8,
      cash_pct: 20,
      positions: [],
    }, {
      positions: [
        { ticker: 'LOSS', market_value: 8000, cost_basis: 10_000 },
        { ticker: 'GAIN', market_value: 12_000, cost_basis: 10_000 },
      ],
    }, {
      taxableAccount: true,
      gradualReconciliation: true,
    });

    assert.equal(
      comparison.rows.find(row => row.ticker === 'LOSS').transition_action,
      'HARVEST_LOSS_REVIEW'
    );
    assert.equal(
      comparison.rows.find(row => row.ticker === 'GAIN').transition_action,
      'DEFER_OR_OFFSET_GAIN'
    );
    assert.match(comparison.transition_policy, /not an instruction to liquidate/i);
    assert.equal(comparison.tax_data_limitations.length, 3);
  });

  it('income ETF artifacts use the dedicated weekly reports tree', () => {
    const weekly = incomeEtfWeekDirFor(new Date(2026, 6, 25));
    const monthly = incomeEtfMonthlyReviewDirFor(new Date(2026, 6, 25));
    assert.ok(weekly.endsWith(join('reports', 'inc-etf', '2026-Wk30')));
    assert.ok(monthly.endsWith(join(
      'reports',
      'inc-etf',
      'Mon-review',
      '2026-Jul'
    )));

    const src = readFileSync(join(ROOT, 'src/core/income_etf.js'), 'utf8');
    const monitorSrc = readFileSync(join(ROOT, 'src/core/income_etf_monitor.js'), 'utf8');
    assert.ok(src.includes("join(reportDir, 'scan-income_etf.json')"));
    assert.ok(monitorSrc.includes("join(reportDir, 'income_etf-alerts.json')"));
  });

  it('date-only report inputs stay on the requested local calendar date', () => {
    const parsed = reportDateFromInput('2026-07-25');
    assert.equal(parsed.getFullYear(), 2026);
    assert.equal(parsed.getMonth(), 6);
    assert.equal(parsed.getDate(), 25);
  });

  it('morning_brief instrument_type enum includes all supported briefs plus "all"', () => {
    const src = readFileSync(join(ROOT, 'src/tools/morning.js'), 'utf8');
    for (const inst of [...BRIEF_INSTRUMENTS, 'all']) {
      assert.ok(src.includes(`'${inst}'`), `morning_brief enum missing: '${inst}'`);
    }
  });

  it('session_save instrument_type enum includes daily_summary and all supported briefs', () => {
    const src = readFileSync(join(ROOT, 'src/tools/morning.js'), 'utf8');
    for (const inst of [...BRIEF_INSTRUMENTS, 'income_etf', 'daily_summary']) {
      assert.ok(src.includes(`'${inst}'`), `session_save enum missing: '${inst}'`);
    }
  });

  it('session_get instrument_type enum includes all supported briefs', () => {
    const src = readFileSync(join(ROOT, 'src/tools/morning.js'), 'utf8');
    for (const inst of [...BRIEF_INSTRUMENTS, 'income_etf']) {
      assert.ok(src.includes(`'${inst}'`), `session_get enum missing: '${inst}'`);
    }
  });

  it('income ETF scan instructs the caller to render and persist the standard report', () => {
    const src = readFileSync(join(ROOT, 'src/core/income_etf.js'), 'utf8');
    assert.ok(src.includes('## Portfolio Decision'));
    assert.ok(src.includes('session_save with instrument_type="income_etf"'));
    assert.ok(src.includes('scan-income_etf.json'));
  });

  it('core/morning.js ALL_INSTRUMENTS matches the standard all-mode sequence', () => {
    const src = readFileSync(join(ROOT, 'src/core/morning.js'), 'utf8');
    const match = src.match(/ALL_INSTRUMENTS\s*=\s*\[([^\]]+)\]/);
    assert.ok(match, 'ALL_INSTRUMENTS array not found in core/morning.js');
    const actual = [...match[1].matchAll(/'([^']+)'/g)].map(item => item[1]);
    assert.deepEqual(actual, ALL_MODE_INSTRUMENTS);
    assert.ok(src.includes('THEMATIC STEP 0 — ARK Innovation'),
      'all-mode instructions must route momentum_ark through lux_screener_scan');
  });

  it('getSession discovers available briefs dynamically instead of a fixed types list', () => {
    // getSession used to enumerate a fixed instrument-type array, which meant every
    // new instrument_type (momentum_etf, sp_ndx, thematic_stocks, ...) needed a
    // matching edit here — a maintenance trap. It was refactored to scan the
    // report directory's .md files instead, so it always reflects whatever
    // briefs actually got saved that day. Assert the dynamic-scan shape stays in
    // place rather than reintroducing a fixed list.
    const src = readFileSync(join(ROOT, 'src/core/morning.js'), 'utf8');
    assert.ok(/readdirSync\(reportDir\)\.filter\(f => f\.endsWith\('\.md'\)\)/.test(src),
      'getSession no longer dynamically scans the report directory for .md files');
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

  // ISO 8601 week: Monday-start, week 1 = the week containing the year's first Thursday.
  function weekFolderName(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dayNum + 3);
    const isoYear = d.getUTCFullYear();
    const yearStart = Date.UTC(isoYear, 0, 1);
    const weekNum = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
    return `${isoYear}-Wk${String(weekNum).padStart(2, '0')}`;
  }

  function reportDirFor(date) {
    return join(tmpReports, weekFolderName(date), dateFolderName(date));
  }

  function save({ brief, instrument_type = 'stocks', is_summary = false, date } = {}) {
    const now = date ? new Date(date) : new Date();
    const dir = reportDirFor(now);
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
    const filePath = join(reportDirFor(now), `${instrument_type}.md`);
    if (!existsSync(filePath)) return { success: false };
    return { success: true, content: readFileSync(filePath, 'utf8') };
  }

  before(() => mkdirSync(tmpReports, { recursive: true }));
  after(() => rmSync(tmpReports, { recursive: true, force: true }));

  const today = new Date().toISOString().split('T')[0];

  for (const inst of BRIEF_INSTRUMENTS) {
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
    const saved = save({ brief: 'All brief summaries here', instrument_type: 'daily_summary', date: today });
    assert.ok(saved.path.endsWith('daily-summary.md'), `Expected daily-summary.md, got: ${saved.path}`);
    assert.ok(existsSync(saved.path));
  });

  it('is_summary=true writes to {type}-summary.md', () => {
    const saved = save({ brief: 'Short summary', instrument_type: 'momentum_stocks', is_summary: true, date: today });
    assert.ok(saved.path.endsWith('momentum_stocks-summary.md'), `Expected momentum_stocks-summary.md, got: ${saved.path}`);
  });

  it('folder name format is YYYY-Mon-DD', () => {
    // Use a local date (not UTC string parse) to avoid timezone shift
    const d = new Date(2026, 5, 13); // month is 0-indexed: 5 = June
    assert.equal(dateFolderName(d), '2026-Jun-13');
  });

  it('week folder format is YYYY-WkNN', () => {
    const d = new Date(2026, 5, 13); // Sat, 2026-Jun-13 — ISO week 24 of 2026
    assert.equal(weekFolderName(d), '2026-Wk24');
  });

  it('week folder handles the year-boundary edge case correctly', () => {
    // 2025-Dec-29 is a Monday, and Jan 1 2026 (Thursday) falls in that same
    // Mon-Sun week — per ISO 8601 this week belongs to 2026, not 2025.
    const d = new Date(2025, 11, 29);
    assert.equal(weekFolderName(d), '2026-Wk01');
  });

  it('report path nests day folder under week folder', () => {
    const saved = save({ brief: 'nesting check', instrument_type: 'futures', date: new Date(2026, 5, 13) });
    assert.ok(saved.path.includes(`${join('2026-Wk24', '2026-Jun-13')}`),
      `Expected path to include week/day nesting, got: ${saved.path}`);
  });
});
