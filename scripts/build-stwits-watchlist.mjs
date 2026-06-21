#!/usr/bin/env node
/**
 * Build the StockTwits momentum watchlists from the latest weekly report.
 *
 * Reads the newest `Stocktwits-Top-*-Week-NN.md` in the StockTwits Reports
 * directory, parses the momentum table, splits rows into two buckets by index
 * membership, ranks each by weekly performance (WTD), and writes the result into
 * the `watchlist` arrays of the two strategy files — preserving everything else
 * (bias/entry/exit/risk config).
 *
 *   stwits_lg  ← rows carrying an S&P 500 or Nasdaq 100 rank   (benchmark SPY)
 *   stwits_sm  ← rows carrying a Russell 2000 rank only        (benchmark IWM)
 *
 * Usage:
 *   node scripts/build-stwits-watchlist.mjs [reportsDir] [reportFile]
 *
 *   reportsDir   optional — defaults to C:/work/StockTwits/Reports
 *   reportFile   optional — a specific .md to use instead of auto-picking newest
 *
 * Run weekly (Saturdays) after the new report is generated.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const DEFAULT_REPORTS_DIR = 'C:/work/StockTwits/Reports';
const FILE_RE = /^Stocktwits-Top-.*Week-(\d+)\.md$/i;

function pickLatestReport(dir) {
  const files = readdirSync(dir).filter(f => FILE_RE.test(f));
  if (files.length === 0) {
    throw new Error(`No Stocktwits-Top-*-Week-NN.md files found in ${dir}`);
  }
  // Rank by week number (primary), then mtime (tiebreak) — newest wins.
  files.sort((a, b) => {
    const wa = parseInt(a.match(FILE_RE)[1], 10);
    const wb = parseInt(b.match(FILE_RE)[1], 10);
    if (wb !== wa) return wb - wa;
    return statSync(join(dir, b)).mtimeMs - statSync(join(dir, a)).mtimeMs;
  });
  return join(dir, files[0]);
}

// Parse a "$1.1K" / "$746.23" price string into a number (K = thousands).
function parsePrice(s) {
  const m = (s || '').replace(/[$,]/g, '').trim().match(/^([\d.]+)\s*([kKmM]?)$/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (/k/i.test(m[2])) v *= 1000;
  if (/m/i.test(m[2])) v *= 1_000_000;
  return v;
}

function parseReport(text) {
  const headerLine = text.split('\n').find(l => l.startsWith('#')) || '';
  const header = headerLine.replace(/^#+\s*/, '').trim();

  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    // cells[0] and last are empty (leading/trailing pipe). Data row → cells[1] is a date.
    if (!/^\d{2}-\d{2}-\d{4}$/.test(cells[1] || '')) continue;

    const ticker = cells[2];
    if (!ticker) continue;
    const wtd = parseFloat((cells[6] || '').replace(/[%+]/g, ''));
    const sentiment = parseInt((cells[8] || '').replace(/[^\d]/g, ''), 10);
    const watchers = (cells[9] || '').trim() || '—';
    const sp = (cells[10] || '').trim();
    const ndx = (cells[11] || '').trim();
    const rut = (cells[12] || '').trim();

    rows.push({
      symbol: ticker,
      wtd: Number.isFinite(wtd) ? wtd : null,
      sentiment: Number.isFinite(sentiment) ? sentiment : null,
      watchers,
      price: parsePrice(cells[5]),
      isLarge: sp !== '' || ndx !== '',
      isRussell: rut !== '',
    });
  }
  return { header, rows };
}

// Dedupe by symbol keeping the best (highest) WTD, then sort WTD desc.
function bucketize(rows, predicate) {
  const best = new Map();
  for (const r of rows) {
    if (!predicate(r)) continue;
    const prev = best.get(r.symbol);
    if (!prev || (r.wtd ?? -Infinity) > (prev.wtd ?? -Infinity)) best.set(r.symbol, r);
  }
  return [...best.values()]
    .sort((a, b) => (b.wtd ?? -Infinity) - (a.wtd ?? -Infinity))
    .map(r => ({ symbol: r.symbol, wtd: r.wtd, sentiment: r.sentiment, watchers: r.watchers }));
}

function updateStrategyFile(relPath, watchlist, sourceNote) {
  const path = join(PROJECT_ROOT, relPath);
  const strategy = JSON.parse(readFileSync(path, 'utf8'));
  strategy.watchlist = watchlist;
  strategy.watchlist_source = sourceNote;
  strategy.watchlist_generated = new Date().toISOString();
  writeFileSync(path, JSON.stringify(strategy, null, 2) + '\n', 'utf8');
  return path;
}

function main() {
  const reportsDir = process.argv[2] || DEFAULT_REPORTS_DIR;
  const reportPath = process.argv[3]
    ? resolve(process.argv[3])
    : pickLatestReport(reportsDir);

  console.log(`Source report: ${reportPath}`);
  const { header, rows } = parseReport(readFileSync(reportPath, 'utf8'));
  console.log(`Header: ${header}`);
  console.log(`Parsed ${rows.length} data rows.`);

  const lg = bucketize(rows, r => r.isLarge);
  const sm = bucketize(rows, r => !r.isLarge && r.isRussell);

  const lgSource = `${reportPath} — ${header} — rows with an S&P 500 or Nasdaq 100 rank`;
  const smSource = `${reportPath} — ${header} — rows with a Russell 2000 rank only`;

  const lgPath = updateStrategyFile('config/strategy-stwits_lg.json', lg, lgSource);
  const smPath = updateStrategyFile('config/strategy-stwits_sm.json', sm, smSource);

  console.log(`\nstwits_lg: ${lg.length} names → ${lgPath}`);
  console.log(`  ${lg.slice(0, 10).map(e => e.symbol).join(', ')}${lg.length > 10 ? ', …' : ''}`);
  console.log(`stwits_sm: ${sm.length} names → ${smPath}`);
  console.log(`  ${sm.slice(0, 10).map(e => e.symbol).join(', ')}${sm.length > 10 ? ', …' : ''}`);
  console.log('\nDone. (No restart needed — only the watchlist data changed.)');
}

main();
