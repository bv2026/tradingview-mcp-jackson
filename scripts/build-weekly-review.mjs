#!/usr/bin/env node
/**
 * Build the weekly review DATA bundle from a week of daily briefs.
 *
 * Consolidates Mon–Fri across all instruments using two sources already saved
 * by the daily workflow:
 *   - Raw scans:  ~/.tradingview-mcp/sessions/{YYYY-MM-DD}-{type}.json
 *                 → per-symbol TWB Histogram/Signal + close + fresh flag
 *   - Briefs:     reports/{YYYY-Mon-DD}/{type}.md
 *                 → per-symbol BIAS decision (the | SYMBOL | BIAS | ... | table)
 *
 * For each instrument it computes, per symbol:
 *   - days_seen        how many days the symbol was scanned
 *   - long_days        how many days it was given a long bias
 *   - accel_seq        Mon→Fri sequence of TWB acceleration (hist>sig): + / - / .
 *   - first/last close + pct_move  (the week's actual follow-through)
 *
 * Writes reports/weekly/{YYYY-Www}-data.json and prints a summary. Claude then
 * reads the bundle and writes the narrative reports/weekly/{YYYY-Www}.md.
 *
 * Usage:
 *   node scripts/build-weekly-review.mjs [weekEndingDate]
 *   weekEndingDate  optional YYYY-MM-DD; defaults to the most recent Friday.
 *
 * Run Saturdays (before the StockTwits watchlist rebuild).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const SESSIONS_DIR = join(homedir(), '.tradingview-mcp', 'sessions');
const REPORTS_DIR = join(PROJECT_ROOT, 'reports');
const WEEKLY_DIR = join(REPORTS_DIR, 'weekly');

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const INSTRUMENTS = ['stocks', 'etf', 'ark', 'crypto', 'crypto_perps', 'futures'];

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const folderName = (d) => `${d.getFullYear()}-${MONTHS[d.getMonth()]}-${pad(d.getDate())}`;

// Canonical symbol key for joining scan JSON ↔ brief .md across instruments.
// Strips exchange prefix, a trailing "(…)" label, a perp suffix, and the quote
// currency so e.g. COINBASE:BTCUSD, BTCUSDC.P, and a bare "BTC" all collapse to
// BTC, and "ES1! (S&P)" collapses to ES1!.
function canon(sym) {
  let s = (sym || '').split(':').pop().trim().toUpperCase();
  s = s.replace(/\s*\(.*\)\s*$/, '');     // drop "(S&P)" style label
  s = s.split(/\s+/)[0] || s;             // first token only
  s = s.replace(/\.(P|PERP)$/, '');       // perp suffix
  s = s.replace(/(USDC|USDT|USD|EUR)$/, ''); // quote currency
  return s;
}

// Classify the bias cell into a directional posture, per instrument vocabulary.
// stocks/etf/futures use Long/Short/Neutral; ark uses STATUS
// (BREAKOUT_READY / BASE / EXTENDED / SKIP); crypto spot says "Bearish" = stand
// aside (neutral, long-only), while perps say "Short" = a real short posture.
function classifyBias(type, cell) {
  const b = (cell || '').replace(/[*`]/g, '').toLowerCase();
  if (!b) return null;
  if (type === 'ark') {
    if (/skip|avoid/.test(b)) return 'neutral';
    if (/breakout|base|extended|ready/.test(b)) return 'long';
    return 'neutral';
  }
  if (/\bskip\b/.test(b)) return 'skip';
  if (/\bshort\b/.test(b)) return 'short';
  if (/\blong\b/.test(b)) return 'long';
  if (/\bwatch\b/.test(b)) return 'watch';
  return 'neutral'; // includes spot-crypto "Bearish" = stand aside
}

// ISO 8601 week number.
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return { year: t.getUTCFullYear(), week };
}

// Most recent Friday on or before the reference date.
function lastFriday(ref) {
  const d = new Date(ref);
  while (d.getDay() !== 5) d.setDate(d.getDate() - 1);
  return d;
}

// Mon–Fri date objects for the week containing the given Friday.
function weekDays(friday) {
  const days = [];
  for (let i = 4; i >= 0; i--) {
    const d = new Date(friday);
    d.setDate(friday.getDate() - i);
    days.push(d);
  }
  return days; // Mon..Fri
}

const num = (x) => {
  if (x == null) return null;
  const v = parseFloat(String(x).replace(/[, ]/g, ''));
  return Number.isFinite(v) ? v : null;
};

// Pull symbol → {close, hist, sig, accel, fresh} from a daily scan JSON.
function readScan(date, type) {
  const path = join(SESSIONS_DIR, `${isoDate(date)}-${type}.json`);
  if (!existsSync(path)) return null;
  let data;
  try { data = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  const out = {};
  for (const r of data.symbols_scanned || []) {
    const studies = (r.indicators && r.indicators.studies) || [];
    const twb = studies.find((s) => /trendlines with breaks/i.test(s.name || ''));
    const hist = twb ? num(twb.values && twb.values.Histogram) : null;
    const sig = twb ? num(twb.values && twb.values.Signal) : null;
    const accel = hist != null && sig != null ? (hist > sig ? '+' : '-') : '.';
    out[canon(r.symbol)] = { close: num(r.quote && r.quote.close), hist, sig, accel, fresh: !!r.fresh };
  }
  return out;
}

// Pull symbol → bias ('long'|'short'|'neutral'|'watch'|'skip') from a daily brief .md.
function readBias(date, type) {
  const path = join(REPORTS_DIR, folderName(date), `${type}.md`);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // data row: cells[1]=symbol cell, cells[2]=bias/status cell
    const raw = (cells[1] || '').replace(/[*`]/g, '').trim();
    const m = raw.match(/^([A-Z0-9][A-Z0-9.!\-]*)/i); // leading ticker token (ES1!, BTC, ARM)
    if (!m || m[1].toUpperCase() === 'SYMBOL') continue;
    const bias = classifyBias(type, cells[2]);
    if (!bias) continue;
    out[canon(m[1])] = bias;
  }
  return out;
}

function buildInstrument(type, days) {
  const agg = {};       // symbol → record
  const daysWithData = [];
  for (const d of days) {
    const scan = readScan(d, type);
    const bias = readBias(d, type);
    if (!scan && !bias) continue;
    daysWithData.push(folderName(d));
    const syms = new Set([...Object.keys(scan || {}), ...Object.keys(bias || {})]);
    for (const sym of syms) {
      const rec = (agg[sym] ||= { symbol: sym, days_seen: 0, long_days: 0, short_days: 0, accel_seq: [], closes: [] });
      rec.days_seen++;
      if (bias && bias[sym] === 'long') rec.long_days++;
      if (bias && bias[sym] === 'short') rec.short_days++;
      rec.accel_seq.push(scan && scan[sym] ? scan[sym].accel : '.');
      if (scan && scan[sym] && scan[sym].close != null) rec.closes.push(scan[sym].close);
    }
  }
  const rows = Object.values(agg).map((r) => {
    const first = r.closes[0] ?? null;
    const last = r.closes[r.closes.length - 1] ?? null;
    const pct = first && last ? +(((last - first) / first) * 100).toFixed(2) : null;
    const seq = r.accel_seq.join('');
    const accel_pos = r.accel_seq.filter((c) => c === '+').length;
    const accel_neg = r.accel_seq.filter((c) => c === '-').length;
    // Directional posture: which side the brief leaned, with a tie broken by TWB.
    const side = r.long_days > r.short_days ? 'long'
      : r.short_days > r.long_days ? 'short'
      : accel_pos >= accel_neg ? 'long' : 'short';
    const conviction = Math.max(r.long_days, r.short_days);
    return {
      symbol: r.symbol,
      side,
      days_seen: r.days_seen,
      long_days: r.long_days,
      short_days: r.short_days,
      conviction,
      accel_seq: seq,
      accel_pos,
      accel_neg,
      first_close: first,
      last_close: last,
      pct_move: pct,
    };
  });
  // Conviction sort: most days flagged a side, then directional TWB persistence,
  // then largest move in the posture's favour.
  rows.sort((a, b) =>
    b.conviction - a.conviction ||
    (b.side === 'short' ? b.accel_neg : b.accel_pos) - (a.side === 'short' ? a.accel_neg : a.accel_pos) ||
    Math.abs(b.pct_move ?? 0) - Math.abs(a.pct_move ?? 0));
  return { type, days_with_data: daysWithData, symbol_count: rows.length, symbols: rows };
}

// Parse YYYY-MM-DD as a LOCAL date (avoid UTC-midnight shifting the weekday).
function parseLocal(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(s);
}

function main() {
  const ref = process.argv[2] ? parseLocal(process.argv[2]) : new Date();
  const friday = lastFriday(ref);
  const days = weekDays(friday);
  const { year, week } = isoWeek(friday);
  const tag = `${year}-W${pad(week)}`;

  const bundle = {
    week: tag,
    week_ending: isoDate(friday),
    window: { start: isoDate(days[0]), end: isoDate(days[4]) },
    generated_at: new Date().toISOString(),
    instruments: INSTRUMENTS.map((t) => buildInstrument(t, days)),
  };

  mkdirSync(WEEKLY_DIR, { recursive: true });
  const dataPath = join(WEEKLY_DIR, `${tag}-data.json`);
  writeFileSync(dataPath, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  console.log(`Week ${tag}  (${bundle.window.start} → ${bundle.window.end}, ending ${bundle.week_ending})`);
  console.log(`Data bundle: ${dataPath}\n`);
  for (const inst of bundle.instruments) {
    if (!inst.symbol_count) { console.log(`${inst.type}: (no data)`); continue; }
    const top = inst.symbols.slice(0, 5)
      .map((s) => `${s.symbol}[${s.side[0].toUpperCase()}${s.conviction} ${s.accel_seq} ${s.pct_move != null ? s.pct_move + '%' : '—'}]`)
      .join('  ');
    console.log(`${inst.type}: ${inst.symbol_count} names, ${inst.days_with_data.length} days`);
    console.log(`  ${top}`);
  }
  console.log(`\nNext: Claude reads ${tag}-data.json and writes reports/weekly/${tag}.md`);
}

main();
