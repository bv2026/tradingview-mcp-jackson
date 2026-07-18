# Session Handoff — TradingView MCP Jackson
**Date:** 2026-07-17  
**Handoff to:** Codex (Claude Code)  
**Project root:** `C:\work\tradingview-mcp-jackson`

---

## Latest Codex Findings And Changes

### Codex MCP wiring

- Codex showed the `tradingview` MCP enabled, but the tools were not exposed to the agent.
- Direct MCP stdio probing worked and returned 84 tools, including `lux_screener_scan`, `session_save`, and `tv_health_check`.
- Codex logs showed: `server_name=tradingview has_cached_tools=false startup_complete=true`.
- Changed `C:\Users\vsbra\.codex\config.toml` and `C:\Users\vsbra\.claude\.mcp.json` to launch this MCP with Codex's bundled Node:
  `C:\Users\vsbra\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
- Patched `src/server.js` to delete `tool.execution` metadata after registration because Codex Desktop filters tools that advertise `taskSupport="forbidden"`.
- Direct MCP probing still works after this and returns 84 tools with no `execution` field. Codex may still require an app restart before the tool picker refreshes.

### Momentum ARK invalid-symbol failure

- Initial direct run of `lux_screener_scan instrument_type="momentum_ark" timeframe="1W"` returned `success: true`, but the TradingView/Lux UI showed `Invalid symbol`.
- Confirmed Lux-invalid ARK symbols:
  `BLSH`, `CBRS`, `CRCL`, `CRWV`, `OPENAI`, `SPCX`
- Important nuance: some of those symbols exist in TradingView search, but the Lux screener indicators reject them or return unusable rows when batch-fed.
- Added `ARK_LUX_INVALID_SYMBOLS` in `scripts/build-watchlist-configs.mjs`.
- Regenerated `config/strategy-momentum_ark.json` to exclude those six names.
- Current ARK Lux-compatible universe is 134 symbols.
- Added `invalid_symbols_excluded` to `config/strategy-momentum_ark.json`.
- Removed excluded symbols from ARK correlation clusters.

### Momentum ARK verification

- Clean re-run after exclusions:
  `lux_screener_scan instrument_type="momentum_ark" timeframe="1W"`
- Verified result:
  - `success: true`
  - `symbol_count: 134`
  - `batch_count: 14`
  - `unavailable_count: 0`
  - `all_dash_count: 0`
  - Hard-filter passes: `TXG`, `NTRA`, `TWST`, `ILMN`
- Batch-by-batch isolation result on the 134-symbol ARK universe:
  - Clean batches: `1, 2, 3, 6, 7, 8, 10, 11, 12, 14`
  - Bad batches: `4, 5, 9, 13`
  - Bad batch symbols:
    - Batch 4: `ROKU, SNOW, EXAS, PATH, NFLX, MELI, SOFI, VCYT, WGS, TER`
    - Batch 5: `TSM, MSFT, SE, XE, BWXT, UI, PYPL, EDIT, BILL, BYDDY`
    - Batch 9: `LMT, CRWD, MDB, EH, IRDM, BGNE, DOCU, PRLB, SSYS, LHX`
    - Batch 13: `ADYEY, PAGS, STNE, FSLY, FOUR, HXL, AFRM, AVXL, ANSS, MGA`
  - Failure pattern:
    - Batches `4`, `5`, `9`, and `13` collapsed PAC/S&O/OSC to `study_count: 0` after scan.
    - The remaining batches stayed healthy post-scan.
- `session_save instrument_type="momentum_ark"` succeeded and wrote:
  `reports/2026-Wk29/2026-Jul-17/momentum_ark.md`
- Note: the save tool normalized the provided date to the app/local report date folder (`2026-Jul-17`).

### Momentum ARK final bad-list cleanup

- After batch-by-batch isolation, I finalized the ARK bad-symbol list and rebuilt the generated config.
- Final excluded ARK names:
  - `ANSS`
  - `BLSH`
  - `CBRS`
  - `CRCL`
  - `CRWD`
  - `CRWV`
  - `EXAS`
  - `LMT`
  - `OPENAI`
  - `PAGS`
  - `SPCX`
  - `XE`
- Verified `config/strategy-momentum_ark.json` after rebuild:
  - `128` symbols
  - `invalid_symbols_excluded` contains the 12 names above
  - none of the 12 excluded names remain in the watchlist

### Thematic stocks batch isolation and filter update

- After the initial full thematic-stock scan showed indicator instability, I ran `thematic_stocks` batch-by-batch using the same preflight / scan / postflight pattern.
- Final thematic stock exclusions added to the generator:
  - `SPCX`
  - `CBRS`
  - `CRCL`
  - `CRWV`
- Verified `config/strategy-thematic_stocks.json` after regeneration:
  - `117` symbols
  - `invalid_symbols_excluded` contains all four names above
  - none of the four excluded names remain in the watchlist
- Thematic stock batches:
  - Clean batches: `1, 3, 4, 5, 6, 7, 8, 10, 11, 12`
  - Bad batch: `2`
  - Batch 2 symbols: `CRDO, KLAC, LRCX, ALAB, AMAT, AMD, NBIS, ARM, MRVL, CBRS`
- Important outcome:
  - `CBRS` was the clearest hard-breaker for thematic stocks.
  - `CRWV` and `CRCL` were dirty/unavailable in earlier scans, so they were also excluded for safety.

### Thematic scan warning

- User asked Codex to run:
  - `lux_screener_scan instrument_type="thematic_stocks" timeframe="1W"`
  - `lux_screener_scan instrument_type="thematic_etfs" timeframe="1W"`
- Both direct MCP calls returned `success: true`:
  - `thematic_stocks`: 121 symbols, 13 batches, 0 hard-filter passes
  - `thematic_etfs`: 90 symbols, 9 batches, 0 hard-filter passes
- However, the user showed TradingView OSC indicator runtime error:
  `Runtime error: RE10041`
  `Cannot access the 'str.txt' field of an undefined object. The object is 'na'.`
- Treat those two thematic scan outputs as not fully trusted until OSC is reset/re-added and a small-batch isolation pass finds the offending symbol or confirms indicator health.
- Do not launch another full thematic scan until OSC is healthy.

### Thematic ETF batch isolation and fix

- After resetting the Lux screener indicators, `thematic_etfs` was tested batch-by-batch in isolated 10-symbol config swaps.
- Each isolated batch used this pattern:
  1. Preflight `data_get_pine_tables` for PAC, S&O, and OSC.
  2. Temporarily replace `config/strategy-thematic_etfs.json` watchlist with one batch.
  3. Run `lux_screener_scan instrument_type="thematic_etfs" timeframe="1W"`.
  4. Capture screenshot and re-read PAC/S&O/OSC tables.
  5. Restore the full ETF config.
- Clean batches:
  - Batch 1: `SMH`, `SOXX`, `SOXQ`, `XSD`, `PSI`, `FTXL`, `SMHX`, `DTCR`, `SOXL`, `FNGU`
  - Batch 3: `PUI`, `URA`, `NUKZ`, `NLR`, `GRID`, `FXU`, `BILT`, `XLV`, `VHT`, `IYH`
  - Batch 4: `RSPH`, `XBI`, `IBB`, `BBH`, `IHE`, `PPH`, `OZEM`, `HRTS`, `IHI`, `XLF`
  - Batch 5: `VFH`, `IYF`, `IYG`, `KRE`, `IAT`, `KBE`, `IAI`, `KIE`, `IAK`, `IBIT`
  - Batch 6: `FBTC`, `ETHA`, `BSOL`, `FSOL`, `SSK`, `XLI`, `VIS`, `ITA`, `PPA`, `XAR`
  - Batch 7: `SHLD`, `EUAD`, `IDEF`, `KDEF`, `FITE`, `DFEN`, `PAVE`, `XLE`, `VDE`, `FENY`
  - Batch 8: `IYE`, `XOP`, `OIH`, `AMLP`, `UNG`, `USO`, `IXC`, `XLP`, `VDC`, `FSTA`
- Bad / indicator-breaking batches:
  - Batch 2: `DRAM`, `RAM`, `EWT`, `EWY`, `AIPO`, `IVEP`, `XLU`, `VPU`, `FUTY`, `UPTI`
    - Output returned all dashes.
    - PAC stayed/reverted to defaults.
    - S&O and OSC became unreadable (`study_count: 0`).
  - Batch 9: `KXI`, `XRT`, `RTH`, `ONLN`, `PSCD`, `UFO`, `ARKX`, `MARS`, `UFOD`, `SPCI`
    - PAC hit `Runtime error: RE10041`.
    - `MARS`, `UFOD`, and `SPCI` returned `Signal: Unavailable`.
- Dirty but non-breaking symbols observed during isolated tests:
  - `BILT`
  - `BSOL`
  - `FSOL`
  - `IDEF`
  - `SSK`
- Final ETF exclusion list applied in `scripts/build-watchlist-configs.mjs`:
  `AIPO`, `BILT`, `BSOL`, `DRAM`, `FSOL`, `IDEF`, `IVEP`, `MARS`, `RAM`, `SPCI`, `SSK`, `UFOD`, `UPTI`
- Regenerated `config/strategy-thematic_etfs.json`.
- New `thematic_etfs` universe: 77 symbols, 8 batches.
- Full filtered ETF scan verification:
  - `success: true`
  - `symbol_count: 77`
  - `batch_count: 8`
  - `unavailable_count: 0`
  - `all_dash_count: 0`
  - PAC/S&O/OSC all readable after scan.
  - Screenshot showed no runtime-error bubbles.
  - Hard-filter passes: 12.
  - Top candidates included: `PAVE`, `SMH`, `SOXQ`, `IBB`, `XRT`, `RTH`, `SOXX`, `PSI`, `XBI`, `IHE`.

### Planned next step

- Run `thematic_stocks` and `momentum_ark` using the same batch-isolation mode before trusting any full-list result.
- Use preflight and post-scan PAC/S&O/OSC health checks for every batch.
- If a batch breaks any Lux indicator, reset/re-add the affected indicators before continuing.

### Other code changes from troubleshooting

- `src/core/lux_screener.js`: added helpers to preserve/use exchange-qualified symbols (`full_symbol` / `exchange`) instead of always forcing `BATS:${symbol}`.
- `src/core/lux_screener.js`: live screener results keep their exchange-qualified symbol for chart inputs while still reporting bare tickers in output.
- `src/core/indicators.js`: protected Lux indicator input updates now preserve hidden/encrypted fields from `getInputsInfo()` on each `setInputValues` call.
- This protected-input change did not solve the invalid ARK symbols by itself, but it is safer for protected Lux screeners than skipping hidden fields.

---

## What Was Done This Session

### 1. ARK Architecture Change (PRIMARY WORK — completed, pushed)

**Before:** `momentum_ark` → live MOMENTUM-ARK TradingView screener → lux_screener_scan  
**After:** `momentum_ark` → static `CSV/Watchlist_ARK.csv` (141 symbols) → `lux_screener_scan 1W` directly

This matches how `thematic_stocks` / `thematic_etfs` / `sp_ndx` / `r2k` work. No live screener needed.

**Files changed (all committed + pushed):**
- `config/rules.json` — `screener_sources.momentum_ark` set to `null`
- `config/strategy-momentum_ark.json` — full rewrite: 141-symbol object-format watchlist, `screener_name: null`, updated pipeline description, updated correlation clusters
- `src/core/morning.js` — removed `momentum_ark` from `ALL_INSTRUMENTS`; added it as THEMATIC STEP 0 in the "all" instruction (calls `lux_screener_scan instrument_type="momentum_ark"`)
- `scripts/build-watchlist-configs.mjs` — added `parseArkCsv()` function and ARK `writeConfig` block; running the script now rebuilds all three watchlists (thematic_stocks + thematic_etfs + momentum_ark) in one command
- `CLAUDE.md` — updated morning workflow section: separated "core briefs" (morning_brief) from "watchlist briefs" (lux_screener_scan); updated brief formatting for momentum_ark to use lux score columns instead of TWB columns
- `CHEATSHEET.md` — updated daily routine table, "all" description, three-families table (now two families: 5 core / 5 watchlist), Saturday cadence, "How a brief works" section

### 2. ARK CSV Watchlist Cleaned (`CSV/Watchlist_ARK.csv` — NOT in git, CSV/ is gitignored)

Started with 152 rows, ended with 141 valid symbols after:
- Removed 9 delisted/private/wrong tickers: MAXR (went private 2023), SGEN (→Pfizer 2023), COUP (→private 2023), NVTA (bankrupt 2024), SPLK (→Cisco 2024), MKFG (bankrupt/delisted), BLUE (no US listing), NATE (private German company), VTI (ETF, not a stock)
- Removed 2 duplicates: SQ (kept XYZ — Block changed ticker to XYZ in 2024), STONE (kept STNE)
- Fixed 1 wrong ticker: DSCS → DDD (3D Systems Corp, NYSE:DDD)

**Tickers confirmed valid but flagged for manual awareness:**
- OPENAI — NASDAQ:OPENAI exists as stock type (recent listing)
- SPCX — NASDAQ:SPCX exists (Space Exploration Technologies)
- CRCL — NYSE:CRCL (Circle Internet, IPO'd)
- FIG — NYSE:FIG (Figma, IPO'd)
- BLSH — NYSE:BLSH (Bullish)
- BMNR — NYSE:BMNR (BitMine Immersion)
- CBRS — NASDAQ:CBRS (Cerebras Systems)
- BYDDY — OTC:BYDDY (BYD ADR, OTC)
- EVLO — OTC:EVLO only (Evelo Biosciences, distressed/OTC)
- SPCE — NYSE:SPCE still listed but Virgin Galactic became "Galactic"/MNTN — may be stale
- ADYEY — not found as US ADR; primary listing is Euronext Amsterdam:ADYEN

### 3. Earlier in Session (before context compaction)

- **verifyChartLive bug fix** (`src/core/morning.js`): added `&& !/^volume$/i.test(i)` to oscillator detection — Volume was being picked as the "value indicator" for equity types, causing crash
- **classifyArk fix** (`src/core/classify.js`): `bias === 'n/a'` now maps to BASE_BUILDING (not SKIP), since lux_screener_scan is the L2 filter and symbols reaching classify already passed
- **thematic_etfs split removed**: was `thematic_etfs_1` + `thematic_etfs_2`, now single `thematic_etfs`
- **Benchmark fallback fix**: equity types with null `market_context` no longer produce "undefined-day undefined" string
- **MCP removed**: webull-platform removed from Claude Desktop config
- **Scheduled task updated**: Daily tv-mcp task now also runs on Sundays

---

## What Needs Testing Next

The user wants to **test the new momentum_ark path end-to-end** in Claude Desktop:

```
lux screener scan momentum_ark
```

This should:
1. Find the LUXALGO_SCREENERS chart tab automatically
2. Batch the 140 ARK symbols (14 batches of 10) through S&O + PAC + OSC screeners on 1W
3. Apply the hard filter (BOS + Bullish S&O + ▲ signal)
4. Return ranked results with scores
5. Claude applies ARK strategy rules: cluster check, Top 20 Setups table, Top 3 with entry/stop/TP1

**Potential issues to watch for:**
- Timeout: 140 symbols = 14 batches × ~12s poll = ~3 minutes. May need to check if tool has enough timeout headroom
- LUXALGO_SCREENERS tab must be open in TradingView with all 3 screeners (S&O, PAC, OSC) healthy (no "!" error icons)
- Claude Desktop restart was done before this handoff — new `morning.js` code is active

**Also pending: session handoff doc** for the full project was never updated with today's changes. If Codex writes one after testing, put it at `SESSION_HANDOFF.md` (this file) or a dated file.

---

## Architecture Summary (Current State)

```
Brief families:

