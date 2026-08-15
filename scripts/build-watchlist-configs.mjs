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
  // Confirmed Signal: Unavailable + NaN Trend Strength — S&O oscillator cannot compute.
  // Identified via full 149-symbol lux_screener_scan on 2026-08-15.
  'ALMR',  // Alamar Biosciences — IPO too recent / illiquid
  'BLSH',  // Bullish — private-ish / insufficient weekly history
  'CRWV',  // CoreWeave — IPO Mar 2025, Signal: Unavailable
  'ETOR',  // eToro — IPO 2025, Signal: Unavailable + NaN
  'FIG',   // Figma — IPO 2025, Signal: Unavailable
  'HONA',  // Honeywell Aerospace spinoff — insufficient weekly history
  'KLAR',  // Klarna — IPO 2025, Signal: Unavailable
  'PAYP',  // PayPay Corp ADR — illiquid ADR
  'SCTX',  // Scribe Therapeutics — no public listing history
  'SECZ',  // Securitize — illiquid / no exchange listing
  'SPCX',  // SpaceX — private company, Signal: Unavailable + NaN
  'XE',    // X-Energy — SPAC / thinly traded
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

function splitCsvLine(line) {
  const cells = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur.trim());
  return cells;
}

function parseArkCsv(path) {
  // Watchlist_ARK-1.csv: Symbol,Description,Sector,Industry,Allocation_Pct
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const hdrs  = lines[0].split(',').map(h => h.trim().toLowerCase());
  const iSym    = hdrs.findIndex(h => h === 'symbol' || h === 'ticker');
  const iName   = hdrs.findIndex(h => h === 'description' || h === 'company');
  const iSector = hdrs.findIndex(h => h === 'sector');
  const iWeight = hdrs.findIndex(h => h === 'allocation_pct' || h.startsWith('combined weight'));

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const ticker = cells[iSym];
    if (!ticker) continue;
    if (ARK_LUX_INVALID_SYMBOLS.has(ticker)) continue;
    rows.push({
      symbol: ticker,
      name:   (iName   >= 0 ? cells[iName]   : '') || '',
      sector: (iSector >= 0 ? cells[iSector] : '') || '',
      weight: (iWeight >= 0 ? cells[iWeight] : '') || '0.00%',
    });
  }
  return rows;
}

/**
 * Parse CSV/CRYPTO.csv (TradingView Crypto Coins Screener export).
 * Instrument column = bare base ticker (BTC, ETH, …).
 * Returns every CSV row as a COINBASE:{BASE}USD symbol string.
 * The CSV is the source of truth; no runtime blocklist is applied here.
 */
function parseCryptoCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const iINSTRUMENT = headers.findIndex(h => h.toUpperCase() === 'INSTRUMENT');
  if (iINSTRUMENT < 0) throw new Error(`CRYPTO.csv missing "Instrument" column`);

  const symbols = [];
  for (const line of lines.slice(1)) {
    const base = line.split(',')[iINSTRUMENT]?.trim();
    if (!base) continue;
    symbols.push(`COINBASE:${base}USD`);
  }
  return symbols;
}

/**
 * Parse CSV/PERPS.csv (TradingView CEX Screener export).
 * Symbol column = raw perp ticker (BTCUSDC.P, ETHUSDC.P, …).
 * Returns every CSV row as a COINBASE:{SYMBOL} string.
 * The CSV is the source of truth; no runtime blocklist is applied here.
 */
/**
 * Parse CSV/FUTURES.csv. Symbol column already has full exchange prefix (e.g. CME_MINI:ES1!).
 * Returns array of { symbol, sector, description }.
 */
function parseFuturesCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
  const iSYMBOL = headers.findIndex(h => h === 'SYMBOL');
  const iSECTOR = headers.findIndex(h => h === 'SECTOR');
  const iDESC   = headers.findIndex(h => h === 'DESCRIPTION');
  if (iSYMBOL < 0) throw new Error(`FUTURES.csv missing "Symbol" column`);

  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',').map(c => c.trim());
    const symbol = cells[iSYMBOL];
    if (!symbol) continue;
    rows.push({
      symbol,
      sector:      iSECTOR >= 0 ? cells[iSECTOR] || '' : '',
      description: iDESC   >= 0 ? cells[iDESC]   || '' : '',
    });
  }
  return rows;
}

function parsePerpsCsv(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const iSYMBOL = headers.findIndex(h => h.toUpperCase() === 'SYMBOL');
  if (iSYMBOL < 0) throw new Error(`PERPS.csv missing "Symbol" column`);

  const symbols = [];
  for (const line of lines.slice(1)) {
    const symbol = line.split(',')[iSYMBOL]?.trim();
    if (!symbol) continue;
    // If already has exchange prefix (e.g. Binance:SUIUSDC.P), use as-is
    symbols.push(symbol.includes(':') ? symbol : `COINBASE:${symbol}`);
  }
  return symbols;
}

