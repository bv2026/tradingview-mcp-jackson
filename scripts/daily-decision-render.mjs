#!/usr/bin/env node
/**
 * Renders decision-email-routine's 3 daily emails (crypto / crypto_perps / futures) from a small
 * structured JSON the LLM writes describing its trade decisions, instead of the LLM hand-typing
 * full HTML tables every day. Two problems this fixes at once:
 *   1. Token/runtime cost — composing repeated <tr>/<td> boilerplate by hand, in full, every
 *      single day, is exactly the anti-pattern weekly-decision-routine had before it adopted
 *      decision-render.mjs. This script is that same fix applied to the daily routine.
 *   2. The Gmail background-CSS bug (confirmed 2026-08-15) — Gmail's send pipeline strips
 *      <style> blocks, class attributes, and any inline style="...background..." — so this
 *      emits plain legacy attributes (border/cellpadding/bgcolor) instead, matching
 *      decision-render.mjs's verified-working pattern.
 *
 * The LLM keeps all the actual trading judgment (bias/entry/exit reasoning per
 * strategy-<type>.json) — this script only mechanizes the formatting step, same division of
 * labor as decision-classify.mjs (mechanical) vs the narrative sections weekly-decision-routine
 * still writes by hand (Overall Market Read, cross-market posture).
 *
 * Input JSON schema — {
 *   "title": "Crypto Decision Brief",
 *   "subtitle": "TV only · Coinbase spot · Each symbol evaluated independently",
 *   "top_setups": [
 *     { "symbol": "BTC-USD", "side": "Long", "entry": "...", "stop": "...", "tp1": "...",
 *       "tp2": "...", "notes": "..." }
 *   ],
 *   "watch_list": [
 *     { "symbol": "ETH-USD", "bias": "bearish", "col2": "...", "col3": "..." }
 *   ],
 *   "watch_list_columns": ["Symbol", "NW Position", "Note"],
 *   "overall_read": ["bullet 1", "bullet 2"],
 *   "all_symbols": [
 *     { "symbol": "BTC-USD", "bias": "bullish", "col2": "...", "col3": "...", "col4": "...", "col5": "..." }
 *   ],
 *   "all_symbols_columns": ["Symbol", "TWB Gap", "NW Position", "S/R Break", "Bias", "Watch"]
 * }
 * `side` (case-insensitive "long"/"short") drives top_setups row color: long = green #e8f5e9,
 * short = red #fdecea. `bias` (case-insensitive "bullish"/"bearish") drives watch_list and
 * all_symbols row color the same way — this is separate from whatever text ends up in the
 * visible columns (col2..colN), so a column can still say "bullish"/"bearish"/"neutral" as plain
 * text while `bias` (not rendered directly) controls the shading. Neither field is required;
 * omitting `bias` leaves a row uncolored. Futures uses a "market" key in place of "symbol" —
 * both are accepted in top_setups; watch_list/all_symbols always use "symbol". `overall_read`
 * stays a flat array of strings, rendered as an uncolored single-column table (it's cross-market
 * prose commentary, not per-symbol data, so there's nothing to color-code).
 *
 * Usage:
 *   node daily-decision-render.mjs <decisionsJsonFile> <htmlOut> <dateStr>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , DECISIONS_FILE, HTML_OUT, DATE_STR] = process.argv;
if (!DECISIONS_FILE || !HTML_OUT || !DATE_STR) {
  console.error('Usage: node daily-decision-render.mjs <decisionsJsonFile> <htmlOut> <dateStr>');
  process.exit(1);
}

const TABLE_OPEN = '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px">';
const HEADER_TR = '<tr bgcolor="#f5f5f5">';

function sideRowTr(side) {
  const s = (side || '').toLowerCase();
  if (s === 'long') return '<tr bgcolor="#e8f5e9">';
  if (s === 'short') return '<tr bgcolor="#fdecea">';
  return '<tr>';
}

function biasRowTr(bias) {
  const b = (bias || '').toLowerCase();
  if (b === 'bullish') return '<tr bgcolor="#e8f5e9">';
  if (b === 'bearish') return '<tr bgcolor="#fdecea">';
  return '<tr>';
}

const esc = (v) => (v == null || v === '' ? '—' : String(v));

function topSetupsTable(rows, hasTp2) {
  if (!rows?.length) return '<p><em>No actionable setups this cycle.</em></p>';
  const cols = ['Symbol/Market', 'Side', 'Entry', 'Stop', hasTp2 ? 'TP1/TP2' : 'TP1', 'Notes'];
  let out = `${TABLE_OPEN}${HEADER_TR}${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
  for (const r of rows) {
    const symbol = r.symbol ?? r.market;
    const tp = hasTp2 ? [r.tp1, r.tp2].filter(Boolean).join(' / ') : r.tp1;
    out += `${sideRowTr(r.side)}<td><strong>${esc(symbol)}</strong></td><td>${esc(r.side)}</td><td>${esc(r.entry)}</td><td>${esc(r.stop)}</td><td>${esc(tp)}</td><td>${esc(r.notes)}</td></tr>`;
  }
  out += '</table>';
  return out;
}

function biasColoredTable(rows, columns, emptyMessage) {
  if (!rows?.length || !columns?.length) return emptyMessage ? `<p><em>${emptyMessage}</em></p>` : '';
  const keys = ['symbol', ...Array.from({ length: columns.length - 1 }, (_, i) => `col${i + 2}`)];
  let out = `${TABLE_OPEN}${HEADER_TR}${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;
  for (const r of rows) {
    out += biasRowTr(r.bias) + keys.map(k => `<td>${esc(r[k])}</td>`).join('') + '</tr>';
  }
  out += '</table>';
  return out;
}

function overallReadHtml(items) {
  if (!items?.length) return '';
  const rows = items.map(i => `<tr><td>${esc(i)}</td></tr>`).join('');
  return `${TABLE_OPEN}${HEADER_TR}<th>Observation</th></tr>${rows}</table>`;
}

const d = JSON.parse(readFileSync(DECISIONS_FILE, 'utf8'));
const hasTp2 = (d.top_setups || []).some(r => r.tp2);

const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:800px">
<h1>${esc(d.title)} — ${DATE_STR}</h1>
<p style="font-size:12px;color:#666">${esc(d.subtitle)}</p>
<h2>Trade Decisions</h2>
${topSetupsTable(d.top_setups, hasTp2)}
<h2>Watch List</h2>
${biasColoredTable(d.watch_list, d.watch_list_columns, 'No watch-list items this cycle.')}
<h2>Overall Read</h2>
${overallReadHtml(d.overall_read)}
<h2>${d.all_symbols_heading || 'All Symbols Scanned'}</h2>
${biasColoredTable(d.all_symbols, d.all_symbols_columns)}
</div>`;

writeFileSync(HTML_OUT, html);
console.log(`daily-decision-render: rendered ${HTML_OUT} (${html.length} bytes, ${d.top_setups?.length ?? 0} top setups, ${d.all_symbols?.length ?? 0} symbols)`);
