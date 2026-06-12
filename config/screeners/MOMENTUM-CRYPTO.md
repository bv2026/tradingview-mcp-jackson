# MOMENTUM-CRYPTO — Crypto Coins Screener

**Type:** Crypto Coins Screener  
**Used by:** `morning_brief instrument_type="crypto"`  
**rules.json key:** `"crypto": "MOMENTUM-CRYPTO"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Exchange | = | Coinbase |
| Market Cap | > | 5B USD |
| Volume (24H) | > | 100M USD |

## Sort

Default screener ranking (or by 24H % change)

## Notes

- Must be open in a **separate TradingView window** from the main chart
- Coinbase filter ensures spot coins only (no derivatives)
- >$5B mcap + >$100M vol eliminates illiquid alts
- Blocklist applied in code (`CRYPTO_BLOCKLIST` in `src/core/screener.js`):
  removes stablecoins (USDT/USDC/DAI), wrapped tokens (WBTC/WETH), tokenized gold (XAUT/PAXG), BNB, XMR, TRX
- Universe after blocklist: BTC, ETH, SOL, XRP, DOGE, ZEC, ADA, LINK, XLM (~9 coins)
