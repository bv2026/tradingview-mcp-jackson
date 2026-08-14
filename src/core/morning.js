/**
 * Morning brief core logic.
 * Reads rules.json for screener source, loads strategy-{type}.json for bias criteria,
 * pulls live symbols from the TradingView screener, ensures required indicators are
 * on the chart, scans each symbol, and returns structured data for Claude to apply
 * the strategy rules and generate a session brief.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { evaluate, KNOWN_PATHS } from '../connection.js';
import * as chart from './chart.js';
import * as data from './data.js';
import * as screener from './screener.js';
import { classifyResults } from './classify.js';
import { applyFuturesEvidenceScoring } from './futures-evidence-scoring.js';
import {
  PROJECT_ROOT,
  REPORTS_DIR,
  dateFolderName,
  incomeEtfMonthlyReviewDirFor,
  incomeEtfWeekDirFor,
  reportDateFromInput,
  reportDirFor,
  weekFolderName,
} from './report_paths.js';
import { switchTab } from './tab.js';
import { persistRawEvidence } from './raw-evidence.js';
import { cannonEvidence } from './external-evidence/cannon.js';

const SESSIONS_DIR = join(homedir(), '.tradingview-mcp', 'sessions');

function loadRules(rulesPath) {
  const candidates = [
    rulesPath,
    join(PROJECT_ROOT, 'config', 'rules.json'),
    join(PROJECT_ROOT, 'rules.json'),
    join(homedir(), '.tradingview-mcp', 'rules.json'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return { rules: JSON.parse(readFileSync(p, 'utf8')), path: p };
      } catch (e) {
        throw new Error(`Failed to parse rules.json at ${p}: ${e.message}`);
      }
    }
  }
  throw new Error(
    'No rules.json found. Looked in:\n' +
    candidates.map(p => `  - ${p}`).join('\n')
  );
}

function loadStrategy(instrumentType) {
  const candidates = [
    join(PROJECT_ROOT, 'config', `strategy-${instrumentType}.json`),
    join(PROJECT_ROOT, `strategy-${instrumentType}.json`),
    join(homedir(), '.tradingview-mcp', `strategy-${instrumentType}.json`),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return { strategy: JSON.parse(readFileSync(p, 'utf8')), path: p };
      } catch (e) {
        throw new Error(`Failed to parse strategy-${instrumentType}.json at ${p}: ${e.message}`);
      }
    }
  }
  throw new Error(
    `No strategy-${instrumentType}.json found. ` +
    `Create it at ${candidates[0]} to define bias criteria for ${instrumentType}.`
  );
}

async function ensureIndicators(requiredIndicators) {
  if (!requiredIndicators || requiredIndicators.length === 0) return { added: [] };

  const state = await chart.getState();
  const currentIndicators = (state.studies || []).map(i =>
    (i.name || '').toLowerCase()
  );

  const added = [];
  for (const indicator of requiredIndicators) {
    const alreadyOn = currentIndicators.some(name =>
      name.includes(indicator.toLowerCase().split('[')[0].trim())
    );
    if (!alreadyOn) {
      try {
        await chart.manageIndicator({ action: 'add', indicator });
        await new Promise(r => setTimeout(r, 400));
        added.push(indicator);
      } catch (err) {
        // Non-fatal — log and continue
        console.error(`Could not add indicator "${indicator}": ${err.message}`);
      }
    }
  }

  // If any indicators were freshly added, wait for them to fully calculate
  // before the scan begins. 400ms per indicator isn't enough for historical data.
  if (added.length > 0) {
    await new Promise(r => setTimeout(r, 3000));
  }

  return { added };
}

const round2 = (x) => Math.round(x * 100) / 100;

// Compute a moving average over an array of closes (oldest → newest).
// type: 'SMA' (simple) or 'EMA' (exponential, SMA-seeded to match TradingView).
function computeMA(closes, period, type) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  if (type === 'EMA') {
    // Use up to period*3 bars so the EMA converges; seed with SMA of the first `period`.
    const window = closes.slice(-Math.min(closes.length, period * 3));
    if (window.length < period) return null;
    const seed = window.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let ema = seed;
    const k = 2 / (period + 1);
    for (let i = period; i < window.length; i++) ema = window[i] * k + ema * (1 - k);
    return ema;
  }
  // SMA
  const w = closes.slice(-period);
  return w.reduce((a, b) => a + b, 0) / period;
}

// Measure the strategy benchmark (e.g. SPY) against its configured moving average.
// Only runs when market_context defines benchmark_ma_type + benchmark_ma_period
// (momentum_stocks/momentum_etf/momentum_ark). Switches the chart to the benchmark on the brief timeframe,
// polls for enough bars, computes the MA in code, and compares to the last close.
// Falls back to benchmark_alt if the primary symbol can't be loaded.
async function measureBenchmark({ marketContext, timeframe, scanWaitMs }) {
  const maType = (marketContext?.benchmark_ma_type || '').toUpperCase();
  const maPeriod = marketContext?.benchmark_ma_period;
  if (!maType || !maPeriod) return null; // not a benchmark-gated instrument

  const candidates = [marketContext.benchmark, marketContext.benchmark_alt].filter(Boolean);
  const CHART_API = KNOWN_PATHS.chartApi;
  const wait = scanWaitMs ?? 800;

  for (let i = 0; i < candidates.length; i++) {
    const sym = candidates[i];
    try {
      await evaluate(`${CHART_API}.setSymbol('${sym.replace(/'/g, "\\'")}', {})`);
      await evaluate(`${CHART_API}.setResolution('${timeframe}', {})`);

      // Poll until enough daily bars have loaded (benchmark history is larger than a flat wait allows).
      let bars = null;
      for (let t = 0; t < 8; t++) {
        await new Promise(r => setTimeout(r, wait));
        try {
          const o = await data.getOhlcv({ count: Math.max(maPeriod * 3, maPeriod + 5) });
          if (o?.bars && o.bars.length >= maPeriod) { bars = o.bars; break; }
        } catch (_) {}
      }
      if (!bars) continue;

      const closes = bars.map(b => b.close).filter(c => typeof c === 'number');
      const ma = computeMA(closes, maPeriod, maType);
      const close = closes[closes.length - 1];
      if (ma == null || close == null) continue;

      return {
        symbol: sym,
        close: round2(close),
        ma_type: maType,
        ma_period: maPeriod,
        ma_value: round2(ma),
        above: close > ma,
        near: Math.abs(close - ma) / ma <= 0.003, // within 0.3% = borderline
        used_alt: i > 0,
        source: 'computed_from_ohlcv',
      };
    } catch (_) { /* try next candidate */ }
  }

  return {
    available: false,
    attempted: candidates,
    ma_type: maType,
    ma_period: maPeriod,
    note: 'Could not load benchmark OHLCV; treat the benchmark as UNKNOWN and be conservative on longs.',
  };
}