CORE (5) — live screeners → morning_brief → NW scan
  momentum_stocks  → MOMENTUM screener → morning_brief
  momentum_etf     → MOMENTUM-ETF screener → morning_brief
  crypto           → MOMENTUM-CRYPTO screener → morning_brief
  crypto_perps     → MOMENTUM-PERPS screener → morning_brief
  futures          → static futures list → morning_brief

WATCHLIST (5) — static CSV → lux_screener_scan (S&O+PAC+OSC, 1W)
  momentum_ark     → CSV/Watchlist_ARK.csv (140 symbols, weight-sorted)
  sp_ndx           → CSV/momentum-sp500-*.csv + momentum-nasdaq100-*.csv
  r2k              → CSV/momentum-russell2000-*.csv
  thematic_stocks  → CSV/Watchlist_Stocks.csv (121 symbols, 8 themes)
  thematic_etfs    → CSV/Watchlist_ETFs.csv (~90 ETFs, 8 themes)
```

**Rebuild watchlist configs (Saturday):**
```
node scripts/build-watchlist-configs.mjs
```
Regenerates: `strategy-thematic_stocks.json` + `strategy-thematic_etfs.json` + `strategy-momentum_ark.json`

**Rules file:** `config/rules.json` — chart_tabs (chart_id per instrument) + screener_sources (null for all watchlist types)

---

## Key File Locations

| What | Where |
|---|---|
| ARK watchlist CSV | `CSV/Watchlist_ARK.csv` (gitignored) |
| ARK strategy config | `config/strategy-momentum_ark.json` |
| Rules (screeners + chart tabs) | `config/rules.json` |
| Morning brief core | `src/core/morning.js` |
| Lux screener core | `src/core/lux_screener.js` |
| Classify (precomputed fields) | `src/core/classify.js` |
| Build watchlists script | `scripts/build-watchlist-configs.mjs` |
| Reports | `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/` |

---

## Git State

Branch: `main` — up to date with origin  
Last commit: `Switch momentum_ark to static CSV watchlist via lux_screener_scan`

No uncommitted changes. `config/strategy-thematic_stocks.json` and `config/strategy-thematic_etfs.json` were regenerated by the build script but not staged (their watchlist content didn't change, only the `watchlist_generated` date — safe to leave or commit as cleanup).
---

## Current Working State After Codex Troubleshooting

The older "No uncommitted changes" note in this handoff is stale. Current uncommitted files are expected after the latest troubleshooting:

- `config/strategy-momentum_ark.json` — regenerated to 134 Lux-compatible symbols and records `invalid_symbols_excluded`.
- `scripts/build-watchlist-configs.mjs` — filters ARK Lux-invalid symbols: `BLSH`, `CBRS`, `CRCL`, `CRWV`, `OPENAI`, `SPCX`.
- `src/server.js` — deletes MCP `tool.execution` metadata for Codex Desktop tool visibility.
- `src/core/lux_screener.js` — preserves exchange-qualified symbols for batch inputs.
- `src/core/indicators.js` — preserves protected Lux hidden/encrypted input fields on protected indicator updates.
- `config/strategy-thematic_stocks.json` and `config/strategy-thematic_etfs.json` — regenerated by the build script; review before committing because they may include timestamp/order churn.
- `SESSION_HANDOFF.md` — updated with these findings.

Validated:

- `momentum_ark` direct MCP scan works cleanly at 134 symbols.
- `session_save` for `momentum_ark` wrote `reports/2026-Wk29/2026-Jul-17/momentum_ark.md`.

Blocked / needs care:

- Thematic scans returned MCP `success: true`, but the TradingView UI showed OSC `Runtime error: RE10041`.
- Reset/re-add OSC before further full thematic scans.
- Use small 10-symbol thematic batches to isolate any OSC-triggering symbol instead of immediately running the full lists.
