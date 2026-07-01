/**
 * Screener core logic.
 * Reads symbol results from the TradingView Screener widget via CDP.
 * Each screener type (stocks, crypto, etc.) opens in its own CDP target window.
 * We connect to the correct target by matching the CDP title to screener_name.
 */
import { evaluateOnScreener, getScreenerClient } from '../connection.js';

const SCREEN_TITLE = '[data-name="screener-topbar-screen-title"]';
const SCREEN_TITLE_TEXT = '[data-qa-id="screen-title"]';
const SWITCHER_BTN = '[data-qa-id="screener-pills-switcher"]';
const POPOVER_ITEM = '[data-qa-id="screener-popover-recent-screens-item"]';

// Shorthand: evaluate in the window whose CDP title matches screener_name
const ev = (expr, name) => evaluateOnScreener(expr, name);

// Coins to always exclude from crypto spot screener results:
// stablecoins, wrapped tokens, synthetic assets, exchange-specific tokens not on Coinbase
const CRYPTO_BLOCKLIST = new Set([
  'USDTUSD', 'USDCUSD', 'DAIUSD', 'BUSDUSD', 'TUSDUSD', 'USDS2USD', 'FRAXUSD',
  'LUSDTUSD', 'PYUSDUSD', 'GHOUSD', 'CRVUSDUSD', 'SUSDUSD', 'USDDEUSD',
  'WBTCUSD', 'WETHUSD', 'CBBTCCUSD', 'WBNBUSD', 'WSOLUSD',  // wrapped
  'XAUTUSD', 'PAXGUSD',                                        // tokenized gold
  'BNBUSD',                                                     // Binance-only
  'HYPEHUSD',                                                   // bad ticker
  'XMRUSD',                                                     // Monero — delisted from Coinbase Jan 2021
  'TRXUSD',                                                     // TRON — low quality, not on Coinbase
]);

function filterCryptoSymbols(symbols) {
  return symbols.filter(sym => {
    const ticker = sym.split(':')[1] || sym;
    return !CRYPTO_BLOCKLIST.has(ticker);
  });
}

// Base tickers to exclude from CEX perps screener results.
// Stocks, fiat pairs, meme tokens, and low-quality coins.
// Commodity perps (SILVER, GOLD, PAXG) are intentionally NOT blocked.
const PERPS_BASE_BLOCKLIST = new Set([
  // Equity/stock perps — Coinbase offers nano equity perps, excluded from crypto scan
  'META', 'TSLA', 'GOOGL', 'INTC', 'AMZN', 'SPY', 'NVDA', 'AAPL', 'MSFT',
  'MU', 'AMD', 'ARM', 'MSFT', 'QQQ', 'ROBO', 'NBIS', 'NFLX', 'COIN', 'MSTR',
  // Fiat / stablecoin perps
  'EURC', 'USDT', 'USDC', 'DAI',
  // Meme / micro-cap / low quality
  'PUMP', 'BILL', '1000SHIB', '1000PEPE', 'MEME', 'SNDK', 'CBRS', 'MERL', 'W',
  // Low quality / too new / not tradeable
  'HYPE', 'CRV', 'BE',
]);

// Extract the base currency from a perp symbol.
// e.g. "COINBASE:METAUSDC.P" → "META", "COINBASE:SILVERUSDC.P" → "SILVER"
function extractPerpsBase(symbol) {
  const ticker = symbol.split(':')[1] || symbol;
  // Strip .P / .PERP suffix, then strip quote currency
  return ticker
    .replace(/\.(P|PERP)$/i, '')
    .replace(/(USDC|USDT|USD|EUR)$/, '');
}

function filterPerpsSymbols(symbols) {
  return symbols.filter(sym => {
    const base = extractPerpsBase(sym);
    return !PERPS_BASE_BLOCKLIST.has(base);
  });
}

