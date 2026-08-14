/**
 * LuxAlgo batch screener scan.
 *
 * Switches to the LUXALGO_SCREENERS tab, pushes batches of 10 symbols into the
 * S&O, PAC, and OSC screeners via indicator_set_inputs, reads the resulting
 * pine tables, and returns a composite ranked analysis table.
 *
 * Ticker slots: in_4, in_8, in_12, ..., in_40  (every 4th input starting at 4)
 * Timeframe:    in_0
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as chart from './chart.js';
import * as indicators from './indicators.js';
import * as data from './data.js';
import { evaluate } from '../connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');

const TICKER_INPUT_IDS = ['in_4', 'in_8', 'in_12', 'in_16', 'in_20', 'in_24', 'in_28', 'in_32', 'in_36', 'in_40'];
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 8; // up to 12 seconds total

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
const DEFAULTS_PATH = join(PROJECT_ROOT, 'config', 'lux-screener-defaults.json');

function bareSymbol(symbol) {
  return String(symbol || '').includes(':') ? String(symbol).split(':').pop() : String(symbol || '');
}

// Normalize a watchlist entry to { symbol: bare, full_symbol: EXCHANGE:BARE }.
// Screener results already carry the correct exchange prefix; static watchlist
// entries get BATS: which TradingView resolves to the primary listing.
function resolveWatchlistEntry(e) {
  const sourceSymbol = String(e.symbol || '');
  const symbol = bareSymbol(sourceSymbol);
  const full_symbol = e.full_symbol || (sourceSymbol.includes(':')
    ? sourceSymbol
    : (e.exchange ? `${e.exchange}:${symbol}` : `BATS:${symbol}`));
  return { ...e, symbol, full_symbol };
}

/**
 * Find the chart tab that has all 3 LuxAlgo screeners loaded.
 * TV chart tabs all have title "TradingView" in CDP, so we must check each one.
 */
