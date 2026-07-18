#!/usr/bin/env node
/**
 * Build thematic watchlist configs from the static CSV files.
 *
 * Reads:
 *   CSV/Watchlist_Stocks.csv → config/strategy-thematic_stocks.json
 *   CSV/Watchlist_ETFs.csv   → config/strategy-thematic_etfs.json
 *
 * Columns: Theme, Sub-group, Ticker, Name, Signal
 * All symbols are included regardless of Signal (Buy/Extended/Skip).
 *
 * Usage:
 *   node scripts/build-watchlist-configs.mjs [csvDir]
 *
 * Run whenever the CSV watchlists are updated. No restart needed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const ARK_LUX_INVALID_SYMBOLS = new Set([
  // Confirmed Lux-incompatible (crash or all-dashes)
  'ANSS', 'BLSH', 'CBRS', 'CRCL', 'CRWD', 'CRWV',
  'EXAS', 'LMT', 'OPENAI', 'PAGS', 'SPCX', 'XE',
  // OTC / foreign-primary / stale — Lux has no usable data
  'ADYEY',  // Euronext Amsterdam (ADYEN); no US ADR
  'BYDDY',  // OTC pink sheets BYD ADR
  'EVLO',   // OTC distressed/bankrupt
  'SPCE',   // Virgin Galactic rebranded to MNTN (Aug 2023); ticker stale
  // Recent IPOs / no Lux data — S&O Signal: Unavailable or full blank
  'BGNE',   // BeiGene — full blank (Chinese biotech, dual-listed)
  'CERS',   // No S&O data (small cap biotech)
  'DFS',    // Discover Financial — acquired by COF (May 2025), delisted
  'FIG',    // Figma IPO 2025; Signal: Unavailable
  'LC',     // LendingClub — full blank across all indicators
  'SPR',    // Spirit AeroSystems — full blank
  'TOST',   // Toast IPO too recent for weekly S&O signal
]);

const THEMATIC_ETF_LUX_INVALID_SYMBOLS = new Set([
  'AIPO',
  'BILT',
  'BSOL',
  'DRAM',
  'FSOL',
  'IDEF',
  'IVEP',
  'MARS',
  'RAM',
  'SPCI',
  'SSK',
  'UFOD',
  'UPTI',
]);

const THEMATIC_STOCK_LUX_INVALID_SYMBOLS = new Set([
  'CBRS',
  'CRCL',
  'CRWV',
  'SPCX',
]);

function parseCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const iTHEME   = headers.findIndex(h => h.toUpperCase() === 'THEME');
  const iSUBGROUP = headers.findIndex(h => h.toUpperCase() === 'SUB-GROUP');
  const iTICKER  = headers.findIndex(h => h.toUpperCase() === 'TICKER');
  const iNAME    = headers.findIndex(h => h.toUpperCase() === 'NAME');
  const iSIGNAL  = headers.findIndex(h => h.toUpperCase() === 'SIGNAL');

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim());
    const ticker = cells[iTICKER];
    if (!ticker) continue;
    rows.push({
      symbol:    ticker,
      name:      cells[iNAME] || '',
      theme:     cells[iTHEME] || '',
      sub_group: cells[iSUBGROUP] || '',
      signal:    cells[iSIGNAL] || '',
    });
  }
  return rows;
}

function writeConfig(relPath, patch) {
  const path = join(PROJECT_ROOT, relPath);
  let existing = {};
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  }
  const config = { ...existing, ...patch };
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return path;
}

function parseArkCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const iTICKER  = headers.findIndex(h => h.toUpperCase() === 'TICKER');
  const iNAME    = headers.findIndex(h => h.toUpperCase() === 'COMPANY');
  const iSECTOR  = headers.findIndex(h => h.toUpperCase() === 'SECTOR');
  const iWEIGHT  = headers.findIndex(h => h.toUpperCase().startsWith('COMBINED WEIGHT'));

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim());
    const ticker = cells[iTICKER];
    if (!ticker) continue;
    if (ARK_LUX_INVALID_SYMBOLS.has(ticker)) continue;
    rows.push({
      symbol:  ticker,
      name:    cells[iNAME]   || '',
      sector:  cells[iSECTOR] || '',
      weight:  cells[iWEIGHT] || '0.00%',
    });
  }
  return rows;
}

function main() {
  const csvDir = resolve(PROJECT_ROOT, process.argv[2] || 'CSV');
  const stocksCsv = join(csvDir, 'Watchlist_Stocks.csv');
  const etfsCsv   = join(csvDir, 'Watchlist_ETFs.csv');
  const arkCsv    = join(csvDir, 'Watchlist_ARK.csv');

  if (!existsSync(stocksCsv)) throw new Error('Missing: ' + stocksCsv);
  if (!existsSync(etfsCsv))   throw new Error('Missing: ' + etfsCsv);

  const stocksRows = parseCsv(stocksCsv).filter(r => !THEMATIC_STOCK_LUX_INVALID_SYMBOLS.has(r.symbol));
  const etfsRows   = parseCsv(etfsCsv).filter(r => !THEMATIC_ETF_LUX_INVALID_SYMBOLS.has(r.symbol));
  const arkRows    = existsSync(arkCsv) ? parseArkCsv(arkCsv) : null;
  const generated  = new Date().toISOString().slice(0, 10);

  // Group counts for console summary
  const groupBy = (rows, key) => rows.reduce((acc, r) => {
    acc[r[key]] = (acc[r[key]] || 0) + 1;
    return acc;
  }, {});

  const stocksOut = writeConfig('config/strategy-thematic_stocks.json', {
    instrument_type:    'thematic_stocks',
    watchlist_source:   stocksCsv,
    watchlist_generated: generated,
    invalid_symbols_excluded: [...THEMATIC_STOCK_LUX_INVALID_SYMBOLS].sort(),
    default_timeframe:  'D',
    screener_name:      null,
    max_symbols:        stocksRows.length,
    required_indicators: [
      'Trendlines with Breaks Oscillator [LuxAlgo]',
      'Nadaraya-Watson Envelope [LuxAlgo]',
      'Volume',
    ],
    market_context: {
      benchmark:           'SPY',
      benchmark_ma_type:   'SMA',
      benchmark_ma_period: 50,
      benchmark_filter:    'SPY must be above its 50-day SMA for any bullish bias. If below, treat as risk-off — only highest-conviction setups qualify.',
    },
    asset_notes: 'Thematic stock watchlist — 8 themes (AI semis, AI power/grid, Healthcare, Financials, Industrials/defense, Energy, Consumer def/discount, Space). Each symbol carries theme and sub_group for grouped analysis. Signal field from watchlist CSV is a starting context only — scan all regardless of signal. Chatter/momentum data not present; rely on TWB+NW+Volume.',
    watchlist: stocksRows,
  });

  // ETF strategy fields shared across full list and splits
  const etfStrategyFields = {
    watchlist_source:   etfsCsv,
    watchlist_generated: generated,
    invalid_symbols_excluded: [...THEMATIC_ETF_LUX_INVALID_SYMBOLS].sort(),
    default_timeframe:  'W',
    screener_name:      null,
    required_indicators: [
      'Trendlines with Breaks Oscillator [LuxAlgo]',
      'Nadaraya-Watson Envelope [LuxAlgo]',
      'Volume',
    ],
    market_context: {
      benchmark:           'SPY',
      benchmark_ma_type:   'SMA',
      benchmark_ma_period: 50,
      benchmark_filter:    'SPY must be above its 50-day SMA for broad ETF longs. If below, only inverse/defensive ETFs are candidates.',
    },
    bias_criteria: {
      bullish: [
        'ETF is printing higher highs and higher lows on the weekly',
        'TWB Histogram is positive and rising (momentum accelerating)',
        'Price approaching upper NW Envelope band but not extended outside it',
        'Volume is above average on up-weeks',
      ],
      bearish: [
        'ETF is printing lower highs and lower lows on the weekly',
        'TWB Histogram is negative and falling',
        'Price extended outside lower NW Envelope band',
      ],
      neutral: [
        'ETF is consolidating inside NW bands with no directional TWB signal',
        'Volume is below average — no rotational pressure visible',
      ],
    },
    entry_criteria: {
      long: [
        'Weekly consolidation after prior uptrend (flag or horizontal resistance breakout)',
        'TWB Histogram turns positive or crosses above Signal on weekly',
        'Volume expansion on breakout week',
        'Price moving toward upper NW band but not fully outside it',
      ],
    },
    exit_criteria: {
      stop_loss:      'Below prior weekly swing low. For thematic ETFs, wider stops are acceptable given weekly TF.',
      take_profit_1:  'Scale 1/3 out when price touches upper NW Envelope band on the weekly.',
      take_profit_2:  'Trail remaining via weekly 9 EMA.',
    },
    risk_rules: [
      'ETFs are diversified — use normal sizing (not reduced like individual names)',
      'Leveraged ETFs (SOXL, DFEN, FNGU, RAM): half-size and tighter stop due to decay',
      'Inverse/commodity ETFs (UNG, USO): verify sector thesis before entry',
      'No bullish entries if SPY is below its 50-day SMA',
    ],
    asset_notes: 'Thematic ETF watchlist — same 8 themes as stock watchlist, ETF vehicle for each theme. Weekly timeframe for macro rotation. Sub-group field identifies the ETF type (broad, alt-wt, lev, sector, geo). Signal field from watchlist CSV is starting context — scan all regardless. Group output by theme to see which themes have broad ETF strength vs. weakness.',
  };

  const etfsOut = writeConfig('config/strategy-thematic_etfs.json', { instrument_type: 'thematic_etfs', max_symbols: etfsRows.length, watchlist: etfsRows, ...etfStrategyFields });

  console.log(`\nthematic_stocks: ${stocksRows.length} symbols → ${stocksOut}`);
  const stockThemes = groupBy(stocksRows, 'theme');
  Object.entries(stockThemes).forEach(([t, n]) => console.log(`  ${n.toString().padStart(3)} — ${t}`));

  console.log(`\nthematic_etfs:   ${etfsRows.length} symbols → ${etfsOut}`);
  const etfThemes = groupBy(etfsRows, 'theme');
  Object.entries(etfThemes).forEach(([t, n]) => console.log(`  ${n.toString().padStart(3)} — ${t}`));

  if (arkRows) {
    const arkOut = writeConfig('config/strategy-momentum_ark.json', {
      watchlist_source:    arkCsv,
      watchlist_generated: generated,
      max_symbols:         arkRows.length,
      invalid_symbols_excluded: [...ARK_LUX_INVALID_SYMBOLS].sort(),
      pipeline:            `L1: static CSV watchlist (Watchlist_ARK.csv, ${arkRows.length} symbols after Lux invalid-symbol exclusions) -> L2: lux_screener_scan 1W (hard filter: BOS + Bullish/Strong Bullish S&O Rating + up/up+ Signal) -> L3: NW Envelope per-symbol check on weekly (price inside bands = base coiling, price above upper = extended/already moved)`,
      watchlist:           arkRows,
    });
    console.log(`\nmomentum_ark:    ${arkRows.length} symbols → ${arkOut}`);
    const arkSectors = groupBy(arkRows, 'sector');
    Object.entries(arkSectors).forEach(([t, n]) => console.log(`  ${n.toString().padStart(3)} — ${t}`));
  } else {
    console.log('\nmomentum_ark:    (Watchlist_ARK.csv not found — skipped)');
  }

  console.log('\nDone. (No restart needed — only config files changed.)');
}

main();
