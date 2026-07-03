# LUXALGO_SCREENERS — Batch Indicator Scan (not a TradingView screener product)

**Type:** Custom chart tab with 3 LuxAlgo indicators, batch-scanned via `lux_screener_scan` — fundamentally different from `MOMENTUM`/`MOMENTUM-ETF`/etc., which are real TradingView Screener products with filter/sort UI. This is a chart tab carrying 3 indicators that get fed batches of symbols programmatically.
**Used by:** `lux_screener_scan` tool → `instrument_type`: `sp_ndx`, `r2k`, `thematic_stocks`
**Config file:** `config/lux-screener-defaults.json`

## What it is

A dedicated chart tab (auto-discovered by tab name-matching — any tab whose loaded studies include names containing `S&O`, `PAC`, and `OSC` all three) carrying 3 LuxAlgo indicators:

| Indicator | Role | Protected? | Ticker format |
|---|---|---|---|
| **S&O** | Rating + Signal | Yes — `getInputValues()` returns `[]` | Bare symbol (`BTCUSDT`, no exchange prefix) |
| **PAC** | Structure | No — supports `getInputValues()` directly | Exchange-prefixed (`BINANCE:BTCUSDT`) |
| **OSC** | Divergences + HWO + Overflow | Yes — `getInputValues()` returns `[]` | Bare symbol (no exchange prefix) |

"Protected" indicators are published with an encrypted settings blob — their live inputs can't be read directly via `getInputValues()`; the tool falls back to `getInputsInfo()` defvals instead, which include a large encrypted `text` input alongside the readable ticker/parameter slots.

## Scan mechanism

`lux_screener_scan` pushes symbols into the 3 indicators in **batches of 10** (via `indicator_set_inputs`, writing into ticker slots like `in_4`, `in_8`, ... `in_40`), reads back each indicator's composite output per symbol (`data_get_pine_tables`), then restores/advances to the next batch. Readiness is polled via **PAC** specifically (most reliable/fastest to load) — `POLL_MAX_ATTEMPTS=8`, `POLL_INTERVAL_MS=1500`.

## Score formula

`S&O Rating (+3/+2/0/−2) + Signal (+2/+1/−1) + OSC Divergence (+2/−2) + HWO (+1/−1) + PAC Structure (+1/−2)`

## Output table formats

- **`sp_ndx`/`r2k`** (retail-sentiment context included): `| SYMBOL | WTD | S&O RATING | SIGNAL | SQUEEZE | PAC STRUCTURE | OSC DIV | HWO | SCORE | CHATTER |`
- **`thematic_stocks`** (theme-grouped, no sentiment fields): `| SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | HWO | SCORE |`

## `config/lux-screener-defaults.json` — what's actually in it

A saved snapshot of all 3 indicators' full input state, captured once when the screeners were freshly added and working correctly. Used as a **fallback** — `lux_screener.js` prefers live-captured inputs each run, but falls back to this file if live capture fails (most relevant for PAC, whose plain `getInputValues()` is the primary live-capture path).

| Section | Input count | Content |
|---|---|---|
| `pac_inputs` | 108 | PAC's full input array (readable, but stored/reused verbatim) |
| `so_inputs` | 129 | S&O's `getInputsInfo()` defvals, including a ~48KB encrypted `text` blob |
| `osc_inputs` | 112 | OSC's `getInputsInfo()` defvals, same encrypted-blob pattern |
| `ticker_overrides` | — | Human-readable map of a few input slots to example tickers (`in_4`→`BINANCE:BTCUSDT`, `in_20`→`SPCFD:SPX`, `in_24`→`BATS:AAPL`, etc.) — extracted from the PAC array's `in_4..in_40` slots for reference; these get overwritten with real batch symbols during an actual scan |

This file is **not meaningfully hand-editable** — the S&O/OSC encrypted blobs are opaque, and PAC's 108 inputs are copied verbatim rather than individually tuned. Treat it as a restore point, not a tunable config.

## Known limitation

After restoring saved inputs, S&O and OSC's **visual chart display stays blank** — the underlying data is correct (verified via `getPineTables()`/JS), but visual rendering doesn't refresh for protected indicators after a programmatic input restore. PAC restores and displays fully. If a human needs to *see* S&O/OSC on the chart (not just read their scanned data), they must be manually re-added.

## Prerequisites

- The `LUXALGO_SCREENERS` tab must be open in TradingView with all 3 screeners (S&O, PAC, OSC) loaded and healthy — no "!" error icons. If they show errors after any code change, delete and re-add them from the Indicators search dialog (see `CHEATSHEET.md`).
- If this tab isn't found (no chart tab with all 3 studies loaded), `lux_screener_scan` fails with an explicit "Could not find a chart tab with all 3 LuxAlgo screeners" error rather than silently degrading.