// Ticker root = the part after the last ':' (e.g. "NASDAQ:AMD" → "AMD", "BATS:AMD" → "AMD").
// Used to confirm the chart actually switched to the requested symbol, since the resolved
// quote symbol often comes back on a different exchange prefix (NASDAQ requested, BATS resolved).
function tickerRoot(sym) {
  return String(sym || '').split(':').pop().trim().toUpperCase();
}

// Liveness probe — run ONCE before scanning all symbols. Confirms two things on the lead
// symbol: (1) the chart returns a quote that matches the requested ticker (feed is live,
// not echoing the previously-loaded symbol), and (2) the value-producing required indicator
// (TWB oscillator — NW Envelope is a price overlay and never reports here) is actually
// computing. If either never confirms, abort loudly instead of emitting stale/empty data.
async function verifyChartLive(symbol, timeframe, scanWaitMs, requiredIndicators) {
  const CHART_API = KNOWN_PATHS.chartApi;
  const wait = scanWaitMs ?? 800;
  const want = tickerRoot(symbol);
  await evaluate(`${CHART_API}.setSymbol('${symbol.replace(/'/g, "\\'")}', {})`);
  await evaluate(`${CHART_API}.setResolution('${timeframe}', {})`);

  // Exclude NW Envelope (price overlay, never in study values) and Volume (OHLCV, not a study).
  // If nothing is left (equity types with only NW + Volume), skip the study readiness check.
  const valueIndicator = (requiredIndicators || []).find(i => !/nadaraya/i.test(i) && !/^volume$/i.test(i)) || '';
  const valueKey = valueIndicator.toLowerCase().split('[')[0].trim();

  let quoteFresh = false, studyLive = false;
  for (let t = 0; t < 8; t++) {
    await new Promise(r => setTimeout(r, wait));
    let quote;
    try { quote = await data.getQuote({}); } catch (_) { continue; }
    quoteFresh = !!(quote?.symbol && tickerRoot(quote.symbol) === want && typeof quote.close === 'number');
    if (!quoteFresh) continue;
    try {
      const sv = await data.getStudyValues();
      const names = (sv?.studies || []).map(s => (s.name || '').toLowerCase());
      studyLive = valueKey ? names.some(n => n.includes(valueKey)) : true;
    } catch (_) { studyLive = false; }
    if (quoteFresh && studyLive) return;
  }

  throw new Error(
    `Chart is not returning live data for ${symbol} after multiple tries ` +
    `(quote fresh: ${quoteFresh}, indicators live: ${studyLive}). ` +
    `The TradingView tab likely opened before its indicators/feed were ready. ` +
    `Reload the TradingView tab, confirm the LuxAlgo indicators are visible on the chart, then re-run the brief.`
  );
}

