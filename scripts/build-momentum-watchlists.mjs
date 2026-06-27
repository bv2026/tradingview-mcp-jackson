#!/usr/bin/env node
/**
 * Build the momentum watchlists from the latest weekly StockTwits CSVs.
 *
 * Reads the newest dated CSVs from the CSV/ directory:
 *   momentum-sp500-{date}.csv     → }
 *   momentum-nasdaq100-{date}.csv → } combined → config/strategy-sp_ndx.json
 *   momentum-russell2000-{date}.csv →            config/strategy-r2k.json
 *   market-chatter-{date}-1.csv   → optional chatter annotations on all symbols
 *
 * Only IN-status rows are included. S&P + Nasdaq are deduplicated (S&P rank
 * takes priority). Each symbol gets wtd, sentiment, watchers, and an optional
 * chatter field (e.g. "Overheated", "Oversold", "Loudest") from the chatter CSV.
 *
 * Usage:
 *   node scripts/build-momentum-watchlists.mjs [csvDir]
 *
 *   csvDir  optional — defaults to CSV/ relative to project root
 *
 * Run weekly (Fridays or Saturdays) after dropping new CSVs.
 * No restart needed — only config files are changed.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function pickLatest(csvDir, prefix) {
  const re = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2}).*\\.csv$`, 'i');
  const files = readdirSync(csvDir).filter(f => re.test(f));
  if (files.length === 0) return null;
  files.sort((a, b) => {
    const da = a.match(re)[1];
    const db = b.match(re)[1];
    return db.localeCompare(da);
  });
  return join(csvDir, files[0]);
}

function parseWtd(s) {
  const v = parseFloat((s || '').replace(/[%+\s]/g, ''));
  return Number.isFinite(v) ? v : null;
}

function parseSentiment(s) {
  const v = parseInt((s || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(v) ? v : null;
}

function parseWatchers(s) {
  const v = (s || '').trim();
  return v === '' || v === '-' ? null : v;
}

/**
 * Parse a momentum CSV (sp500 / nasdaq100 / russell2000).
 * Returns rows with status, rank, ticker, wtd, sentiment, watchers.
 */
function parseMomentumCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toUpperCase());

  const idx = name => headers.indexOf(name);
  const iSTATUS = idx('STATUS');
  const iTICKER = idx('TICKER');
  const iRANK   = idx('#');
  const iWTD    = idx('WTD');
  const iSENT   = idx('SENTIMENT');
  const iWATCH  = idx('WATCHERS');

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim());
    if (!cells[iSTATUS]) continue;
    if (cells[iSTATUS].toUpperCase() !== 'IN') continue;
    const ticker = cells[iTICKER];
    if (!ticker) continue;
    rows.push({
      rank:      parseInt(cells[iRANK], 10) || 999,
      symbol:    ticker,
      wtd:       parseWtd(cells[iWTD]),
      sentiment: parseSentiment(cells[iSENT]),
      watchers:  parseWatchers(cells[iWATCH]),
    });
  }
  return rows;
}

/**
 * Parse market-chatter CSV.
 * Returns a Map<ticker, section> where section is the most notable label.
 * Priority: Overheated > Oversold > Loudest > Quietest.
 */
function parseChatterCsv(path) {
  if (!path || !existsSync(path)) return new Map();

  const PRIORITY = { Overheated: 4, Oversold: 3, Loudest: 2, Quietest: 1 };
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
  const iSECT   = headers.indexOf('SECTION');
  const iTICKER = headers.indexOf('TICKER');

  const map = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim());
    const section = cells[iSECT];
    const ticker  = cells[iTICKER];
    if (!section || !ticker) continue;
    const prev = map.get(ticker);
    const prevPrio = prev ? (PRIORITY[prev] || 0) : 0;
    const thisPrio = PRIORITY[section] || 0;
    if (thisPrio > prevPrio) map.set(ticker, section);
  }
  return map;
}

/**
 * Combine two ranked lists, deduplicating by symbol.
 * primary list takes priority; secondary symbols appended in their rank order.
 */
function combineLists(primary, secondary) {
  const seen = new Set(primary.map(r => r.symbol));
  const extra = secondary.filter(r => !seen.has(r.symbol));
  return [...primary, ...extra];
}

