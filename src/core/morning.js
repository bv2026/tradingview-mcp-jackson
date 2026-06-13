/**
 * Morning brief core logic.
 * Reads rules.json for screener source, loads strategy-{type}.json for bias criteria,
 * pulls live symbols from the TradingView screener, ensures required indicators are
 * on the chart, scans each symbol, and returns structured data for Claude to apply
 * the strategy rules and generate a session brief.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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

const ALL_INSTRUMENTS = ['stocks', 'etf', 'ark', 'crypto', 'crypto_perps', 'futures'];

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

  if (!screenerName) {
    // Static watchlist path — no live screener
    const staticList = strategy.watchlist;
    if (!staticList || staticList.length === 0) {
      throw new Error(
        `No screener configured for "${instrument}" and no watchlist found in strategy-${instrument}.json.`
      );
    }
    symbols = staticList.slice(0, maxSymbols).map(s => s);
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

  const results = [];

  const CHART_API = KNOWN_PATHS.chartApi;

  for (const symbol of symbols) {
    try {
      // Switch symbol + timeframe directly without waitForChartReady (too slow for batch scans)
      await evaluate(`${CHART_API}.setSymbol('${symbol.replace(/'/g, "\\'")}', {})`);
      await evaluate(`${CHART_API}.setResolution('${timeframe}', {})`);
      // Flat wait — enough for indicator values to update
      await new Promise(r => setTimeout(r, _scan_wait_ms ?? 800));

      const [indicators, quote, nwSignals] = await Promise.all([
        data.getStudyValues(),
        data.getQuote({}),
        data.getPineLabels({ study_filter: 'Nadaraya-Watson' }),
      ]);

      results.push({ symbol, timeframe, indicators, quote, nw_envelope_signals: nwSignals });
    } catch (err) {
      results.push({ symbol, error: err.message });
    }
  }

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
      instrument === 'crypto_perps'
        ? `PERPS BENCHMARK: The FIRST symbol in symbols_scanned is always BTC perp. Read its TWB Histogram. If POSITIVE → market in uptrend → scan all alts for LONG setups using bullish_long criteria. If NEGATIVE → market in downtrend → scan all alts for SHORT setups using bearish_short criteria. Do NOT default to "no trades" on negative BTC TWB — negative means SHORT side is in play. Commodity perps (SILVER, GOLD) use their own TWB signal independently of BTC. Output top 3 LONG candidates OR top 3 SHORT candidates depending on BTC TWB direction.`
        : instrument === 'futures'
        ? `FUTURES REGIME DETECTION: Each symbol is evaluated independently — no single benchmark. For each symbol, determine which regime applies using regime_detection rules: TRENDING (TWB Histogram clearly directional for 3+ bars, HH/HL or LL/LH structure) or MEAN_REVERTING (TWB near zero or reversing, RSI extreme, price extended beyond NW band). Then apply the matching bias_criteria (trend_long, trend_short, mean_rev_long, mean_rev_short). Check macro_overlays in market_context: DXY direction affects metals/FX, ZB/ZN direction affects equity index, VX1! level sets overall risk mode. Output one line per symbol with its regime tag. End with top 3 setups across all sectors.`
        : instrument === 'ark'
        ? `ARK RELATIVE STRENGTH + BASE BREAKOUT: First check QQQ — if QQQ is below its 50-day EMA, all signals are SKIP (wait for market). For each symbol: (1) RELATIVE STRENGTH — compare the stock's recent price action to QQQ. If QQQ is down 2% over 20 days and the stock is down 0.5%, RS is positive. If QQQ is up 3% and stock is flat, RS is negative — skip it. (2) BASE CHECK — is the stock in a 2-6 week tight consolidation after a prior move up? Volume should be contracting during the base. NW Envelope: price should be inside bands (no recent ▲ signal = not yet extended). (3) BREAKOUT SIGNAL — TWB Histogram turning positive or printing a breakout. Assign each symbol one of: BASE_BUILDING (positive RS, base forming, volume contracting), BREAKOUT_READY (base complete, TWB triggering), EXTENDED (NW ▲ already printed, move played out — skip), SKIP (QQQ below 50d EMA, stock below 50d EMA, negative RS, or earnings within 5 days). Note the correlation cluster (ai_semis / fintech_crypto / autonomy_space / ai_software / genomics) — flag if multiple names from same cluster would be entered simultaneously.`
        : `Check market_context first — if the benchmark (${strategy.market_context?.benchmark || 'SPY'}) is below its 50-day SMA, default all to neutral/bearish. IMPORTANT: bearish signals = exit/avoid on longs only. Do NOT suggest short entries.`,
      `If strategy has tradeable_exchanges defined, flag any symbol NOT available on those exchanges as SKIP.`,
      instrument === 'ark'
        ? `Output one line per symbol: SYMBOL | STATUS: [BASE_BUILDING/BREAKOUT_READY/EXTENDED/SKIP] | RS: [+/-] | SIGNAL: [key observation] | CLUSTER: [cluster name]`
        : `Output one line per symbol: SYMBOL | BIAS: [long/short/neutral] | SIGNAL: [key observation] | WATCH: [what to monitor]`,
      instrument === 'ark'
        ? `Then list top 3 BREAKOUT_READY candidates (or BASE_BUILDING if none are ready) with entry_criteria checklist and cluster warning if applicable.`
        : `Then list top 3 candidates (longs or shorts depending on BTC TWB direction) with entry_criteria checklist.`,
      `End with a one-sentence overall market read.`,
      `Be direct. No preamble.`,
      `After writing your analysis, call session_save with your complete output text and instrument_type="${instrument}". Do not wait for the user to ask.`,
    ].join(' '),
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

  const types = ['stocks', 'etf', 'ark', 'crypto', 'crypto_perps', 'futures'];

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

  // No instrument_type: list what's saved today
  const available = types.filter(t => existsSync(join(reportDir, `${t}.md`)));
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