// Scan a single symbol with a freshness guard. After switching symbol+timeframe, poll the
// quote until its ticker matches the requested symbol (or retries exhaust) — this prevents
// reading the previously-loaded symbol's cached values. Two extra guards:
//   - echo check: a fresh-looking quote whose close exactly equals the previously scanned
//     symbol's close is almost certainly stale data for the prior symbol (the NQ-echoed-ES
//     case), so it's rejected and the poll continues.
//   - oscillator wait: once the quote is live, the value-producing oscillator (TWB) lags and
//     often returns empty on the first read, so poll a few extra times for it to appear.
// Marks each reading fresh/stale so the caller can distinguish trustworthy data.
async function scanSymbol(symbol, timeframe, scanWaitMs, opts = {}) {
  const { prevClose = null, oscillatorKey = null } = opts;
  const CHART_API = KNOWN_PATHS.chartApi;
  const wait = scanWaitMs ?? 800;
  const want = tickerRoot(symbol);

  await evaluate(`${CHART_API}.setSymbol('${symbol.replace(/'/g, "\\'")}', {})`);
  await evaluate(`${CHART_API}.setResolution('${timeframe}', {})`);

  let quote = null, fresh = false;
  for (let t = 0; t < 8; t++) {
    await new Promise(r => setTimeout(r, wait));
    try { quote = await data.getQuote({}); } catch (_) { continue; }
    const tickerOk = quote?.symbol && tickerRoot(quote.symbol) === want && typeof quote.close === 'number';
    const echo = tickerOk && prevClose != null && quote.close === prevClose;
    if (tickerOk && !echo) { fresh = true; break; }
  }

  // Give the value-producing oscillator extra polls to finish recalculating — it lags the
  // quote and otherwise returns empty (study_count 0). Only retries when it's missing.
  let indicators = await data.getStudyValues();
  if (fresh && oscillatorKey) {
    const hasOsc = (sv) => (sv?.studies || []).some(s => (s.name || '').toLowerCase().includes(oscillatorKey));
    for (let t = 0; t < 3 && !hasOsc(indicators); t++) {
      await new Promise(r => setTimeout(r, wait));
      try { indicators = await data.getStudyValues(); } catch (_) {}
    }
  }
  const nwSignals = await data.getPineLabels({ study_filter: 'Nadaraya-Watson', max_labels: 1 });

  const reading = { symbol, timeframe, indicators, quote, nw_envelope_signals: nwSignals, fresh };
  if (!fresh) {
    reading.stale = true;
    reading.note = `Chart did not confirm a fresh switch to ${symbol} after multiple tries (stale or echoed data). Treat as unreliable (SKIP / re-scan).`;
  }
  return reading;
}

const ALL_INSTRUMENTS = ['momentum_stocks', 'momentum_etf', 'crypto', 'crypto_perps', 'futures', 'sp_ndx', 'r2k'];
const THEMATIC_INSTRUMENTS = [];

