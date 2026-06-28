/**
 * Morning brief core logic.
 * Reads rules.json for screener source, loads strategy-{type}.json for bias criteria,
 * pulls live symbols from the TradingView screener, ensures required indicators are
 * on the chart, scans each symbol, and returns structured data for Claude to apply
 * the strategy rules and generate a session brief.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, KNOWN_PATHS } from '../connection.js';
import * as chart from './chart.js';
import * as data from './data.js';
import * as screener from './screener.js';
import { switchTab } from './tab.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');
const SESSIONS_DIR = join(homedir(), '.tradingview-mcp', 'sessions');
const REPORTS_DIR = join(PROJECT_ROOT, 'reports');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function dateFolderName(date = new Date()) {
  const y = date.getFullYear();
  const m = MONTHS[date.getMonth()];
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
// (stocks/etf/ark). Switches the chart to the benchmark on the brief timeframe,
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

  const valueIndicator = (requiredIndicators || []).find(i => !/nadaraya/i.test(i)) || '';
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
  const nwSignals = await data.getPineLabels({ study_filter: 'Nadaraya-Watson' });

  const reading = { symbol, timeframe, indicators, quote, nw_envelope_signals: nwSignals, fresh };
  if (!fresh) {
    reading.stale = true;
    reading.note = `Chart did not confirm a fresh switch to ${symbol} after multiple tries (stale or echoed data). Treat as unreliable (SKIP / re-scan).`;
  }
  return reading;
}

const ALL_INSTRUMENTS = ['stocks', 'etf', 'ark', 'crypto', 'crypto_perps', 'futures', 'sp_ndx', 'r2k'];

export async function runBrief({ rules_path, instrument_type, _scan_wait_ms } = {}) {
  const instrument = instrument_type || 'stocks';

  // "all" mode — instruct Claude to call morning_brief for each type sequentially
  if (instrument === 'all') {
    return {
      success: true,
      mode: 'all',
      generated_at: new Date().toISOString(),
      instruments: ALL_INSTRUMENTS,
      instruction: [
        `Run morning_brief sequentially for each of these instrument types IN ORDER: ${ALL_INSTRUMENTS.join(', ')}.`,
        `For each instrument_type:`,
        `1. Call morning_brief with that instrument_type.`,
        `2. Apply the returned bias_criteria and instruction to the symbols_scanned data.`,
        `3. Write the full analysis (symbol table, top 3 setups, overall market read) under a markdown header: ## STOCKS / ## CRYPTO / ## CRYPTO PERPS / ## FUTURES / etc.`,
        `4. Call session_save with your full analysis text and the matching instrument_type.`,
        `5. Proceed to the next instrument_type.`,
        `After ALL ${ALL_INSTRUMENTS.length} briefs are complete, call session_save one final time with instrument_type="daily_summary" — write a 4-line block per instrument (line 1 = "## TYPE | BIAS", line 2 = benchmark status, line 3 = "TOP 3: ...", line 4 = "SKIP: ..."), all stacked into one file. This is the single file the user reads each morning.`,
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

  const maxSymbols = strategy.max_symbols || 10;
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
    symbols = staticList.slice(0, maxSymbols).map(entry => {
      if (entry && typeof entry === 'object') {
        const { symbol, ...meta } = entry;
        if (symbol && Object.keys(meta).length) symbolMeta[symbol] = meta;
        return symbol;
      }
      return entry;
    });
    screenerResult = { name: `static:${instrument}`, total_in_screener: symbols.length };
  } else {
    // Live screener path
    const result = await screener.get({ screener_name: screenerName, max_symbols: maxSymbols });
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

  // Oscillator key = the value-producing required indicator (TWB); NW Envelope is a price
  // overlay and never reports in study values, so it can't be the readiness signal.
  const valueIndicator = (strategy.required_indicators || []).find(i => !/nadaraya/i.test(i)) || '';
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
  // so the brief can weigh it alongside the live TWB/NW readings.
  if (Object.keys(symbolMeta).length) {
    for (const r of results) {
      if (r.symbol && symbolMeta[r.symbol]) r.stocktwits = symbolMeta[r.symbol];
    }
  }

  const freshCount = results.filter(r => r.fresh).length;
  const staleCount = results.length - freshCount;

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
    scan_quality: { fresh: freshCount, stale: staleCount, total: results.length },
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
    symbols_scanned: results,
    instruction: [
      `For each symbol in symbols_scanned, apply the bias_criteria from the strategy to the indicator readings.`,
      `TWB Oscillator values (Histogram, Signal, Trendline Break) come from the 'indicators' field.`,
      `Nadaraya-Watson Envelope signals come from the 'nw_envelope_signals' field. Labels are ▲ (price crossed above a band) or ▼ (price crossed below a band) at the price level where it occurred. The MOST RECENT label (first in the array) tells you current band position relative to price.`,
      `DATA QUALITY: each symbol has a 'fresh' flag. Any symbol with fresh:false (or stale:true / an 'error') was NOT confirmed live on the chart — its readings may be the previously-loaded symbol's data. Mark such symbols SKIP (re-scan) and do not base a setup on them. Check scan_quality for the overall fresh/stale counts.`,
      Object.keys(symbolMeta).length
        ? `STOCKTWITS SIGNAL: symbols carry a 'stocktwits' field with retail sentiment (bull %), weekly performance (wtd), and watcher count from the source watchlist. Use sentiment as a CONTEXT layer on top of the technicals, not a standalone signal: sentiment ≥ ~50 with a confirming TWB/NW setup = retail conviction behind the move (supportive); sentiment ≥ ~80 = crowded/late — flag caution even on a clean technical; sentiment < ~40 on a mover = weak retail support — require a stronger technical to act. High watcher counts amplify both effects. Note the sentiment read in each symbol's WATCH field.`
        : null,
      instrument === 'crypto_perps'
        ? `PERPS BENCHMARK: The FIRST symbol in symbols_scanned is always BTC perp. Read its TWB Histogram. If POSITIVE → market in uptrend → scan all alts for LONG setups using bullish_long criteria. If NEGATIVE → market in downtrend → scan all alts for SHORT setups using bearish_short criteria. Do NOT default to "no trades" on negative BTC TWB — negative means SHORT side is in play. Commodity perps (SILVER, GOLD) use their own TWB signal independently of BTC. Output top 3 LONG candidates OR top 3 SHORT candidates depending on BTC TWB direction.`
        : instrument === 'futures'
        ? `FUTURES REGIME DETECTION: Each symbol is evaluated independently — no single benchmark. For each symbol, determine which regime applies using regime_detection rules: TRENDING (TWB Histogram clearly directional for 3+ bars, HH/HL or LL/LH structure) or MEAN_REVERTING (TWB near zero or reversing, RSI extreme, price extended beyond NW band). Then apply the matching bias_criteria (trend_long, trend_short, mean_rev_long, mean_rev_short). Check macro_overlays in market_context: DXY direction affects metals/FX, ZB/ZN direction affects equity index, VX1! level sets overall risk mode. Output one line per symbol with its regime tag. End with top 3 setups across all sectors.`
        : instrument === 'ark'
        ? `ARK RELATIVE STRENGTH + BASE BREAKOUT: First check benchmark_status (QQQ vs its 50-day EMA, computed in the payload). If benchmark_status.above is false, all signals are SKIP (wait for market). If benchmark_status.near is true, the benchmark is borderline — reduce conviction. If benchmark_status.available is false, the benchmark could not be measured — be conservative. For each symbol: (1) RELATIVE STRENGTH — compare the stock's recent price action to QQQ. If QQQ is down 2% over 20 days and the stock is down 0.5%, RS is positive. If QQQ is up 3% and stock is flat, RS is negative — skip it. (2) BASE CHECK — is the stock in a 2-6 week tight consolidation after a prior move up? Volume should be contracting during the base. NW Envelope: price should be inside bands (no recent ▲ signal = not yet extended). (3) BREAKOUT SIGNAL — TWB Histogram turning positive or printing a breakout. Assign each symbol one of: BASE_BUILDING (positive RS, base forming, volume contracting), BREAKOUT_READY (base complete, TWB triggering), EXTENDED (NW ▲ already printed, move played out — skip), SKIP (QQQ below 50d EMA, stock below 50d EMA, negative RS, or earnings within 5 days). Note the correlation cluster (ai_semis / fintech_crypto / autonomy_space / ai_software / genomics) — flag if multiple names from same cluster would be entered simultaneously.`
        : `Check benchmark_status first (computed in the payload — the benchmark price vs its configured moving average). If benchmark_status.above is false, the benchmark is below its ${strategy.market_context?.benchmark_ma_period || 50}-day ${strategy.market_context?.benchmark_ma_type || 'SMA'} — default ALL symbols to neutral/bearish (no long entries). If benchmark_status.near is true, treat the benchmark as borderline and reduce conviction. If benchmark_status.available is false, the benchmark could not be measured — be conservative on longs. IMPORTANT: bearish signals = exit/avoid on longs only. Do NOT suggest short entries.`,
      `If strategy has tradeable_exchanges defined, flag any symbol NOT available on those exchanges as SKIP.`,
      instrument === 'ark'
        ? `Output one line per symbol: SYMBOL | STATUS: [BASE_BUILDING/BREAKOUT_READY/EXTENDED/SKIP] | RS: [+/-] | SIGNAL: [key observation] | CLUSTER: [cluster name]`
        : (instrument === 'thematic_etfs' || instrument === 'thematic_etfs_1' || instrument === 'thematic_etfs_2')
        ? `GROUP output by theme. Each symbol carries a 'theme' and 'sub_group' field — use them to organize the analysis. For each theme: write a "### {Theme}" header, then a markdown table: | ETF | SUB-GROUP | BIAS | TWB | NW | SIGNAL |. After the table, write one sentence: the theme's overall rotation direction (bullish / bearish / mixed). End with a "## Cross-Theme Read" summary listing which 2-3 themes show the strongest ETF breadth.`
        : `Output one line per symbol: SYMBOL | BIAS: [long/short/neutral] | SIGNAL: [key observation] | WATCH: [what to monitor]`,
      instrument === 'ark'
        ? `Then list top 3 BREAKOUT_READY candidates (or BASE_BUILDING if none are ready) with entry_criteria checklist and cluster warning if applicable.`
        : (instrument === 'thematic_etfs' || instrument === 'thematic_etfs_1' || instrument === 'thematic_etfs_2')
        ? `Then list top 3 ETF setups across all themes with entry_criteria checklist and which theme they represent.`
        : `Then list top 3 candidates (longs or shorts depending on BTC TWB direction) with entry_criteria checklist.`,
      `End with a one-sentence overall market read.`,
      `Be direct. No preamble.`,
      `After writing your analysis, call session_save with your complete output text and instrument_type="${instrument}". Do not wait for the user to ask.`,
    ].filter(Boolean).join(' '),
  };

  // Auto-save raw scan data with date + instrument stamp
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    writeFileSync(briefPath, JSON.stringify(output, null, 2));
    output.saved_to = briefPath;
  } catch (err) {
    output.save_error = err.message;
  }

  return output;
}

export function saveSession({ brief, instrument_type = 'stocks', is_summary = false, date } = {}) {
  const now = date ? new Date(date) : new Date();
  const folder = dateFolderName(now);
  const reportDir = join(REPORTS_DIR, folder);
  mkdirSync(reportDir, { recursive: true });

  const isDailySum = instrument_type === 'daily_summary';
  const filename = isDailySum
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
  return { success: true, path: filePath, folder };
}

export function getSession({ date, instrument_type } = {}) {
  const now = date ? new Date(date) : new Date();
  const folder = dateFolderName(now);
  const reportDir = join(REPORTS_DIR, folder);

  if (instrument_type) {
    const filePath = join(reportDir, `${instrument_type}.md`);
    if (existsSync(filePath)) {
      return { success: true, path: filePath, content: readFileSync(filePath, 'utf8') };
    }
    // Try yesterday's folder
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yPath = join(REPORTS_DIR, dateFolderName(yesterday), `${instrument_type}.md`);
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
      folder,
      reports_dir: reportDir,
      briefs_available: available,
      note: `Use instrument_type param to read a specific brief (e.g. instrument_type="futures")`,
    };
  }

  return { success: false, error: `No reports found for ${folder}`, reports_dir: REPORTS_DIR };
}