function buildEntry(row, chatterMap) {
  const entry = {
    symbol:    row.symbol,
    wtd:       row.wtd,
    sentiment: row.sentiment,
    watchers:  row.watchers,
  };
  const chatter = chatterMap.get(row.symbol);
  if (chatter) entry.chatter = chatter;
  return entry;
}

function writeConfig(relPath, watchlist, source, generated) {
  const path = join(PROJECT_ROOT, relPath);
  let existing = {};
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  }
  const config = {
    ...existing,
    watchlist_source: source,
    watchlist_generated: generated,
    watchlist,
  };
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return path;
}

function main() {
  const csvDir = resolve(PROJECT_ROOT, process.argv[2] || 'CSV');

  const sp500Path   = pickLatest(csvDir, 'momentum-sp500');
  const ndxPath     = pickLatest(csvDir, 'momentum-nasdaq100');
  const r2kPath     = pickLatest(csvDir, 'momentum-russell2000');
  const chatterPath = pickLatest(csvDir, 'market-chatter');

  if (!sp500Path)   throw new Error('No momentum-sp500-*.csv found in ' + csvDir);
  if (!ndxPath)     throw new Error('No momentum-nasdaq100-*.csv found in ' + csvDir);
  if (!r2kPath)     throw new Error('No momentum-russell2000-*.csv found in ' + csvDir);

  console.log(`S&P 500:    ${sp500Path}`);
  console.log(`Nasdaq 100: ${ndxPath}`);
  console.log(`Russell 2K: ${r2kPath}`);
  console.log(`Chatter:    ${chatterPath || '(none found — skipping annotations)'}`);

  const sp500Rows   = parseMomentumCsv(sp500Path);
  const ndxRows     = parseMomentumCsv(ndxPath);
  const r2kRows     = parseMomentumCsv(r2kPath);
  const chatterMap  = parseChatterCsv(chatterPath);

  // sp_ndx: S&P IN symbols first (rank order), then NDX-only symbols
  const spNdxRows = combineLists(sp500Rows, ndxRows);
  const spNdxWl   = spNdxRows.map(r => buildEntry(r, chatterMap));
  const r2kWl     = r2kRows.map(r => buildEntry(r, chatterMap));

  const generated = new Date().toISOString().slice(0, 10);
  const spNdxSource = `${sp500Path} + ${ndxPath} — IN symbols, S&P rank priority`;
  const r2kSource   = `${r2kPath} — IN symbols`;

  const spNdxOut = writeConfig('config/strategy-sp_ndx.json', spNdxWl, spNdxSource, generated);
  const r2kOut   = writeConfig('config/strategy-r2k.json',   r2kWl,   r2kSource,   generated);

  console.log(`\nsp_ndx: ${spNdxWl.length} symbols → ${spNdxOut}`);
  console.log(`  ${spNdxWl.slice(0, 10).map(e => e.symbol).join(', ')}${spNdxWl.length > 10 ? ', …' : ''}`);

  const overheated = spNdxWl.filter(e => e.chatter === 'Overheated').map(e => e.symbol);
  const oversold   = spNdxWl.filter(e => e.chatter === 'Oversold').map(e => e.symbol);
  if (overheated.length) console.log(`  ⚠ Overheated: ${overheated.join(', ')}`);
  if (oversold.length)   console.log(`  ⚠ Oversold:   ${oversold.join(', ')}`);

  console.log(`\nr2k:    ${r2kWl.length} symbols → ${r2kOut}`);
  console.log(`  ${r2kWl.slice(0, 10).map(e => e.symbol).join(', ')}${r2kWl.length > 10 ? ', …' : ''}`);

  const r2kOverheated = r2kWl.filter(e => e.chatter === 'Overheated').map(e => e.symbol);
  const r2kOversold   = r2kWl.filter(e => e.chatter === 'Oversold').map(e => e.symbol);
  if (r2kOverheated.length) console.log(`  ⚠ Overheated: ${r2kOverheated.join(', ')}`);
  if (r2kOversold.length)   console.log(`  ⚠ Oversold:   ${r2kOversold.join(', ')}`);

  console.log('\nDone. (No restart needed — only watchlist data changed.)');
}

main();