export async function runBrief({ rules_path, instrument_type, _scan_wait_ms, offset, max_symbols } = {}) {
  const instrument = instrument_type || 'momentum_stocks';

  // "all" mode — route large equity universes through the established Lux batch path;
  // direct morning_brief callers remain unchanged below.
  if (instrument === 'all') {
    return {
      success: true,
      mode: 'all',
      generated_at: new Date().toISOString(),
      instruments: ALL_INSTRUMENTS,
      thematic_instruments: THEMATIC_INSTRUMENTS,
      instruction: [
        `Run morning_brief sequentially for each of these instrument types IN ORDER: ${ALL_INSTRUMENTS.join(', ')}.`,
        `For each instrument_type:`,
        `1. For momentum_stocks, call lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" twice: offset=0,max_symbols=50 then offset=50; merge the returned symbols_raw arrays using the established Lux merge rule, preserve all raw-evidence/provenance fields, and use that result as the Momentum Stocks report input. For momentum_etf, do the same with lux_screener_scan timeframe="1W" using offset=0,max_symbols=30 then offset=30. Do not call morning_brief for either of these two in all-mode. For crypto, crypto_perps, futures, sp_ndx, and r2k, call morning_brief once with no offset/max_symbols.`,
        `2. Apply the returned bias_criteria and instruction to the (merged, if applicable) symbols_scanned data.`,
        `3. Write the full analysis (symbol table, top 3 setups, overall market read) under a markdown header: ## MOMENTUM STOCKS / ## CRYPTO / ## CRYPTO PERPS / ## FUTURES / etc.`,
        `4. Call session_save once with your full combined analysis text and the matching instrument_type.`,
        `5. Proceed to the next instrument_type.`,
        `After ALL ${ALL_INSTRUMENTS.length} standard briefs are complete, run the thematic reports in order:`,
        `THEMATIC STEP 0 — ARK Innovation (141 symbols from CSV watchlist):`,
        `Call lux_screener_scan with instrument_type="momentum_ark" and timeframe="1W". This returns passing symbols (BOS + Bullish S&O + ▲ signal hard filter) with scores sorted descending.`,
        `Write the ARK brief using the same format as momentum_stocks/momentum_etf: ## MOMENTUM ARK section header, Benchmark/Theme bullets, Top 20 Setups table (BASE_BUILDING/BREAKOUT_READY only, columns RANK/SYMBOL/STATUS/S&O RATING/SIGNAL/PAC STRUCTURE/SCORE/CLUSTER), full Screener List table, Top 3 Setups prose, and Overall Market Read. Note any cluster concentration (max 1 per cluster). Call session_save with instrument_type="momentum_ark".`,
        `THEMATIC STEP 1 — Thematic Stocks (all 121 symbols):`,
        `Call lux_screener_scan with instrument_type="thematic_stocks". This returns a full per-symbol table grouped by theme.`,
        `Write the full grouped report (all 121 symbols, all themes, with S&O/PAC/OSC signals and scores) and call session_save with instrument_type="thematic_stocks".`,
        `Then write a theme-level summary (one row per theme showing bias/bull-bear count/top names/best score, plus a "Top Picks" table of all symbols scoring ≥ 5, plus a bottom-10 avoid table) and call session_save with instrument_type="thematic_stocks" and is_summary=true.`,
        `THEMATIC STEP 2 — Thematic ETFs (90 ETFs across 8 themes):`,
        `Call lux_screener_scan with instrument_type="thematic_etfs". This returns a full per-ETF table grouped by theme.`,
        `Write the full grouped report (all ETFs, all 8 themes, with S&O/PAC/OSC signals and scores) and call session_save with instrument_type="thematic_etfs".`,
        `Then write a theme-level summary (one row per theme showing bias/leading ETFs/fading ETFs, plus a "Top ETF Picks" table of bullish ETFs with room to NW band, plus avoid list) and call session_save with instrument_type="thematic_etfs" and is_summary=true.`,
        `FINAL STEP — Daily Summary:`,
        `Call session_save one final time with instrument_type="daily_summary" — write a 4-line block per instrument covering ALL instruments including thematic (line 1 = "## TYPE | BIAS", line 2 = benchmark status, line 3 = "TOP 3: ...", line 4 = "SKIP: ..."), all stacked into one file. This is the single file the user reads each morning.`,
        `Be direct. No preamble between sections.`,
      ].join(' '),
    };
  }

  const { rules, path: rulesFrom } = loadRules(rules_path);
  const { strategy, path: strategyFrom } = loadStrategy(instrument);

  // Switch to the dedicated chart tab for this instrument before scanning
  const chartTabConfig = rules.chart_tabs?.[instrument];
  let chartTabSwitched = false;
  if (chartTabConfig?.chart_id) {
    try {
      await switchTab({ chart_id: chartTabConfig.chart_id });
      chartTabSwitched = true;
    } catch (err) {
      console.error(`Could not switch to chart tab for "${instrument}" (${chartTabConfig.chart_id}): ${err.message}`);
      // Non-fatal — continue on whichever tab is active
    }
  }

  // Resolve screener name from rules.json (null = use static watchlist from strategy file)
  const screenerName = rules.screener_sources?.[instrument] ?? null;

  const maxSymbols = max_symbols ?? strategy.max_symbols ?? 10;
  const timeframe = strategy.default_timeframe || 'D';

  let symbols, screenerResult;
  // Optional per-symbol metadata (e.g. StockTwits sentiment/WTD/watchers) carried
  // from an object-form watchlist into the scan output. Keyed by symbol string.
  const symbolMeta = {};

  if (!screenerName) {
    // Static watchlist path — no live screener.
    // watchlist entries may be plain strings ("AMD") or objects with metadata
    // ({ symbol, wtd, sentiment, watchers }). Objects let StockTwits-style signals
    // flow through to the brief without affecting the scan itself.
    const staticList = strategy.watchlist;
    if (!staticList || staticList.length === 0) {
      throw new Error(
        `No screener configured for "${instrument}" and no watchlist found in strategy-${instrument}.json.`
      );
    }
    const start = offset && offset > 0 ? offset : 0;
    const windowed = maxSymbols && maxSymbols > 0
      ? staticList.slice(start, start + maxSymbols)
      : staticList.slice(start);
    symbols = windowed.map(entry => {
      if (entry && typeof entry === 'object') {
        const { symbol, ...meta } = entry;
        if (symbol && Object.keys(meta).length) symbolMeta[symbol] = meta;
        return symbol;
      }
      return entry;
    });
    screenerResult = { name: `static:${instrument}`, total_in_screener: staticList.length, offset: start };
  } else {
    // Live screener path
    const result = await screener.get({ screener_name: screenerName, max_symbols: maxSymbols, offset });
    symbols = result.symbols || [];
    screenerResult = result;
    if (symbols.length === 0) {
      throw new Error(`Screener "${screenerName}" returned no symbols.`);
    }
  }

  // Ensure required indicators are on the chart
  const { added: indicatorsAdded } = await ensureIndicators(strategy.required_indicators);

  // Save current chart state so we can restore after scan
  let originalSymbol, originalTimeframe;
  try {
    const currentState = await chart.getState();
    originalSymbol = currentState.symbol;
    originalTimeframe = currentState.resolution;
  } catch (_) {}

  // Measure the benchmark (SPY/QQQ above its 50d SMA/EMA) before scanning candidates.
  // Returns null for instruments without a configured MA gate (crypto/perps/futures).
  let benchmarkStatus = null;
  try {
    benchmarkStatus = await measureBenchmark({
      marketContext: strategy.market_context,
      timeframe,
      scanWaitMs: _scan_wait_ms,
    });
  } catch (err) {
    benchmarkStatus = { available: false, error: err.message, note: 'Benchmark measurement failed; be conservative on longs.' };
  }

  // Liveness probe — abort before scanning if the chart isn't returning live data or the
  // required indicators aren't computing. Prevents silently emitting stale/empty briefs
  // (the failure where every symbol echoed one cached quote with study_count 0).
  await verifyChartLive(symbols[0], timeframe, _scan_wait_ms, strategy.required_indicators);

  const results = [];
  const CHART_API = KNOWN_PATHS.chartApi;

  // Oscillator key = the value-producing required indicator (e.g. TWB for crypto/futures).
  // NW Envelope is a price overlay (never in study values) and Volume is OHLCV — both excluded.
  // For equity types that only carry NW + Volume, this returns '' → studyLive bypassed (correct).
  const valueIndicator = (strategy.required_indicators || []).find(i => !/nadaraya/i.test(i) && !/^volume$/i.test(i)) || '';
  const oscillatorKey = valueIndicator.toLowerCase().split('[')[0].trim();

  let prevClose = null; // last confirmed-fresh close, for the echo guard
  for (const symbol of symbols) {
    try {
      const reading = await scanSymbol(symbol, timeframe, _scan_wait_ms, { prevClose, oscillatorKey });
      results.push(reading);
      if (reading.fresh && typeof reading.quote?.close === 'number') prevClose = reading.quote.close;
    } catch (err) {
      results.push({ symbol, error: err.message, fresh: false, stale: true });
    }
  }

  // Attach any per-symbol watchlist metadata (StockTwits sentiment/WTD/watchers)
  // so the brief can weigh it alongside the live NW readings.
  if (Object.keys(symbolMeta).length) {
    for (const r of results) {
      if (r.symbol && symbolMeta[r.symbol]) r.stocktwits = symbolMeta[r.symbol];
    }
  }

  // Precompute hist/sig/gap/bias/nw_position (and an instrument-specific regime/status tag)
  // per symbol, replacing the ad-hoc Python parsing this used to require by hand each morning.
  const classifiedResults = classifyResults(results, instrument, {
    correlationClusters: strategy.asset_notes?.correlation_clusters,
  });
  if (instrument === 'futures') {
    for (const row of classifiedResults) {
      row.external_evidence = { ...(row.external_evidence || {}), cannon: cannonEvidence(row.symbol, { timeframe, captureDate: new Date().toISOString().slice(0, 10) }) };
    }
    const scoredResults = applyFuturesEvidenceScoring(classifiedResults);
    classifiedResults.splice(0, classifiedResults.length, ...scoredResults);
  }

  const freshCount = classifiedResults.filter(r => r.fresh).length;
  const staleCount = classifiedResults.length - freshCount;

  // Restore original chart state (symbol + timeframe, not indicators — Option B)
  if (originalSymbol) {
    try {
      await evaluate(`${CHART_API}.setSymbol('${originalSymbol.replace(/'/g, "\\'")}', {})`);
      if (originalTimeframe) await evaluate(`${CHART_API}.setResolution('${originalTimeframe}', {})`);
    } catch (_) {}
  }

  const dateStr = new Date().toISOString().split('T')[0];
  const briefFilename = `${dateStr}-${instrument}.json`;
  const briefPath = join(SESSIONS_DIR, briefFilename);

  const output = {
    success: true,
    generated_at: new Date().toISOString(),
    date: dateStr,
    instrument_type: instrument,
    chart_tab: chartTabConfig
      ? { chart_id: chartTabConfig.chart_id, layout_name: chartTabConfig.layout_name, switched: chartTabSwitched }
      : { switched: false, note: 'No chart_tab configured for this instrument in rules.json' },
    rules_loaded_from: rulesFrom,
    strategy_loaded_from: strategyFrom,
    screener: {
      name: screenerResult.name,
      total_in_screener: screenerResult.total_in_screener,
      symbols_scanned: symbols.length,
    },
    indicators_added_to_chart: indicatorsAdded,
    scan_quality: { fresh: freshCount, stale: staleCount, total: classifiedResults.length },
    benchmark_status: benchmarkStatus,
    strategy: {
      market_context: strategy.market_context || null,
      bias_criteria: strategy.bias_criteria || null,
      entry_criteria: strategy.entry_criteria || null,
      exit_criteria: strategy.exit_criteria || null,
      risk_rules: [
        ...(rules.risk_rules || []),
        ...(strategy.risk_rules || []),
      ],
      asset_notes: strategy.asset_notes || null,
    },
    symbols_scanned: classifiedResults,
    instruction: [
      `Each symbol already carries precomputed fields — use them directly. 'nw_position' = "extended" (price crossed above NW upper band) / "early" (crossed below lower band) / "n/a" from the most recent NW label. For crypto/futures/perps types: 'hist'/'sig' are the parsed TWB Histogram/Signal (numeric, strings already normalized), 'gap' = hist - sig, 'bias' = "bullish"/"bearish"/"neutral" from the sign of gap. For equity types (momentum_stocks/etf/ark/sp_ndx/r2k): TWB is not on the chart — hist/sig/gap/bias will be null/n/a; use nw_position and the lux_screener_scan pre-filter result instead.`,
      instrument === 'momentum_ark'
        ? `Each symbol also carries 'ark_status' (BASE_BUILDING/EXTENDED/SKIP — BREAKOUT_READY is NOT auto-assigned, see below) and 'cluster' (correlation cluster name or null).`
        : instrument === 'futures'
        ? `Each symbol also carries 'regime' (TRENDING_LONG/TRENDING_SHORT/MEAN_REVERTING) — a single-bar approximation only; it does not check multi-bar persistence or cross-report corroboration (e.g. BTC1!/ETH1! against the same day's crypto/crypto_perps briefs). Treat it as a starting hypothesis and override using regime_detection + macro_overlays + judgment as before.`
        : ['momentum_stocks', 'momentum_etf', 'sp_ndx', 'r2k'].includes(instrument)
        ? `Each symbol also carries 'momentum_tag' (bullish-early/bullish-extended/bearish-neutral/neutral) derived from bias + nw_position — use it as a starting point for the bias_criteria call, not a substitute for it (catalyst/volume/structure checks still require judgment).`
        : null,
      `Apply the strategy's bias_criteria/entry_criteria/exit_criteria using these precomputed fields plus 'quote' (price/volume) and any 'stocktwits' metadata — the raw indicator/label extraction is already done.`,
      `DATA QUALITY: each symbol has a 'fresh' flag. Any symbol with fresh:false (or stale:true / an 'error') was NOT confirmed live on the chart — its readings may be the previously-loaded symbol's data. Mark such symbols SKIP (re-scan) and do not base a setup on them. Check scan_quality for the overall fresh/stale counts.`,
      Object.keys(symbolMeta).length
        ? `STOCKTWITS SIGNAL: symbols carry a 'stocktwits' field with retail sentiment (bull %), weekly performance (wtd), and watcher count from the source watchlist. Use sentiment as a CONTEXT layer on top of the technicals, not a standalone signal: sentiment ≥ ~50 with a confirming TWB/NW setup = retail conviction behind the move (supportive); sentiment ≥ ~80 = crowded/late — flag caution even on a clean technical; sentiment < ~40 on a mover = weak retail support — require a stronger technical to act. High watcher counts amplify both effects. Note the sentiment read in each symbol's WATCH field.`
        : null,
      instrument === 'crypto_perps'
        ? `PERPS BENCHMARK: The FIRST symbol in symbols_scanned is always BTC perp. Read its TWB Histogram. If POSITIVE → market in uptrend → scan all alts for LONG setups using bullish_long criteria. If NEGATIVE → market in downtrend → scan all alts for SHORT setups using bearish_short criteria. Do NOT default to "no trades" on negative BTC TWB — negative means SHORT side is in play. Commodity perps (SILVER, GOLD) use their own TWB signal independently of BTC. Output top 3 LONG candidates OR top 3 SHORT candidates depending on BTC TWB direction. S/R LEVELS: Each symbol carries 'sr_resistance', 'sr_support', 'sr_break' from the Support and Resistance Levels with Breaks [LuxAlgo] indicator (null if indicator not on chart or insufficient data). Use these to resolve TWB vs NW tension: (1) LONG — if price just broke above sr_resistance with positive TWB, enter even if nw_position=extended (breakout confirmation overrides NW extension). (2) SHORT — ideal entry is a dead-cat bounce up to sr_resistance level (not just the lower NW band) — sr_resistance is the ceiling to short against. (3) sr_break > 0 = a resistance break just occurred (bullish); sr_break < 0 = a support break (bearish). Include sr_resistance and sr_support in each symbol's WATCH field.`
        : instrument === 'futures'
        ? `FUTURES REGIME DETECTION: Each symbol is evaluated independently — no single benchmark. For each symbol, determine which regime applies using regime_detection rules: TRENDING (TWB Histogram clearly directional for 3+ bars, HH/HL or LL/LH structure) or MEAN_REVERTING (TWB near zero or reversing, RSI extreme, price extended beyond NW band). Then apply the matching bias_criteria (trend_long, trend_short, mean_rev_long, mean_rev_short). Check macro_overlays in market_context: DXY direction affects metals/FX, ZB/ZN direction affects equity index, VX1! level sets overall risk mode. Output one line per symbol with its regime tag. End with top 3 setups across all sectors.`
        : instrument === 'momentum_ark'
        ? `ARK RELATIVE STRENGTH + BASE BREAKOUT: Symbols here have already passed the LuxAlgo 1W hard filter (BOS + Bullish S&O Rating + ▲ signal) — treat them as BASE_BUILDING by default unless overridden below. For each symbol: (1) RELATIVE STRENGTH — compare the stock's recent price action to QQQ manually. If QQQ is down 2% over 20 days and the stock is down 0.5%, RS is positive. If QQQ is up 3% and stock is flat, RS is negative — skip it. (2) NW ENVELOPE — price should be inside bands (nw_position = "inside"). If nw_position = "extended" (▲ label): EXTENDED, skip. If nw_position = "early" (▼ label): price dipped below lower band, wait for recovery before entering. (3) BREAKOUT_READY — manual upgrade only: confirm positive RS AND tight base structure AND price reclaiming NW bands with volume. SKIP criteria: stock below 50d EMA, clearly negative RS, or earnings within 5 days. Note the correlation cluster (ai_semis / fintech_crypto / autonomy_space / ai_software / genomics) — flag if multiple names from same cluster would be entered simultaneously. ark_status is pre-computed as a starting point but manual RS and earnings checks can override it.`
        : null,
      `If strategy has tradeable_exchanges defined, flag any symbol NOT available on those exchanges as SKIP.`,
      instrument === 'momentum_ark'
        ? `Output one line per symbol: SYMBOL | STATUS: [BASE_BUILDING/BREAKOUT_READY/EXTENDED/SKIP] | RS: [+/-] | SIGNAL: [key observation] | CLUSTER: [cluster name]`
        : instrument === 'thematic_etfs'
        ? `GROUP output by theme. Each symbol carries a 'theme' and 'sub_group' field — use them to organize the analysis. For each theme: write a "### {Theme}" header, then a markdown table: | ETF | SUB-GROUP | BIAS | TWB | NW | SIGNAL |. After the table, write one sentence: the theme's overall rotation direction (bullish / bearish / mixed). End with a "## Cross-Theme Read" summary listing which 2-3 themes show the strongest ETF breadth.`
        : `Output one line per symbol: SYMBOL | BIAS: [long/short/neutral] | SIGNAL: [key observation] | WATCH: [what to monitor]`,
      instrument === 'momentum_ark'
        ? `Then list top 3 BREAKOUT_READY candidates (or BASE_BUILDING if none are ready) with entry_criteria checklist and cluster warning if applicable.`
        : instrument === 'thematic_etfs'
        ? `Then list top 3 ETF setups across all themes with entry_criteria checklist and which theme they represent.`
        : `Then list top 3 candidates (longs or shorts depending on BTC TWB direction) with entry_criteria checklist.`,
      `End with a one-sentence overall market read.`,
      `Be direct. No preamble.`,
      `After writing your analysis, call session_save with your complete output text and instrument_type="${instrument}". Do not wait for the user to ask.`,
    ].filter(Boolean).join(' '),
  };

  output.raw_evidence = persistRawEvidence(output, {
    instrumentType: instrument,
    sourceTool: 'morning_brief',
    timeframe,
  });

  // Auto-save raw scan data with date + instrument stamp. Merge with any
  // existing same-day file instead of overwriting — a batched "all" run
  // calls this multiple times per day (offset 0, 50, ...) and each call's
  // save used to clobber the previous batch, silently losing whichever
  // symbols weren't in the last batch (e.g. the top of the screener if the
  // final batch covered the tail). Merge by symbol so the saved file always
  // accumulates every batch scanned so far. The in-memory `output` returned
  // to the caller is untouched — it still reflects only this call's batch,
  // since that's what the "all" workflow's per-batch processing expects.
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    let toWrite = output;
    if (existsSync(briefPath)) {
      try {
        const prev = JSON.parse(readFileSync(briefPath, 'utf8'));
        const bySymbol = new Map();
        for (const r of prev.symbols_scanned || []) bySymbol.set(r.symbol, r);
        for (const r of classifiedResults) bySymbol.set(r.symbol, r); // this run's data wins on overlap
        const merged = [...bySymbol.values()];
        const mergedFresh = merged.filter(r => r.fresh).length;
        toWrite = {
          ...output,
          symbols_scanned: merged,
          screener: { ...output.screener, symbols_scanned: merged.length },
          scan_quality: { fresh: mergedFresh, stale: merged.length - mergedFresh, total: merged.length },
        };
      } catch (_) { /* corrupt/old file — fall back to writing just this run's results */ }
    }
    writeFileSync(briefPath, JSON.stringify(toWrite, null, 2));
    output.saved_to = briefPath;
  } catch (err) {
    output.save_error = err.message;
  }

  return output;
}

