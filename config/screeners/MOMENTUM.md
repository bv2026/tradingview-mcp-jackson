# MOMENTUM — Stock Screener

**Type:** Stock Screener  
**Used by:** `morning_brief instrument_type="momentum_stocks"`  
**rules.json key:** `"momentum_stocks": "MOMENTUM"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Market | Index only | NYSE + NASDAQ (no OTC) |
| Price | > | 20 USD |
| Market Cap | > | 20B USD |
| Mom, 10, 1W | > | 0 |
| RSI (14) | > | 60 |
| Price | > EMA(50, 1M) | — |

## Sort

**Perf % 1M — descending** (1-month relative strength leaders at top)

## Tab

Performance tab — columns: Chg %, Perf % 1W, 1M, 3M, 6M, YTD, 1Y, 5Y, 10Y, All Time, Volatility 1W, Volatility 1M

## Result Count

~138-157 symbols passing filters (as of 2026-07-03; live, fluctuates with the market)

## Notes

- `Index (2)` in the market selector = NYSE + NASDAQ selected, OTC unchecked
- Mkt cap > 20B eliminates micro/small caps and penny stocks
- Price > 20 USD as secondary penny stock guard
- **RSI(14) > 60**, not 50 — deliberately stricter than a bare "more up days than down" bar. Requires confirmed strength, not just weak positive drift; TWB/NW handle entry timing on top of this pre-filter.
- **Mom, 10, 1W > 0** — TradingView's Momentum indicator (length 10) evaluated on the 1-week timeframe, filtered to positive readings only.
- **Price > EMA(50, 1M)** — price above its 50-period EMA computed on the *monthly* timeframe (a longer-horizon trend filter than a daily EMA-50 would be).
- **1M sort** (not 3M) — this project reviewed and confirmed 1M as the intended sort on 2026-07-03; surfaces the freshest relative-strength leaders rather than intermediate-term ones.
- Verified against the live TradingView screener UI on 2026-07-03 — this is the confirmed, deliberate configuration (not a default/drifted state). If it's ever found to differ from live again, re-verify visually (screenshot the filter bar) rather than trusting DOM inference alone — TradingView's obfuscated class names make automated filter extraction unreliable for anything without a `> value` chip.
