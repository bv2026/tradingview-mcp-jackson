# MOMENTUM-ARK — Stock Screener

**Type:** Stock Screener  
**Used by:** `morning_brief instrument_type="momentum_ark"`  
**rules.json key:** `"momentum_ark": "MOMENTUM-ARK"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Watchlist | scoped to | ark-stock-list (116 ARK Innovation holdings) |
| Price | > EMA(50, 1M) | — |
| Mom, 10 | > | 0 |
| Mom, 10, 1W | > | 0 |

## Sort

**Perf % 1M — descending** (1-month RS leaders at top)

## Tab

Custom tab — columns: Price, Chg %, Perf % 1W, 1M, 3M, 6M, YTD, 1Y, 5Y, 10Y, All Time, Volatility 1W, Volatility 1M, Beta 1Y

## Result Count

~32 symbols passing filters (as of 2026-07-03; live, fluctuates with the market)

## Notes

- Scoped to `ark-stock-list` watchlist — must be created first (116 symbols from strategy-momentum_ark.json)
- No market cap or RSI filter needed — watchlist already curated; ARK names can have high RSI legitimately during strong uptrends, so RSI is deliberately not gated here
- 1M sort (not 3M) because ARK names move faster — 3M can miss recent rotations. Matches `MOMENTUM` (stocks) screener's sort for consistency across the two stock screeners.
- **Price > EMA(50, 1M)** — price above its 50-period EMA computed on the *monthly* timeframe (same parameterization as `MOMENTUM`).
- **Mom, 10 > 0** and **Mom, 10, 1W > 0** — TradingView's Momentum indicator (length 10), filtered to positive readings on both the base timeframe and the 1-week timeframe. Note: `MOMENTUM` (stocks) only keeps the 1W variant of this filter; ARK keeps both.
- Verified against the live TradingView screener UI on 2026-07-03 — this is the confirmed, deliberate configuration.

## Watchlist Import (ark-stock-list)

See `strategy-momentum_ark.json` for the full 116-symbol list with exchange prefixes (NASDAQ:NVDA format).