export function saveSession({ brief, instrument_type = 'momentum_stocks', is_summary = false, date } = {}) {
  const now = reportDateFromInput(date);
  const folder = dateFolderName(now);
  const week = weekFolderName(now);
  const reportDir = instrument_type === 'income_etf'
    ? incomeEtfWeekDirFor(now)
    : instrument_type === 'income_etf_monthly_review'
      ? incomeEtfMonthlyReviewDirFor(now)
      : reportDirFor(now);
  mkdirSync(reportDir, { recursive: true });

  const isDailySum = instrument_type === 'daily_summary';
  const filename = instrument_type === 'income_etf_monthly_review'
    ? 'monthly-review.md'
    : isDailySum
    ? 'daily-summary.md'
    : is_summary
      ? `${instrument_type}-summary.md`
      : `${instrument_type}.md`;

  const filePath = join(reportDir, filename);
  const timestamp = now.toLocaleString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });

  const title = isDailySum
    ? 'Daily Market Summary'
    : instrument_type === 'income_etf'
      ? 'Income ETF Accumulation Report'
    : instrument_type === 'income_etf_monthly_review'
      ? 'Income ETF Monthly Review'
    : is_summary
      ? `${instrument_type.replace(/_/g, ' ').toUpperCase()} Summary`
      : `${instrument_type.replace(/_/g, ' ').toUpperCase()} Morning Brief`;

  const content = [
    `# ${title}`,
    `**Date:** ${timestamp}`,
    ``,
    brief,
  ].join('\n');

  writeFileSync(filePath, content, 'utf8');

  return {
    success: true,
    path: filePath,
    folder: instrument_type === 'income_etf'
      ? `inc-etf/${week}`
      : instrument_type === 'income_etf_monthly_review'
        ? `inc-etf/Mon-review/${basename(reportDir)}`
      : `${week}/${folder}`,
  };
}

