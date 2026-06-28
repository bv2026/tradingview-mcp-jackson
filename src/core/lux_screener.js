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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../../');

const TICKER_INPUT_IDS = ['in_4', 'in_8', 'in_12', 'in_16', 'in_20', 'in_24', 'in_28', 'in_32', 'in_36', 'in_40'];
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 8; // up to 12 seconds total

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
      if (!Array.isArray(s.watchlist) || s.watchlist.length === 0)
        throw new Error(`watchlist is empty in ${p}`);
      return s.watchlist;
    } catch (e) {
      throw new Error(`Failed to load watchlist from ${p}: ${e.message}`);
    }
  }
  throw new Error(`No strategy-${instrumentType}.json found.`);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseTableRows(rows) {
  if (!rows || rows.length < 2) return {};
  const headers = rows[0].split('|').map(h => h.trim());
  const map = {};
  for (const row of rows.slice(1)) {
    const cells = row.split('|').map(c => c.trim());
    // First cell is "TICKER • TF" e.g. "SNDK • D"
    const ticker = cells[0].split('•')[0].trim();
    if (!ticker) continue;
    const entry = {};
    headers.forEach((h, i) => { if (i > 0 && h) entry[h] = cells[i] || ''; });
    map[ticker] = entry;
  }
  return map;
}

function scoreSymbol(so, pac, osc) {
  let score = 0;

  // S&O Rating
  const soRating = so['RATING'] || '';
  if (soRating.includes('Strong Bullish')) score += 3;
  else if (soRating.includes('Bullish')) score += 2;
  else if (soRating.includes('Neutral')) score += 0;
  else score -= 2; // bearish

  // S&O Signal
  const signal = so['SIGNAL'] || '';
  if (signal.includes('▲+')) score += 2;
  else if (signal.includes('▲')) score += 1;
  else if (signal.includes('▼')) score -= 1;

  // OSC Divergences
  const div = osc['DIVERGENCES'] || '';
  if (div.includes('Bullish')) score += 2;
  else if (div.includes('Bearish')) score -= 2;

  // OSC HWO Signal
  const hwo = osc['HWO SIGNAL'] || '';
  if (hwo.includes('Up')) score += 1;
  else if (hwo.includes('Down') || hwo.includes('Overbought')) score -= 1;

  // OSC Overflow (overextended)
  if (osc['OVERFLOW'] && osc['OVERFLOW'] !== 'None' && osc['OVERFLOW'] !== '') score -= 1;

  // PAC Structure
  const struct = pac['STRUCTURE'] || '';
  if (struct.includes('CHoCH')) score -= 2;
  else if (struct.includes('BOS')) score += 1;

  return score;
}

function buildMarkdownTable(rows) {
  const header = '| SYMBOL | WTD | S&O RATING | SIGNAL | SQUEEZE | PAC STRUCTURE | OSC DIV | HWO | SCORE | CHATTER |';
  const sep    = '|---|---|---|---|---|---|---|---|---|---|';
  const lines = rows.map(r =>
    `| ${r.symbol} | ${r.wtd != null ? r.wtd + '%' : '—'} | ${r.so['RATING'] || '—'} | ${r.so['SIGNAL'] || '—'} | ${r.so['SQUEEZE'] || '—'} | ${r.pac['STRUCTURE'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} | ${r.osc['HWO SIGNAL'] || '—'} | ${r.score} | ${r.chatter || '—'} |`
  );
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

  const header = '| SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | HWO | SCORE |';
  const sep    = '|---|---|---|---|---|---|---|---|';

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
      sections.push(`| ${r.symbol} | ${r.sub_group || '—'} | ${r.so['RATING'] || '—'} | ${r.so['SIGNAL'] || '—'} | ${r.pac['STRUCTURE'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} | ${r.osc['HWO SIGNAL'] || '—'} | ${r.score} |`);
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

export async function runScan({ instrument_type = 'stwits_lg', timeframe = '1D' } = {}) {
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

  // 3. Load watchlist
  const watchlist = loadWatchlist(instrument_type);
  const metaMap = Object.fromEntries(watchlist.map(e => [e.symbol, e]));
  const symbols = watchlist.map(e => e.symbol);

  // 4. Batch scan
  const batches = chunk(symbols, 10);
  const allRows = {};

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];

    // Build inputs: only ticker slots — don't touch any boolean inputs
    // Pad short batches by repeating the last symbol (avoids empty-string parse errors)
    const lastSym = batch[batch.length - 1];
    const inputs = {};
    TICKER_INPUT_IDS.forEach((id, i) => {
      const sym = batch[i] || lastSym;
      inputs[id] = `BATS:${sym}`;
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

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      const [soResult, pacResult, oscResult] = await Promise.all([
        data.getPineTables({ study_filter: 'S&O' }),
        data.getPineTables({ study_filter: 'PAC' }),
        data.getPineTables({ study_filter: 'OSC' }),
      ]);

      soMap  = parseTableRows(soResult.studies?.[0]?.tables?.[0]?.rows);
      pacMap = parseTableRows(pacResult.studies?.[0]?.tables?.[0]?.rows);
      oscMap = parseTableRows(oscResult.studies?.[0]?.tables?.[0]?.rows);

      // Use PAC as readiness indicator (most reliable — S&O/OSC may load slower)
      const loaded = Object.keys(pacMap).filter(t => expectedTickers.has(t) && pacMap[t]['STRUCTURE']);
      if (loaded.length > 0) break;
    }

    for (const sym of batch) {
      const so  = soMap[sym]  || {};
      const pac = pacMap[sym] || {};
      const osc = oscMap[sym] || {};
      allRows[sym] = {
        symbol:    sym,
        wtd:       metaMap[sym]?.wtd ?? null,
        sentiment: metaMap[sym]?.sentiment ?? null,
        watchers:  metaMap[sym]?.watchers ?? null,
        chatter:   metaMap[sym]?.chatter ?? null,
        theme:     metaMap[sym]?.theme ?? null,
        sub_group: metaMap[sym]?.sub_group ?? null,
        so,
        pac,
        osc,
        score: scoreSymbol(so, pac, osc),
      };
    }
  }

  // 5. Sort by score descending
  const sorted = Object.values(allRows).sort((a, b) => b.score - a.score);

  const topCandidates = sorted.slice(0, 10);
  const avoidList     = sorted.slice(-10).reverse();

  const topSection = topCandidates.length
    ? topCandidates.map(r => {
        const chatter = r.chatter ? ` | ⚠ ${r.chatter}` : '';
        return `- **${r.symbol}** — Score ${r.score} | ${r.so['RATING'] || '—'} | ${r.osc['DIVERGENCES'] || '—'} divergence | ${r.pac['STRUCTURE'] || '—'} | Squeeze ${r.so['SQUEEZE'] || '—'}${chatter}`;
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

  return {
    success: true,
    instrument_type,
    timeframe,
    symbol_count: sorted.length,
    batch_count: batches.length,
    table: isThematic ? buildThematicTable(sorted) : buildMarkdownTable(sorted),
    top_candidates: topCandidates.map(r => r.symbol),
    top_section: topSection,
    avoid_list: avoidList.map(r => r.symbol),
    avoid_section: avoidSection,
    chatter_section: chatterSection,
  };
}
