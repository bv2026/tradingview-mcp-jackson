# MOMENTUM-ETF — ETF Screener

**Type:** ETF Screener  
**Used by:** `morning_brief instrument_type="etf"`  
**rules.json key:** `"etf": "MOMENTUM-ETF"`

## Filters

| Filter | Condition | Value |
|--------|-----------|-------|
| Market | US | US-listed ETFs only |
| Asset class | Equity (4) | Equity ETFs only |
| Leveraged | Non-leveraged | Excludes all 2x/3x daily products |
| AUM | > | 10B USD |
| Price | > | 25 USD |
| Price × avg vol (10D) | > | 10M USD |
| Price | > EMA | 50 |
| Perf % 3M | > | 10% |

## Sort

**Perf % 3M — descending** (3-month momentum leaders at top)

## Tab

Performance tab — columns: Chg %, Perf % 1W, 1M, 3M, 6M, YTD, 1Y, 5Y, 10Y, All Time

## Result Count

~100 symbols passing filters (as of 2026-06-13)

## Notes

- Non-leveraged filter removes all single-stock 2x/3x daily ETFs (ARMG, MRVU, SNXX etc.)
- AUM > 10B USD keeps only large, institutional-grade funds
- Price × avg vol > 10M USD eliminates UCITS/foreign-listed funds with low US liquidity
- Price > 25 USD removes micro-price products
- Top names as of 2026-06-13: SOXX, SMH, XLK, VGT, QQQ, MTUM, SPMO, AIQ, CIBR, IYW, VGT, EWY, EWT
