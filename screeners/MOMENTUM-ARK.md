# MOMENTUM-ARK — Stock Screener

**Type:** Stock Screener  
**Used by:** `morning_brief instrument_type="ark"`  
**rules.json key:** `"ark": "MOMENTUM-ARK"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Watchlist | scoped to | ark-stock-list (116 ARK Innovation holdings) |
| Price | > EMA | 50 |

## Sort

**Perf % 1M — descending** (1-month RS leaders at top)

## Tab

Custom tab — columns: Price, Chg %, Perf % 1W, 1M, 3M, 6M, YTD, 1Y, 3Y, 10Y, All Time, Volatility 1W, Volatility 1Y, Beta 1Y

## Result Count

~40 symbols passing filters (as of 2026-06-12)

## Notes

- Scoped to `ark-stock-list` watchlist — must be created first (116 symbols from strategy-ark.json)
- No market cap filter needed — watchlist already curated
- 1M sort (not 3M) because ARK names move faster — 3M can miss recent rotations
- Only `Price > EMA(50)` as gate — removes stocks in downtrend
- No RSI filter — ARK names can have high RSI legitimately during strong uptrends
- Top names as of 2026-Jun-12 sorted by 1M: TWST, TXG, PSNL, BFLY, SNDK, GH, ADPT, CRWD, ABSI, MU

## Watchlist Import (ark-stock-list)

See `strategy-ark.json` for the full 116-symbol list with exchange prefixes (NASDAQ:NVDA format).
