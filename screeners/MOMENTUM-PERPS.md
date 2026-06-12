# MOMENTUM-PERPS — CEX Screener

**Type:** CEX Screener  
**Used by:** `morning_brief instrument_type="crypto_perps"`  
**rules.json key:** `"crypto_perps": "MOMENTUM-PERPS"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Exchange | = | Coinbase |
| Contract type | = | Perpetual |
| Margin currency | = | USDC |
| Volume (24H) | > | 1M USD |

## Sort

Default screener ranking (or by 24H % change)

## Notes

- Must be open in a **separate TradingView window** — URL: tradingview.com/cex-screener/
- Coinbase CDE (USDC-settled perpetuals only)
- Blocklist applied in code (`PERPS_BASE_BLOCKLIST` in `src/core/screener.js`):
  removes stock/ETF perps (META, TSLA, NVDA, SPY, QQQ, etc.), fiat (EURC, USDC), meme/micro (PUMP, BILL, 1000SHIB, etc.)
- Keeps: SILVER, GOLD, PAXG (commodity perps intentionally included)
- BTC perp is always prepended as first symbol for benchmark reading
- Universe: ~12 clean crypto + SILVER + GOLD after blocklist