export async function get({ screener_name, max_symbols, offset } = {}) {
  const sc = await getScreenerClient(screener_name);
  if (!sc) {
    throw new Error(
      `Screener window "${screener_name || ''}" is not open. ` +
      'In TradingView Desktop, open the screener tab for this screen and keep it visible.'
    );
  }

  // Read active screen name and type directly from the correct window
  const [currentName, screenerType] = await ev(`
    (function() {
      var name = (document.querySelector('${SCREEN_TITLE_TEXT}') || {}).textContent || '';
      var type = (document.querySelector('${SWITCHER_BTN} h1') || {}).textContent || '';
      return [name.trim(), type.trim()];
    })()
  `, screener_name);

  // If the window is showing a different screen, switch to the requested one
  if (screener_name && currentName !== screener_name) {
    await switchToScreen(screener_name, screener_name);
    await new Promise(r => setTimeout(r, 1200));
  }

  // Re-read name after potential switch
  const finalName = screener_name || currentName;

  // Extract symbols from table rows via data-rowkey (format: EXCHANGE:SYMBOL)
  const allSymbols = await ev(`
    (function() {
      var rows = document.querySelectorAll('tbody tr[data-rowkey]');
      var symbols = [];
      var seen = {};
      for (var i = 0; i < rows.length; i++) {
        var key = rows[i].getAttribute('data-rowkey');
        if (key && !seen[key]) {
          seen[key] = true;
          symbols.push(key);
        }
      }
      return symbols;
    })()
  `, screener_name);

  if (!allSymbols || allSymbols.length === 0) {
    throw new Error(
      `No symbols found in screener "${finalName}". ` +
      'Make sure the screener table is visible and has results.'
    );
  }

  const isCrypto = /crypto/i.test(screenerType);
  const isPerps = /cex/i.test(screenerType);
  const filtered = isPerps
    ? filterPerpsSymbols(allSymbols)
    : isCrypto
      ? filterCryptoSymbols(allSymbols)
      : allSymbols;

  const start = offset && offset > 0 ? offset : 0;
  const limit = max_symbols && max_symbols > 0 ? max_symbols : filtered.length;
  const symbols = filtered.slice(start, start + limit);

  return {
    success: true,
    name: finalName,
    instrument_type: mapScreenerType(screenerType),
    screener_type: screenerType,
    total_in_screener: allSymbols.length,
    total_after_filter: filtered.length,
    offset: start,
    symbols_returned: symbols.length,
    max_symbols: limit,
    symbols,
  };
}

export async function list() {
  const sc = await getScreenerClient();
  if (!sc) {
    throw new Error('No screener window is open. Open a TradingView screener tab first.');
  }

  await ev(`document.querySelector('${SCREEN_TITLE}').click()`);
  await new Promise(r => setTimeout(r, 400));

  const screens = await ev(`
    (function() {
      var items = document.querySelectorAll('${POPOVER_ITEM}');
      var results = [];
      var seen = {};
      for (var i = 0; i < items.length; i++) {
        var t = items[i].textContent.trim();
        if (t && !seen[t]) { seen[t] = true; results.push(t); }
      }
      return results;
    })()
  `);

  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);

  return {
    success: true,
    recent_screens: screens || [],
    note: 'Shows recently used screens in the active screener window.',
  };
}

async function switchToScreen(name, windowName) {
  const opened = await ev(`
    (function() {
      var btn = document.querySelector('${SCREEN_TITLE}');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `, windowName);

  if (!opened) throw new Error('Could not open screen switcher dropdown.');
  await new Promise(r => setTimeout(r, 400));

  const clicked = await ev(`
    (function() {
      var items = document.querySelectorAll('${POPOVER_ITEM}');
      for (var i = 0; i < items.length; i++) {
        if (items[i].textContent.trim() === '${name}') {
          items[i].click();
          return true;
        }
      }
      return false;
    })()
  `, windowName);

  if (!clicked) {
    await ev(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`, windowName);
    throw new Error(
      `Screen "${name}" not found in recently used screens. ` +
      'Open it manually in TradingView first so it appears in the recent list.'
    );
  }
}

function mapScreenerType(tvType) {
  const map = {
    'Stock Screener': 'stocks',
    'ETF Screener': 'etf',
    'Bond Screener': 'bonds',
    'Crypto Coins Screener': 'crypto',
    'CEX Screener': 'crypto_perps',
    'DEX Screener': 'crypto',
  };
  return map[tvType] || tvType.toLowerCase().replace(/\s+screener$/i, '').trim();
}
