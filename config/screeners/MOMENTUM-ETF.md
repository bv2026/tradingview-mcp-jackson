# MOMENTUM-ETF — ETF Screener

**Type:** ETF Screener  
**Used by:** `morning_brief instrument_type="momentum_etf"`  
**rules.json key:** `"momentum_etf": "MOMENTUM-ETF"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Market | US | US-listed ETFs only |
| Asset class | Equity + Commodities (2) | Deliberately narrowed from a broader 4-category default (Equity, Commodities, Asset allocation, Alternatives) on 2026-07-03 — Asset allocation and Alternatives dropped as too diversified/heterogeneous to show real momentum |
| Leveraged | Non-leveraged | Excludes all 2x/3x daily products |
| AUM | > | 10B USD |
| Price | > | 25 USD |
| Price × avg vol (10D) | > | 10M USD |
| Price | > EMA(50, 1M) | — |
| Perf % 3M | > | 10% |

## Sort

**Perf % 3M — descending** (3-month momentum leaders at top)

## Tab

Performance tab — columns: Chg %, Perf % 1W, 1M, 3M, 6M, YTD, 1Y, 5Y, 10Y, All Time

## Result Count

~119-129 symbols passing filters (as of 2026-07-03; live, fluctuates with the market)

## Notes

- Non-leveraged filter removes all single-stock 2x/3x daily ETFs (ARMG, MRVU, SNXX etc.)
- AUM > 10B USD keeps only large, institutional-grade funds
- Price × avg vol > 10M USD eliminates UCITS/foreign-listed funds with low US liquidity
- Price > 25 USD removes micro-price products
- **3M window (filter + sort), not 1M like `MOMENTUM`/`MOMENTUM-ARK`** — deliberate, not an inconsistency. ETFs reflect sector/theme rotation, which plays out on a slower cadence than single-stock momentum; a 3-month lookback is the right differentiator for this asset class, not drift to fix.
- **Asset class narrowed to Equity + Commodities** — Commodities kept because gold/silver/oil ETFs show genuine trending momentum during inflation/rate/geopolitical cycles (legitimate rotation target). Asset allocation (diversified multi-asset/balanced funds) and Alternatives (heterogeneous catch-all — managed futures, market-neutral, vol-linked) were dropped: both are too smoothed/unpredictable to trust as momentum-rotation candidates.
- **Price > EMA(50, 1M)** — same monthly-timeframe EMA parameterization as `MOMENTUM` and `MOMENTUM-ARK`, for consistency across all three stock/ETF screeners.
- No `Mom(10)`/`Mom(10,1W)` filters (unlike `MOMENTUM`/`MOMENTUM-ARK`) — deliberately omitted. Those are short-horizon (weekly) momentum confirmations tuned for stocks'/ARK's faster 1M cadence; adding them here would fight against ETF's intentionally slower 3M design.
- Verified against the live TradingView screener UI on 2026-07-03 — this is the confirmed, deliberate configuration.