export function getSession({ date, instrument_type } = {}) {
  const now = reportDateFromInput(date);
  const folder = dateFolderName(now);
  const reportDir = instrument_type === 'income_etf'
    ? incomeEtfWeekDirFor(now)
    : instrument_type === 'income_etf_monthly_review'
      ? incomeEtfMonthlyReviewDirFor(now)
      : reportDirFor(now);

  if (instrument_type) {
    const filename = instrument_type === 'income_etf_monthly_review'
      ? 'monthly-review.md'
      : `${instrument_type}.md`;
    const filePath = join(reportDir, filename);
    if (existsSync(filePath)) {
      return { success: true, path: filePath, content: readFileSync(filePath, 'utf8') };
    }
    // Try yesterday's folder (may be in a different ISO week)
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yPath = join(
      instrument_type === 'income_etf'
        ? incomeEtfWeekDirFor(yesterday)
        : instrument_type === 'income_etf_monthly_review'
          ? incomeEtfMonthlyReviewDirFor(yesterday)
        : reportDirFor(yesterday),
      filename
    );
    if (existsSync(yPath)) {
      return { success: true, note: 'No report for today — returning yesterday', path: yPath, content: readFileSync(yPath, 'utf8') };
    }
    return { success: false, error: `No ${instrument_type} report found in ${reportDir}`, reports_dir: REPORTS_DIR };
  }

  // No instrument_type: list what's saved today (dynamic scan so all types are discovered)
  const available = existsSync(reportDir)
    ? readdirSync(reportDir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
    : [];
  if (available.length > 0) {
    return {
      success: true,
      folder: `${weekFolderName(now)}/${folder}`,
      reports_dir: reportDir,
      briefs_available: available,
      note: `Use instrument_type param to read a specific brief (e.g. instrument_type="futures")`,
    };
  }

  return { success: false, error: `No reports found for ${folder}`, reports_dir: REPORTS_DIR };
}
