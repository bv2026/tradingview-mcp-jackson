# Phase 2B validation — 2026-08-13

## Scope

Read-only acquisition validation. No strategy, scoring, prompt, ranking, or workflow logic was changed.

## Workspace and health

- Workspace: `C:\work\tradingview-mcp-jackson`
- HEAD: `310d768b5bc9573d3e9fd8e3b9d4148dcd2a424c`
- Pre-run TradingView health: CDP/API connected; chart `BATS:NVDA`, `1W`.
- Post-run TradingView health: CDP/API connected; chart `BATS:PSCD`, `1W`.
- Lux restoration after every completed Lux call: PAC `ok=true,count=108`; S&O `ok=true,count=129`; OSC `ok=true,count=112`; capture source `live`.

## Exact calls and acquisition results

| Job | Exact call | Requested/returned | Result |
|---|---|---:|---|
| momentum_ark | `lux_screener_scan(instrument_type="momentum_ark", timeframe="1W")` | 117 / 117 | PASS acquisition; 17 NW-pass; all three study restore checks passed |
| sp_ndx | `lux_screener_scan(instrument_type="sp_ndx", timeframe="1W")` | 36 / 36 | PASS acquisition; 6 NW-pass; all restore checks passed |
| r2k | `lux_screener_scan(instrument_type="r2k", timeframe="1W")` | returned successfully in sequential run | PARTIAL: raw MCP response was produced, but this handback cannot reconstruct its complete response from the bounded tool transcript |
| thematic_stocks | `lux_screener_scan(instrument_type="thematic_stocks", timeframe="1W")` | 117 / 117 | PARTIAL: acquisition succeeded, but NW pass phase reported `timeout after 50000ms`; restore checks passed |
| thematic_etfs split 0 | `lux_screener_scan(instrument_type="thematic_etfs", timeframe="1W", offset=0, max_symbols=50)` | 50 / 50 of 77 | PASS split acquisition; 10 NW-pass; restore checks passed |
| thematic_etfs split 1 | `lux_screener_scan(instrument_type="thematic_etfs", timeframe="1W", offset=50)` | 27 / 27; slice 51–77 | PASS split acquisition; 7 NW-pass; restore checks passed |
| thematic_etfs merged | merge of split symbol arrays | 77 total | PASS count reconciliation: 50+27=77; no duplicate/omission was reported by the routine |
| morning_stock requested label | `morning_brief(instrument_type="morning_stock")` | n/a | FAIL exact request: MCP schema rejects this value |
| morning_stock established path | `morning_brief(instrument_type="momentum_stocks")` | screener 100 / scanned 50 | PASS; fresh 50, stale 0; quote/OHLCV, Volume study, NW labels, timeframe `W` present |
| morning_etf established path | `morning_brief(instrument_type="momentum_etf")` | screener 100 / scanned 50 | PASS; fresh 50, stale 0; quote/OHLCV, Volume study, NW labels, timeframe `W` present |

## Raw-field observations

Completed Lux rows included `symbol`, `full_symbol` (for example `BATS:VLO`), `captured_at`, raw `so`, `pac`, and `osc` maps, plus `so_status`, `pac_status`, and `osc_status`. Observed statuses included PRESENT, ABSENT, and UNVERIFIED; empty maps were retained and were not converted to neutral values.

NW-derived fields were present (`nw_position`, `nw_upper`, `nw_lower`, `price`, `rr`). In the observed runs `nw_raw_values` was null on sampled completed rows, while the routine explicitly reported that NW R:R was null for all passing symbols because band levels were not exposed in the Data Window. This proves field presence and null-preservation, not non-null raw-map capture.

Morning rows preserved quote time, open/high/low/close/last/volume, description, exchange, type, Volume study values, NW labels, freshness, and timeframe.

## Phase 2B proof

- Resolved symbol identity: empirically proven across completed Lux jobs (`full_symbol` present).
- Per-study availability status: empirically proven; PRESENT/ABSENT/UNVERIFIED observed.
- Raw NW map: field exists and null is preserved; non-null raw-map capture was not empirically proven in these runs.
- Capture/freshness provenance: empirically proven; Lux `captured_at` present and morning scans reported fresh/stale counts.

## Final git impact

No commit or push was performed. Final status remained eight modified strategy JSON files:
`strategy-crypto.json`, `strategy-crypto_perps.json`, `strategy-futures.json`, `strategy-momentum_ark.json`, `strategy-r2k.json`, `strategy-sp_ndx.json`, `strategy-thematic_etfs.json`, and `strategy-thematic_stocks.json`. Diff stat: 8 files, 8 insertions, 8 deletions. No strategy/scoring/prompt/ranking edits were made during validation.
