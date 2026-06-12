# MOMENTUM — Stock Screener

**Type:** Stock Screener  
**Used by:** `morning_brief instrument_type="stocks"`  
**rules.json key:** `"stocks": "MOMENTUM"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Market | Index only | NYSE + NASDAQ (no OTC) |
| Price | > EMA | 50 |
| Market Cap | > | 20B USD |
| RSI (14) | > | 50 |
| Price | > | 20 USD |

## Sort

**Perf % 3M — descending** (3-month relative strength leaders at top)

## Tab

Performance tab — columns: Chg %, Perf % 1W, 1M, 3M, 6M, YTD, 1Y, 5Y, 10Y, All Time, Volatility 1W, Volatility 1M

## Result Count

~228 symbols passing filters (as of 2026-06-12)

## Notes

- `Index (2)` in the market selector = NYSE + NASDAQ selected, OTC unchecked
- Mkt cap > 20B eliminates micro/small caps and penny stocks
- Price > 20 USD as secondary penny stock guard
- RSI > 50 keeps only stocks with confirmed buying momentum
- 3M sort surfaces intermediate-term RS leaders (semis, tech dominate when in uptrend)
- Top names as of 2026-06-12: MRVL, ARM, SNDK, INTC, DELL, AMD, STX, MU, HUM, HPE, WDC, ON, CNC, DDOG, KLAC, LRCX