function main() {
  const csvDir = resolve(PROJECT_ROOT, process.argv[2] || 'CSV');
  const stocksCsv = join(csvDir, 'Watchlist_Stocks.csv');
  const etfsCsv   = join(csvDir, 'Watchlist_ETFs.csv');
  const arkCsv    = join(csvDir, 'Watchlist_ARK-1.csv');
  const arkMetaCsv = join(csvDir, 'ARK Consolidated Watchlist - US.csv');

  if (!existsSync(stocksCsv)) throw new Error('Missing: ' + stocksCsv);
  if (!existsSync(etfsCsv))   throw new Error('Missing: ' + etfsCsv);

  const stocksRows = parseCsv(stocksCsv).filter(r => !THEMATIC_STOCK_LUX_INVALID_SYMBOLS.has(r.symbol));
  const etfsRows   = parseCsv(etfsCsv).filter(r => !THEMATIC_ETF_LUX_INVALID_SYMBOLS.has(r.symbol));
  const arkRows    = existsSync(arkCsv) ? parseArkCsv(arkCsv, arkMetaCsv) : null;
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
      invalid_symbols_excluded: [...ARK_LUX_INVALID_SYMBOLS].sort(),
      max_symbols:         arkRows.length,
      pipeline:            `L1: static CSV watchlist (Watchlist_ARK-1.csv, ${arkRows.length} symbols after filtering ${ARK_LUX_INVALID_SYMBOLS.size} Lux-incompatible symbols) -> L2: lux_screener_scan 1W (hard filter: BOS + Bullish/Strong Bullish S&O Rating + up/up+ Signal) -> L3: NW Envelope per-symbol check on weekly (price inside bands = base coiling, price above upper = extended/already moved)`,
      watchlist:           arkRows,
    });
    console.log(`\nmomentum_ark:    ${arkRows.length} symbols → ${arkOut}`);
    const arkSectors = groupBy(arkRows, 'sector');
    Object.entries(arkSectors).forEach(([t, n]) => console.log(`  ${n.toString().padStart(3)} — ${t}`));
  } else {
    console.log('\nmomentum_ark:    (Watchlist_ARK.csv not found — skipped)');
  }

  // --- Crypto spot ---
  const cryptoCsv = join(csvDir, 'CRYPTO.csv');
  if (existsSync(cryptoCsv)) {
    const cryptoSymbols = parseCryptoCsv(cryptoCsv);
    const cryptoOut = writeConfig('config/strategy-crypto.json', {
      watchlist_source:    cryptoCsv,
      watchlist_generated: generated,
      screener_name:       null,
      max_symbols:         0,
      watchlist:           cryptoSymbols,
    });
    console.log(`\ncrypto:          ${cryptoSymbols.length} symbols → ${cryptoOut}`);
    cryptoSymbols.forEach(s => console.log(`  ${s}`));
  } else {
    console.log('\ncrypto:          (CRYPTO.csv not found — skipped)');
  }

  // --- Crypto perps ---
  const perpsCsv = join(csvDir, 'PERPS.csv');
  if (existsSync(perpsCsv)) {
    const perpsSymbols = parsePerpsCsv(perpsCsv);
    const perpsOut = writeConfig('config/strategy-crypto_perps.json', {
      watchlist_source:    perpsCsv,
      watchlist_generated: generated,
      screener_name:       null,
      max_symbols:         0,
      watchlist:           perpsSymbols,
    });
    console.log(`\ncrypto_perps:    ${perpsSymbols.length} symbols → ${perpsOut}`);
    perpsSymbols.forEach(s => console.log(`  ${s}`));
  } else {
    console.log('\ncrypto_perps:    (PERPS.csv not found — skipped)');
  }

  // --- Futures ---
  const futuresCsv = join(csvDir, 'FUTURES.csv');
  if (existsSync(futuresCsv)) {
    const futuresRows = parseFuturesCsv(futuresCsv);
    const watchlist = futuresRows.map(r => r.symbol);
    // Rebuild sector_map from CSV
    const sectorMap = {};
    for (const r of futuresRows) {
      if (!r.sector) continue;
      if (!sectorMap[r.sector]) sectorMap[r.sector] = [];
      sectorMap[r.sector].push(r.symbol);
    }
    const futuresOut = writeConfig('config/strategy-futures.json', {
      watchlist_source:    futuresCsv,
      watchlist_generated: generated,
      screener_name:       null,
      max_symbols:         0,
      watchlist,
      sector_map:          sectorMap,
    });
    console.log(`\nfutures:         ${watchlist.length} symbols → ${futuresOut}`);
    watchlist.forEach(s => console.log(`  ${s}`));
  } else {
    console.log('\nfutures:         (FUTURES.csv not found — skipped)');
  }

  console.log('\nDone. (No restart needed — only config files changed.)');
}

main();