async function findScreenerTab() {
  const { switchTarget } = await import('../connection.js');
  const CDP_HOST = 'localhost';
  const CDP_PORT = 9222;

  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const chartTargets = targets.filter(t => t.type === 'page' && /tradingview\.com\/chart\//i.test(t.url));

  for (const target of chartTargets) {
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${target.id}`);
    await switchTarget(target.id);
    await new Promise(r => setTimeout(r, 300));
    try {
      const state = await chart.getState();
      const names = (state.studies || []).map(s => s.name);
      if (names.some(n => n.includes('S&O')) && names.some(n => n.includes('PAC')) && names.some(n => n.includes('OSC'))) {
        return { tab_id: target.id, studies: state.studies };
      }
    } catch {
      // skip tabs that fail to respond
    }
  }
  throw new Error(
    'Could not find a chart tab with all 3 LuxAlgo screeners (S&O, PAC, OSC). ' +
    'Open TradingView, go to the tab with the screeners, and ensure all 3 are visible.'
  );
}

function loadWatchlist(instrumentType) {
  const candidates = [
    join(PROJECT_ROOT, 'config', `strategy-${instrumentType}.json`),
    join(PROJECT_ROOT, `strategy-${instrumentType}.json`),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const s = JSON.parse(readFileSync(p, 'utf8'));
      if (Array.isArray(s.watchlist) && s.watchlist.length > 0) return { watchlist: s.watchlist, screener_name: null };
      // No static watchlist — return screener_name so runScan can fetch live
      if (s.screener_name) return { watchlist: null, screener_name: s.screener_name };
      throw new Error(`watchlist is empty and no screener_name in ${p}`);
    } catch (e) {
      throw new Error(`Failed to load watchlist from ${p}: ${e.message}`);
    }
  }
  throw new Error(`No strategy-${instrumentType}.json found.`);
}

function loadDefaults() {
  try {
    return JSON.parse(readFileSync(DEFAULTS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Extract ticker overrides (in_4..in_40) from a full PAC input array.
 * Returns { in_4: "BINANCE:BTCUSDT", ... } with correct exchange prefixes.
 */
function extractTickerOverrides(pacInputs) {
  const overrides = {};
  for (const inp of (pacInputs || [])) {
    if (TICKER_INPUT_IDS.includes(inp.id)) overrides[inp.id] = inp.value;
  }
  return overrides;
}

/**
 * Build a full input array for a protected indicator from getInputsInfo() defvals.
 * Includes ALL fields (including the encrypted `text` blob) so setInputValues restores properly.
 */
async function captureProtectedInputs(studyId) {
  const escapedId = studyId.replace(/'/g, "\\'");
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById('${escapedId}');
      if (!study) return null;
      var info = study.getInputsInfo();
      if (!info || info.length === 0) return null;
      var arr = [];
      for (var i = 0; i < info.length; i++) {
        if (info[i].defval !== undefined) arr.push({ id: info[i].id, value: info[i].defval });
      }
      return arr.length > 0 ? arr : null;
    })()
  `);
}

/**
 * Capture full pre-scan state so we can restore exactly after the scan.
 * PAC: not protected — reads getInputValues() directly.
 * S&O/OSC: protected (getInputValues returns []) — reads getInputsInfo() defvals including
 *   the encrypted `text` blob so the indicators don't go blank on restore.
 * Falls back to saved defaults file if live capture fails for PAC.
 */
async function capturePreScanState(pacStudy, soStudy, oscStudy) {
  const escapedPacId = pacStudy.id.replace(/'/g, "\\'");
  let pacInputs = null;
  let source = 'live';
  try {
    pacInputs = await evaluate(`
      (function() {
        var chart = ${CHART_API};
        var study = chart.getStudyById('${escapedPacId}');
        if (!study) return null;
        var vals = study.getInputValues();
        return (vals && vals.length > 0) ? vals : null;
      })()
    `);
  } catch {}

  const defaults = loadDefaults();
  if (!pacInputs || pacInputs.length === 0) {
    if (defaults?.pac_inputs?.length > 0) {
      pacInputs = defaults.pac_inputs;
      source = 'defaults_file';
    }
  }

  // Capture S&O and OSC from getInputsInfo() (includes encrypted text blob)
  let soInputs = null;
  let oscInputs = null;
  try { soInputs  = await captureProtectedInputs(soStudy.id);  } catch {}
  try { oscInputs = await captureProtectedInputs(oscStudy.id); } catch {}
  if (!soInputs  && defaults?.so_inputs?.length  > 0) soInputs  = defaults.so_inputs;
  if (!oscInputs && defaults?.osc_inputs?.length > 0) oscInputs = defaults.osc_inputs;

  return { pacInputs, soInputs, oscInputs, source };
}

/**
 * Restore a study using its captured input array, with ticker overrides re-applied.
 * This preserves the encrypted `text` blob for protected indicators.
 */
async function restoreStudyInputs(studyId, capturedInputs, tickerOverrides) {
  const escapedId = studyId.replace(/'/g, "\\'");
  // Apply ticker overrides back into the captured array
  const restored = capturedInputs.map(inp =>
    tickerOverrides.hasOwnProperty(inp.id) ? { id: inp.id, value: tickerOverrides[inp.id] } : inp
  );
  const inputsJson = JSON.stringify(restored);
  return evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById('${escapedId}');
      if (!study) return { error: 'Study not found' };
      var inputs = ${inputsJson};
      study.setInputValues(inputs);
      return { ok: true, count: inputs.length };
    })()
  `);
}

/**
 * Restore all 3 screeners to exactly the state captured before the scan.
 * All 3 use direct setInputValues with their captured arrays (preserves encrypted text blob).
 */
async function restoreScreenerDefaults(soStudy, pacStudy, oscStudy, preState) {
  const results = {};
  const tickerOverrides = extractTickerOverrides(preState?.pacInputs);

  if (preState?.pacInputs?.length > 0) {
    try { results.pac = await restoreStudyInputs(pacStudy.id, preState.pacInputs, {}); }
    catch (e) { results.pac = { error: e.message }; }
  }
  // S&O and OSC use bare symbols (e.g. "BTCUSDT") not exchange-prefixed — use their own defvals as-is
  if (preState?.soInputs?.length > 0) {
    try { results.so  = await restoreStudyInputs(soStudy.id,  preState.soInputs,  {}); }
    catch (e) { results.so  = { error: e.message }; }
  }
  if (preState?.oscInputs?.length > 0) {
    try { results.osc = await restoreStudyInputs(oscStudy.id, preState.oscInputs, {}); }
    catch (e) { results.osc = { error: e.message }; }
  }

  results.capture_source = preState?.source;
  return results;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * When the S&O pine table omits the TRACER cell for a symbol, every column
 * from TRACER onward shifts left by one position in the raw pipe-delimited row.
 * TREND STRENGTH always renders as an emoji + percentage (e.g. "❄️  47.86%"),
 * so if that pattern lands in the TRACER slot we know the shift occurred.
 */
function fixSoColumnShift(so) {
  const tracer = so['TRACER'] || '';
  if (tracer.includes('%')) {
    so['SQUEEZE']        = so['LUX VOLATILITY'] || '';
    so['LUX VOLATILITY'] = so['TREND STRENGTH'] || '';
    so['TREND STRENGTH'] = tracer;
    so['TRACER']         = '';
  }
  return so;
}

function parseTableRows(rows) {
  if (!rows || rows.length < 2) return {};
  const headers = rows[0].split('|').map(h => h.trim());
  const map = {};
  for (const row of rows.slice(1)) {
    const cells = row.split('|').map(c => c.trim());
    // First cell is "TICKER • TF" e.g. "SNDK • D"
    const ticker = cells[0].split('•')[0].trim();
    if (!ticker || ticker.toLowerCase().includes('not found')) continue;
    const entry = {};
    headers.forEach((h, i) => { if (i > 0 && h) entry[h] = cells[i] || ''; });
    map[ticker] = entry;
  }
  return map;
}

/**
 * Hard-rule filter replacing the old arbitrary composite score.
 *
 * Pass criteria (all three required for momentum continuation):
 *   1. S&O Rating = Bullish or Strong Bullish (≥60% confluence)
 *   2. PAC Structure = BOS (any count) — CHoCH/CHoCH+ excluded
 *   3. S&O Signal = ▲ or ▲+ (confirmed bullish direction)
 *
 * Sort order within passing symbols (encoded as a numeric score for
 * backward-compatible ranking — higher = better):
 *   Signal ▲+ beats ▲ (+1)
 *   BOS count: each consecutive BOS adds +1 (BOS(5) = 5 pts)
 *   OSC Bullish divergence adds +1 as tiebreaker
 *
 * Symbols that fail any hard filter get score = -99 (sorted to bottom).
 */
function scoreSymbol(so, pac, osc) {
  const soRating = so['RATING'] || '';
  const signal   = so['SIGNAL'] || '';
  const struct   = pac['STRUCTURE'] || '';

  // Hard filter 1: S&O Rating must be Bullish or Strong Bullish
  const ratingOk = soRating.includes('Bullish'); // covers both "Bullish" and "Strong Bullish"

  // Hard filter 2: PAC structure must be BOS (not CHoCH or CHoCH+)
  const structOk = struct.includes('BOS') && !struct.includes('CHoCH');

  // Hard filter 3: Signal must be bullish direction
  const signalOk = signal.includes('▲');

  if (!ratingOk || !structOk || !signalOk) return -99;

  // Sort score for passing symbols
  let score = 0;

  // Signal strength: ▲+ beats ▲
  if (signal.includes('▲+')) score += 1;

  // BOS count — extract the number from "BOS (N)"
  const bosMatch = struct.match(/BOS\s*\((\d+)\)/i);
  if (bosMatch) score += parseInt(bosMatch[1], 10);

  // Bullish divergence as tiebreaker
  const div = osc['DIVERGENCES'] || '';
  if (div.includes('Bullish')) score += 1;

  return score;
}

function fmtPrice(p) {
  if (p == null) return '—';
  return p >= 1000 ? p.toFixed(0) : p >= 100 ? p.toFixed(1) : p.toFixed(2);
}

function buildMarkdownTable(rows) {
  const hasNw = rows.some(r => r.nw_position != null);
  const baseHeader = '| SYMBOL | WTD | S&O RATING | SIGNAL | EXITS | SMART TRAIL | CATCHER | TRACER | TREND STRENGTH | LUX VOLATILITY | SQUEEZE | PAC RATING | STRUCTURE | ORDER BLOCK | FVG | P&D ZONES | LIQUIDITY GRABS | EQHL | OSC RATING | HWO | MONEY FLOW | OVERFLOW | HYPERWAVE | REVERSALS | DIVERGENCES | CONFLUENCE | SCORE | CHATTER |';
  const baseSep    = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  const nwHeader   = '| SYMBOL | WTD | S&O RATING | SIGNAL | EXITS | SMART TRAIL | CATCHER | TRACER | TREND STRENGTH | LUX VOLATILITY | SQUEEZE | PAC RATING | STRUCTURE | ORDER BLOCK | FVG | P&D ZONES | LIQUIDITY GRABS | EQHL | OSC RATING | HWO | MONEY FLOW | OVERFLOW | HYPERWAVE | REVERSALS | DIVERGENCES | CONFLUENCE | SCORE | NW | STOP | TP1 | R:R | CHATTER |';
  const nwSep      = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';

  const header = hasNw ? nwHeader : baseHeader;
  const sep    = hasNw ? nwSep    : baseSep;

  const lines = rows.map(r => {
    const base = `| ${r.symbol} | ${r.wtd != null ? r.wtd + '%' : '—'} | ${r.so['RATING'] || '—'} | ${r.so['SIGNAL'] || '—'} | ${r.so['EXITS'] || '—'} | ${r.so['SMART TRAIL'] || '—'} | ${r.so['CATCHER'] || '—'} | ${r.so['TRACER'] || '—'} | ${r.so['TREND STRENGTH'] || '—'} | ${r.so['LUX VOLATILITY'] || '—'} | ${r.so['SQUEEZE'] || '—'} | ${r.pac['RATING'] || '—'} | ${r.pac['STRUCTURE'] || '—'} | ${r.pac['ORDER BLOCK'] || '—'} | ${r.pac['FVG'] || '—'} | ${r.pac['P&D ZONES'] || '—'} | ${r.pac['LIQUIDITY GRABS'] || '—'} | ${r.pac['EQHL'] || '—'} | ${r.osc['RATING'] || '—'} | ${r.osc['HWO SIGNAL'] || '—'} | ${r.osc['MONEY FLOW'] || '—'} | ${r.osc['OVERFLOW'] || '—'} | ${r.osc['HYPERWAVE'] || '—'} | ${r.osc['REVERSALS'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} | ${r.osc['CONFLUENCE'] || '—'} | ${r.score} | ${r.chatter || '—'} |`;
    if (!hasNw) return base;
    const nwPos = r.nw_position || '—';
    const stop  = r.nw_lower != null ? fmtPrice(r.nw_lower) : '—';
    const tp1   = r.nw_upper != null ? fmtPrice(r.nw_upper) : '—';
    const rr    = r.rr != null ? r.rr.toFixed(1) : '—';
    return `| ${r.symbol} | ${r.wtd != null ? r.wtd + '%' : '—'} | ${r.so['RATING'] || '—'} | ${r.so['SIGNAL'] || '—'} | ${r.so['EXITS'] || '—'} | ${r.so['SMART TRAIL'] || '—'} | ${r.so['CATCHER'] || '—'} | ${r.so['TRACER'] || '—'} | ${r.so['TREND STRENGTH'] || '—'} | ${r.so['LUX VOLATILITY'] || '—'} | ${r.so['SQUEEZE'] || '—'} | ${r.pac['RATING'] || '—'} | ${r.pac['STRUCTURE'] || '—'} | ${r.pac['ORDER BLOCK'] || '—'} | ${r.pac['FVG'] || '—'} | ${r.pac['P&D ZONES'] || '—'} | ${r.pac['LIQUIDITY GRABS'] || '—'} | ${r.pac['EQHL'] || '—'} | ${r.osc['RATING'] || '—'} | ${r.osc['HWO SIGNAL'] || '—'} | ${r.osc['MONEY FLOW'] || '—'} | ${r.osc['OVERFLOW'] || '—'} | ${r.osc['HYPERWAVE'] || '—'} | ${r.osc['REVERSALS'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} | ${r.osc['CONFLUENCE'] || '—'} | ${r.score} | ${nwPos} | ${stop} | ${tp1} | ${rr} | ${r.chatter || '—'} |`;
  });
  return [header, sep, ...lines].join('\n');
}

function buildThematicTable(rows) {
  // Group by theme preserving first-seen order, sort by score within each theme
  const themeOrder = [];
  const byTheme = {};
  for (const r of rows) {
    const theme = r.theme || 'Other';
    if (!byTheme[theme]) { byTheme[theme] = []; themeOrder.push(theme); }
    byTheme[theme].push(r);
  }
  for (const theme of themeOrder) {
    byTheme[theme].sort((a, b) => b.score - a.score);
  }

  const allThemeRows = themeOrder.flatMap(t => byTheme[t]);
  const hasNw = allThemeRows.some(r => r.nw_position != null);

  const header = hasNw
    ? '| SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | HWO | SCORE | NW | STOP | TP1 | R:R |'
    : '| SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | HWO | SCORE |';
  const sep = hasNw
    ? '|---|---|---|---|---|---|---|---|---|---|---|---|'
    : '|---|---|---|---|---|---|---|---|';

  const sections = [];
  for (const theme of themeOrder) {
    const themeRows = byTheme[theme];
    const bullish = themeRows.filter(r => r.score >= 3).length;
    const bearish = themeRows.filter(r => r.score <= -2).length;
    const bias = bullish > bearish ? '▲' : bearish > bullish ? '▼' : '→';
    sections.push(`### ${theme} ${bias} (${bullish}B / ${bearish}Br / ${themeRows.length} total)`);
    sections.push(header);
    sections.push(sep);
    for (const r of themeRows) {
      if (hasNw) {
        const nwPos = r.nw_position || '—';
        const stop  = r.nw_lower != null ? fmtPrice(r.nw_lower) : '—';
        const tp1   = r.nw_upper != null ? fmtPrice(r.nw_upper) : '—';
        const rr    = r.rr != null ? r.rr.toFixed(1) : '—';
        sections.push(`| ${r.symbol} | ${r.sub_group || '—'} | ${r.so['RATING'] || '—'} | ${r.so['SIGNAL'] || '—'} | ${r.pac['STRUCTURE'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} | ${r.osc['HWO SIGNAL'] || '—'} | ${r.score} | ${nwPos} | ${stop} | ${tp1} | ${rr} |`);
      } else {
        sections.push(`| ${r.symbol} | ${r.sub_group || '—'} | ${r.so['RATING'] || '—'} | ${r.so['SIGNAL'] || '—'} | ${r.pac['STRUCTURE'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} | ${r.osc['HWO SIGNAL'] || '—'} | ${r.score} |`);
      }
    }
    sections.push('');
  }
  return sections.join('\n');
}

function buildChatterSection(sorted) {
  // Conflict = Overheated in top half, Oversold in bottom half (confirms breakdown)
  // Opportunity = Oversold with decent score (contrarian), Quietest with high score (stealth)
  const lines = [];

  const overheatedTop = sorted.filter(r => r.chatter === 'Overheated' && r.score >= 3);
  const oversoldStrong = sorted.filter(r => r.chatter === 'Oversold' && r.score >= 2);
  const oversoldWeak   = sorted.filter(r => r.chatter === 'Oversold' && r.score < 0);
  const quietestHigh   = sorted.filter(r => r.chatter === 'Quietest' && r.score >= 3);
  const loudestTop     = sorted.filter(r => r.chatter === 'Loudest' && r.score >= 3);

  if (overheatedTop.length) {
    lines.push(`**⚠ Overheated + Strong Setup (size smaller, no gap-chasing):** ${overheatedTop.map(r => `${r.symbol} (${r.score})`).join(', ')}`);
  }
  if (oversoldStrong.length) {
    lines.push(`**↩ Oversold + Intact Technicals (contrarian bounce watch):** ${oversoldStrong.map(r => `${r.symbol} (${r.score})`).join(', ')}`);
  }
  if (oversoldWeak.length) {
    lines.push(`**✗ Oversold + Weak Technicals (washout confirmed, avoid):** ${oversoldWeak.map(r => `${r.symbol} (${r.score})`).join(', ')}`);
  }
  if (quietestHigh.length) {
    lines.push(`**👁 Quietest + High Score (stealth setup, under radar):** ${quietestHigh.map(r => `${r.symbol} (${r.score})`).join(', ')}`);
  }
  if (loudestTop.length) {
    lines.push(`**📢 Loudest + Strong Setup (crowd confirming, watch for exhaustion):** ${loudestTop.map(r => `${r.symbol} (${r.score})`).join(', ')}`);
  }

  return lines.length ? lines.join('\n') : '— No notable chatter conflicts or confluences this week.';
}

/**
 * Find the main chart tab (not the LUXALGO_SCREENERS tab).
 * Returns the first page target that has the NW Envelope loaded.
 * Falls back to the first non-screener chart tab if NW isn't found.
 */
async function findMainChartTab() {
  const { switchTarget } = await import('../connection.js');
  const CDP_HOST = 'localhost';
  const CDP_PORT = 9222;

  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const chartTargets = targets.filter(t => t.type === 'page' && /tradingview\.com\/chart\//i.test(t.url));

  let fallback = null;
  for (const target of chartTargets) {
    await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${target.id}`);
    await switchTarget(target.id);
    await new Promise(r => setTimeout(r, 150));
    try {
      const state = await chart.getState();
      const names = (state.studies || []).map(s => s.name);
      const isScreenerTab = names.some(n => n.includes('S&O')) && names.some(n => n.includes('PAC'));
      if (isScreenerTab) continue;
      if (names.some(n => /nadaraya/i.test(n))) return { tab_id: target.id, state };
      if (!fallback) fallback = { tab_id: target.id, state };
    } catch {}
  }
  if (fallback) return fallback;
  throw new Error('No main chart tab found. Open a TradingView chart tab (separate from the LUXALGO_SCREENERS tab) with the Nadaraya-Watson Envelope indicator loaded.');
}

/**
 * Read NW Envelope position and band levels for the current chart symbol.
 * Returns { nw_position, nw_upper, nw_lower, price, rr }.
 *
 * nw_position:
 *   'extended' — most recent NW label is ▲ (price crossed above upper band)
 *   'early'    — most recent NW label is ▼ (price crossed below lower band)
 *   'inside'   — no recent label (price inside the envelope bands)
 *   'unknown'  — NW indicator not readable
 */
function timeoutReject(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms));
}

function timeoutResolve(ms, value = null) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

async function readNwEnvelope() {
  try {
    const [labelsResult, studyValResult, quoteResult] = await Promise.race([
      Promise.all([
        data.getPineLabels({ study_filter: 'Nadaraya-Watson', max_labels: 3 }),
        data.getStudyValues(),
        data.getQuote({}),
      ]),
      timeoutResolve(4000, [null, null, null]),
    ]);

    // Determine position from most-recent label
    const labels = labelsResult?.studies?.[0]?.labels || [];
    const mostRecent = labels[0];
    let nw_position = 'inside';
    if (mostRecent?.text === '▲') nw_position = 'extended';
    else if (mostRecent?.text === '▼') nw_position = 'early';
    else if (!labelsResult?.studies?.length) nw_position = 'unknown';

    const price = quoteResult?.close ?? quoteResult?.last_price ?? null;

    // Primary: extract NW band levels from Data Window (getStudyValues reads plot() overlays)
    // NW Envelope uses plot() not line.new(), so getPineLines returns nothing for it.
    let nw_upper = null;
    let nw_lower = null;
    const nwStudy = studyValResult?.studies?.find(s => /nadaraya/i.test(s.name));
    if (nwStudy && price != null) {
      const vals = Object.values(nwStudy.values ?? {})
        .map(v => parseFloat(String(v).replace(/,/g, '')))
        .filter(v => isFinite(v) && v > 0 && Math.abs(v - price) / price < 0.5);
      if (vals.length >= 2) {
        vals.sort((a, b) => b - a);
        nw_upper = vals[0];
        nw_lower = vals[vals.length - 1];
      }
    }

    // Fallback: use label crossing price as a one-sided band proxy
    if (mostRecent?.price != null) {
      if (nw_position === 'extended' && nw_upper == null) nw_upper = mostRecent.price;
      else if (nw_position === 'early'    && nw_lower == null) nw_lower = mostRecent.price;
    }

    // R:R = room to upper band / risk to lower band
    let rr = null;
    if (price != null && nw_upper != null && nw_lower != null && price > nw_lower) {
      const reward = nw_upper - price;
      const risk   = price - nw_lower;
      rr = risk > 0 ? Math.round((reward / risk) * 10) / 10 : null;
    }

    return {
      nw_position,
      nw_upper,
      nw_lower,
      price,
      rr,
      // Preserve the provider's original Data Window property names/values.
      // This is intentionally separate from the compatibility reduction above.
      nw_raw_values: nwStudy?.values ?? null,
    };
  } catch {
    return {
      nw_position: 'unknown', nw_upper: null, nw_lower: null, price: null, rr: null,
      nw_raw_values: null,
    };
  }
}

function studyAvailability(map, tableRows, symbol) {
  if (!Array.isArray(tableRows)) return 'UNVERIFIED';
  return Object.prototype.hasOwnProperty.call(map, symbol) ? 'PRESENT' : 'ABSENT';
}

export const luxScreenerTestHelpers = {
  parseTableRows,
  resolveWatchlistEntry,
  studyAvailability,
};

// Serialize all scans onto a single chain: the LUXALGO_SCREENERS tab's S&O/PAC/OSC
// studies are shared mutable state (one set of indicator objects on one chart tab),
// and an MCP client timing out a call does not cancel the in-flight server-side
// runScanInternal() execution. Without this queue, a retried or overlapping call can
// race a still-running one and clobber its ticker inputs mid-poll, producing blank
// S&O/OSC tables for the other (2026-08-13 r2k incident: momentum_etf timed out 3x,
// r2k started immediately after and came back with S&O/OSC UNVERIFIED for its whole run).
let scanChain = Promise.resolve();
let scanInFlight = false;

export function runScan(opts) {
  if (scanInFlight) {
    console.error(
      `lux_screener_scan: queuing instrument_type=${opts?.instrument_type} offset=${opts?.offset} ` +
      `behind a scan already in progress — avoids racing shared S&O/PAC/OSC indicator state.`
    );
  }
  const run = scanChain.then(() => {
    scanInFlight = true;
    return runScanInternal(opts).finally(() => { scanInFlight = false; });
  });
  scanChain = run.catch(() => {}); // keep the chain alive even if this call fails
  return run;
}

async function runScanInternal({ instrument_type = 'stwits_lg', timeframe = '1D', offset = 0, max_symbols = 0 } = {}) {
  // Map user-facing TF labels to Pine-valid resolution strings
  const TF_MAP = { '1D': 'D', '1W': 'W', '4H': '240' };
  const chartTf = TF_MAP[timeframe] || 'D';

  // 1. Auto-discover the chart tab with all 3 LuxAlgo screeners
  const { studies } = await findScreenerTab();

  // 2. Set chart timeframe — screeners with in_0="None" inherit this
  await chart.setTimeframe({ timeframe: chartTf });
  await new Promise(r => setTimeout(r, 1500));
  const soStudy  = studies.find(s => s.name.includes('S&O'));
  const pacStudy = studies.find(s => s.name.includes('PAC'));
  const oscStudy = studies.find(s => s.name.includes('OSC'));

  // 3. Capture pre-scan state so we can restore exactly after the scan
  const preState = await capturePreScanState(pacStudy, soStudy, oscStudy);

  // 4. Load watchlist — static list or live screener fetch
  const { watchlist: staticList, screener_name } = loadWatchlist(instrument_type);
  let watchlist;
  if (staticList) {
    watchlist = staticList;
  } else {
    // No static watchlist: fetch live from TradingView screener
    const { get: screenerGet } = await import('./screener.js');
    const screenerResult = await screenerGet({ screener_name });
    // Screener returns EXCHANGE:SYMBOL strings; preserve that for chart inputs but
    // keep bare symbols as output keys.
    watchlist = screenerResult.symbols.map(s => ({ symbol: bareSymbol(s), full_symbol: s }));
  }
  watchlist = watchlist.map(resolveWatchlistEntry);
  // Apply offset/max_symbols slice for large watchlists
  const totalSymbols = watchlist.length;
  const sliceStart = Math.min(offset, totalSymbols);
  const sliceEnd   = max_symbols > 0 ? Math.min(sliceStart + max_symbols, totalSymbols) : totalSymbols;
  watchlist = watchlist.slice(sliceStart, sliceEnd);
  const metaMap = Object.fromEntries(watchlist.map(e => [e.symbol, e]));
  const symbols = watchlist.map(e => e.symbol);

  // 5. Batch scan
  const batches = chunk(symbols, 10);
  const allRows = {};

  let restoreResult;
  try {
  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];

    // Build inputs: only ticker slots — don't touch any boolean inputs
    // Pad short batches by repeating the last symbol (avoids empty-string parse errors)
    const lastSym = batch[batch.length - 1];
    const inputs = {};
    TICKER_INPUT_IDS.forEach((id, i) => {
      const sym = batch[i] || lastSym;
      inputs[id] = metaMap[sym]?.full_symbol || `BATS:${sym}`;
    });
    const inputsStr = JSON.stringify(inputs);

    // PAC supports getInputValues(); S&O and OSC are protected and return [].
    // Use setInputsFromInfo for S&O/OSC — it builds the input array from getInputsInfo()
    // defvals (safe) and applies only the ticker overrides.
    await indicators.setInputs({ entity_id: pacStudy.id, inputs: inputsStr });
    await indicators.setInputsFromInfo({ entity_id: soStudy.id,  overrides: inputs });
    await indicators.setInputsFromInfo({ entity_id: oscStudy.id, overrides: inputs });

    // Poll until the S&O table shows at least one expected ticker (or timeout)
    const expectedTickers = new Set(batch);
    let soMap = {}, pacMap = {}, oscMap = {};
    let soRows = null, pacRows = null, oscRows = null;

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const [soResult, pacResult, oscResult] = await Promise.all([
        data.getPineTables({ study_filter: 'S&O' }),
        data.getPineTables({ study_filter: 'PAC' }),
        data.getPineTables({ study_filter: 'OSC' }),
      ]);

      soRows  = soResult.studies?.[0]?.tables?.[0]?.rows;
      pacRows = pacResult.studies?.[0]?.tables?.[0]?.rows;
      oscRows = oscResult.studies?.[0]?.tables?.[0]?.rows;
      soMap  = parseTableRows(soRows);
      pacMap = parseTableRows(pacRows);
      oscMap = parseTableRows(oscRows);

      // Use PAC as readiness indicator (most reliable — S&O/OSC may load slower)
      const loaded = Object.keys(pacMap).filter(t => expectedTickers.has(t) && pacMap[t]['STRUCTURE']);
      if (loaded.length > 0) break;
    }

    const capturedAt = new Date().toISOString();
    for (const sym of batch) {
      const so  = fixSoColumnShift({ ...(soMap[sym]  || {}) });
      const pac = pacMap[sym] || {};
      const osc = oscMap[sym] || {};
      allRows[sym] = {
        symbol:    sym,
        full_symbol: metaMap[sym]?.full_symbol ?? null,
        captured_at: capturedAt,
        wtd:       metaMap[sym]?.wtd ?? null,
        sentiment: metaMap[sym]?.sentiment ?? null,
        watchers:  metaMap[sym]?.watchers ?? null,
        chatter:   metaMap[sym]?.chatter ?? null,
        theme:     metaMap[sym]?.theme ?? null,
        sub_group: metaMap[sym]?.sub_group ?? null,
        so,
        pac,
        osc,
        so_status:  studyAvailability(soMap, soRows, sym),
        pac_status: studyAvailability(pacMap, pacRows, sym),
        osc_status: studyAvailability(oscMap, oscRows, sym),
        score: scoreSymbol(so, pac, osc),
      };
    }
  }

  } finally {
    // Always restore screener to defaults so it isn't left on scan residue
    restoreResult = await restoreScreenerDefaults(soStudy, pacStudy, oscStudy, preState);
  }

  // 6. NW Envelope L3 check — passing symbols only (score > -99)
  // Switches to main chart tab, sets to 1W, reads NW for each passer.
  const passingSymbols = Object.values(allRows)
    .filter(r => r.score > -99)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30);
  let nwPassError = null;
  if (passingSymbols.length > 0) {
    try {
      await Promise.race([
        (async () => {
          await findMainChartTab();
          await chart.setTimeframe({ timeframe: chartTf });
          await new Promise(r => setTimeout(r, 500));
          for (const row of passingSymbols) {
            await chart.setSymbol({ symbol: row.symbol });
            await new Promise(r => setTimeout(r, 800));
            const nw = await readNwEnvelope();
            row.nw_position = nw.nw_position;
            row.nw_upper    = nw.nw_upper;
            row.nw_lower    = nw.nw_lower;
            row.price       = nw.price;
            row.rr          = nw.rr;
            row.nw_raw_values = nw.nw_raw_values;
          }
        })(),
        timeoutReject(50000),
      ]);
    } catch (e) {
      nwPassError = e.message;
    }
  }

  // 7. Sort by score descending
  const sorted = Object.values(allRows).sort((a, b) => b.score - a.score);

  const topCandidates = sorted.slice(0, 10);
  const avoidList     = sorted.slice(-10).reverse();

  const topSection = topCandidates.length
    ? topCandidates.map(r => {
        const chatter = r.chatter ? ` | ⚠ ${r.chatter}` : '';
        const nwPart = r.nw_position != null
          ? ` | NW: ${r.nw_position}${r.rr != null ? ` | R:R ${r.rr.toFixed(1)}` : ''}`
          : '';
        return `- **${r.symbol}** — Score ${r.score} | ${r.so['RATING'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} divergence | ${r.pac['STRUCTURE'] || '—'} | Squeeze ${r.so['SQUEEZE'] || '—'}${nwPart}${chatter}`;
      }).join('\n')
    : '- No symbols scanned';

  const avoidSection = avoidList.length
    ? avoidList.map(r => {
        const chatter = r.chatter ? ` | ⚠ ${r.chatter}` : '';
        return `- **${r.symbol}** — Score ${r.score} | ${r.so['RATING'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} divergence | ${r.pac['STRUCTURE'] || '—'}${chatter}`;
      }).join('\n')
    : '- None';

  const chatterSection = buildChatterSection(sorted);
  const isThematic = sorted.some(r => r.theme);

  // NW data quality check — warn if passers exist but R:R is universally null
  const passersWithNw = passingSymbols.filter(r => r.rr != null);
  const nwDataWarning = passingSymbols.length >= 3 && passersWithNw.length === 0
    ? `WARNING: NW R:R is null for all ${passingSymbols.length} passing symbols. ` +
      `NW Envelope band levels are not exposed in the Data Window (expected — it is a price overlay, not an oscillator). ` +
      `R:R can only be computed when both bands are available via label crossings; ` +
      `inside symbols have no crossing label and therefore no band data. ` +
      `decision-classify.mjs routes these to ready_norr — confirm R:R manually before entry.`
    : undefined;

  return {
    success: true,
    instrument_type,
    timeframe,
    slice_range: `${sliceStart + 1}–${sliceEnd} of ${totalSymbols}`,
    symbol_count: sorted.length,
    batch_count: batches.length,
    restore_debug: restoreResult,
    nw_pass_symbols: passingSymbols.length,
    nw_pass_error: nwPassError || undefined,
    nw_data_warning: nwDataWarning,
    table: isThematic ? buildThematicTable(sorted) : buildMarkdownTable(sorted),
    top_candidates: topCandidates.map(r => r.symbol),
    top_section: topSection,
    avoid_list: avoidList.map(r => r.symbol),
    avoid_section: avoidSection,
    chatter_section: chatterSection,
    symbols_raw: Object.values(allRows),
  };
}
