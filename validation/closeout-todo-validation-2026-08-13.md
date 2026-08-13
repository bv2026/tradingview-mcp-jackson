# Close-out TODO validation — 2026-08-13

The all-morning flow now routes `momentum_stocks` and `momentum_etf` through the established Lux screener path. Stocks use `offset=0,max_symbols=50` then `offset=50`; ETFs use `offset=0,max_symbols=30` then `offset=30`. Direct `morning_brief` callers remain backward-compatible.

The active legacy TradingView MCP passed its health check. Final equity validations were:

| Call | Symbols | Internal 10-symbol batches | Result |
|---|---:|---:|---|
| `lux_screener_scan(instrument_type="sp_ndx", timeframe="1W")` | 36 | 4 | Success; restoration passed |
| `lux_screener_scan(instrument_type="r2k", timeframe="1W")` | 25 | 3 | Success; restoration passed |
| `lux_screener_scan(instrument_type="thematic_stocks", timeframe="1W")` | 117 | 12 | Acquisition succeeded; NW pass timed out after 50 seconds; restoration passed |

Complete raw MCP responses are stored in the authoritative Drive evidence location under `validation/raw-evidence/2026-08-13/` as `08-sp_ndx.raw.json`, `09-r2k.raw.json`, and `10-thematic_stocks.raw.json`.

NW remains a location/timing overlay, not a score input. PAC/S&O/OSC are sufficient for the immediate workflow. Separate NW-indicator engineering is deferred because the normal Data Window does not reliably expose the NW bands and current evidence does not justify new plumbing.
