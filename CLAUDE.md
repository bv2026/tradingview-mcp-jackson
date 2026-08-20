# TradingView MCP — Claude Instructions

87 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Morning Workflow (primary daily use)

Core briefs:

```
morning_brief instrument_type="momentum_stocks" # live MOMENTUM screener
morning_brief instrument_type="momentum_etf"    # live MOMENTUM-ETF screener
morning_brief instrument_type="crypto"          # full static CSV/CRYPTO.csv watchlist
morning_brief instrument_type="crypto_perps"    # full static CSV/PERPS.csv watchlist
morning_brief instrument_type="futures"         # full static CSV/FUTURES.csv watchlist
```

Watchlist briefs (static CSV → lux_screener_scan, no live screener needed):

```
# IMPORTANT: always use max_symbols=20 — larger values time out
# sp_ndx (36 symbols — 2 batches)
lux_screener_scan instrument_type="sp_ndx" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="sp_ndx" timeframe="1W" max_symbols=20 offset=20

# r2k (25 symbols — 2 batches)
lux_screener_scan instrument_type="r2k"    timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="r2k"    timeframe="1W" max_symbols=20 offset=20

# momentum_ark (137 symbols — 7 batches of 20)
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=20
# ... continue in steps of 20 until slice_range shows no more symbols

# thematic_stocks (117 symbols — 6 batches of 20)
lux_screener_scan instrument_type="thematic_stocks" timeframe="1W" max_symbols=20 offset=0
# ... continue in steps of 20

# thematic_etfs (77 symbols — 4 batches of 20)
lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" max_symbols=20 offset=0
# ... continue in steps of 20
```

**Combining multi-batch results:** after all batches return, run `scan-extract.mjs --full` to deduplicate and keep highest-quality result per symbol. The extract output is the canonical scan JSON; no manual merging needed.

**Step 1 — sync screener** (momentum_stocks only — crypto/perps use static CSV watchlists, no screener needed):
```
screener_get screener_name="MOMENTUM" max_symbols=10
```

**Step 2 — run brief** — pulls live symbols (or static watchlist), scans each symbol, returns structured data for Claude to apply strategy rules.

**ETF income workflow:**
```
income_etf_scan screener_name="WKLY-DIV-ETF" frequency="all" portfolio_value=100000
```
This merges Dividends, NAV performance, Overview, Fund flows, Holdings, Risk, and Technicals by full TradingView symbol. Weekly and monthly payers are ranked together; frequency is used only for cash-flow scheduling. The established-fund formula remains `score_version: 1` and is documented exactly in `config/screeners/WKLY-DIV-ETF.md`; funds missing either required one-year NAV field remain watchlist-only. The `portfolio` result has no minimum or target fund count: hard gates determine membership, score determines relative sizing, position/exposure caps control concentration, and cash remains unallocated when too few funds qualify. `top_n` limits only the displayed ranking, never portfolio membership. NAV total return and NAV preservation outrank indicated yield, and issuer ROC/SEC-yield checks remain mandatory. Follow the returned `instruction` to render the complete accumulation report and call `session_save instrument_type="income_etf"`. Weekly income artifacts are isolated under `reports/inc-etf/<YYYY-WkNN>/` as `income_etf.md`, `scan-income_etf.json`, and `income_etf-alerts.json`; same-week reruns overwrite these canonical files in place. Monthly governance reviews belong under `reports/inc-etf/Mon-review/<YYYY-Mon>/`.

For scheduled operation use `income_etf_monitor` instead of calling `income_etf_scan` directly. It persists the TradingView scan before processing external holdings, compares distinct prior weekly snapshots, creates alerts and two-scan confirmation state, and can accept a transient `actual_portfolio` object or `actual_portfolio_csv_path` for recommendation-only drift calculations. Missing or malformed holdings must not prevent the market scan. Duplicate tickers are aggregated; partial cost basis remains unknown. Omitted cash remains unknown; use `allow_additional_funding=true` when external funding or margin buying power may support buys. For a regular taxable brokerage account use `taxable_account=true` and `gradual_reconciliation=true`; treat full-target drift as a destination, stage loss-lot reviews first, and defer or offset gain realization. Never claim exact tax results without acquisition dates and adjusted lot-level basis. Never claim that it persisted holdings/details, borrowed funds, or executed a rebalance. For monthly governance call `income_etf_monthly_review`, render its instruction, and save with `session_save instrument_type="income_etf_monthly_review"`. See `docs/INCOME_ETF_OPERATIONS.md`.

**Chart sharing note:** `crypto` and `crypto_perps` both use the MY-PERPS chart tab (`6y8jPo4Y`). Do NOT run both briefs simultaneously — run one, wait for it to finish, then run the other.

**Step 3 — save brief** (optional):
```
session_save brief="<Claude's output>"
session_get   # retrieve today's or yesterday's saved brief
```

**Precomputed fields (as of `src/core/classify.js`):** each symbol in `symbols_scanned` carries `nw_position` (extended/early/n/a from the most recent NW label — `nw_envelope_signals` is trimmed to 1 label since only the most recent is ever used). **Equity types** (momentum_stocks/etf/ark/sp_ndx/r2k): TWB is NOT on the chart — `hist`/`sig`/`gap`/`bias` are null/n/a; L2 filtering was already done by `lux_screener_scan` (BOS + Bullish S&O + ▲ signal). Use `nw_position` for L3 extension check. `momentum_stocks`/`momentum_etf`/`sp_ndx`/`r2k` carry `momentum_tag` (always 'neutral' without TWB — treat as informational only); `momentum_ark` carries `ark_status` (BASE_BUILDING by default when bias=n/a, EXTENDED when nw_position=extended — BREAKOUT_READY is never auto-assigned, requires manual RS-vs-QQQ check) and `cluster`. **Crypto/perps/futures types**: TWB IS on the chart — `hist`/`sig` (parsed TWB Histogram/Signal, strings normalized to numbers), `gap` (hist − sig), `bias` (bullish/bearish/neutral from gap sign) all populated normally. **crypto and crypto_perps** also carry `sr_resistance`, `sr_support`, `sr_break` from the Support and Resistance Levels with Breaks [LuxAlgo] indicator (null if indicator absent or insufficient data). Use `sr_break > 0` as breakout confirmation overriding NW extension for longs; `sr_resistance` is the dead-cat ceiling for shorts. `futures` carries `regime` (TRENDING_LONG/TRENDING_SHORT/MEAN_REVERTING — single-bar approximation, override with regime_detection/macro_overlays judgment). Use these fields directly instead of re-parsing raw `indicators`/`nw_envelope_signals` strings.

**Brief formatting convention (REQUIRED for `session_save`):**
The `morning_brief` tool's embedded instruction says to output bare pipe-delimited lines (`SYMBOL | BIAS: ... | SIGNAL: ...`). Do NOT save that raw form — it does not render as a table in markdown. Always reshape the analysis into proper GitHub-flavored markdown before calling `session_save`:
- `## {TYPE}` section, then `**Benchmark:**` and `**Theme:**` bullet blocks
- For `momentum_stocks` and `momentum_etf` (large symbol lists): insert a `### Top 20 Setups` table before the full symbol table. Rank the names that passed the Lux BOS + Bullish S&O + ▲ hard filter by Lux score, then use NW position to exclude extended entries. This trade-quality order is separate from the live screener rank. Columns: `| RANK | SYMBOL | S&O RATING | SIGNAL | PAC STRUCTURE | SCORE | NW POSITION |`.
- For `momentum_ark` (lux_screener_scan output, 141 symbols): insert a `### Top 20 Setups` table sorted descending by lux score. Columns: `| RANK | SYMBOL | S&O RATING | SIGNAL | PAC STRUCTURE | SCORE | CLUSTER |`, filtered to **passing symbols only** (score ≥ 0, i.e. BOS + Bullish + ▲). Add a cluster-concentration note below if any correlation cluster (ai_semis/fintech_crypto/autonomy_space/ai_software/genomics) appears more than once, naming the single best pick per cluster.
- A per-symbol **markdown table** with a header row and `|---|` separator: `| SYMBOL | BIAS | SIGNAL | WATCH |` (use `| SYMBOL | S&O RATING | SIGNAL | PAC | SCORE | CLUSTER |` for `momentum_ark`). Precede with a `### Screener List` header and a leading `#` column numbering rows 1-N in watchlist weight order.
- For `futures` specifically, the SIGNAL cell in that table MUST include the literal numeric histogram/signal values in the form `Hist ±X.XX ... sig ±Y.YY` (e.g. `Hist +174.83 still positive, just below sig 293.58 — decelerating`) — never qualitative-only phrasing like `hist+ but decelerating hard`. `scripts/ct_tv_data.py`'s `parse_tv_brief()` regex-parses this exact numeric pattern to compute `tv_gap` for the CT+TV decision pipeline (see `ct-tv-data-format-dependency` memory note); the parser now falls back to a sign-only approximation when the numbers are missing, but real numbers are always preferred and required.
- **`futures` SYMBOL column must contain the bare ticker only** — e.g. `ES1!`, never `ES1! (S&P)` or any other descriptive suffix. `parse_tv_brief()` strips only an `EXCHANGE:` prefix before matching the symbol verbatim against `TV_TO_CT_MARKET`; any trailing text (parenthetical names, notes) makes every symbol in the brief fail to map, silently producing `tv_mapped_count` matches with 100% null `tv_gap` — the validation gate in Step 4 of the morning routine will catch this and refuse to save, but it's cheaper to just not do it.
- **`futures` negative numbers must use the ASCII hyphen-minus `-` (U+002D)** in Hist/sig/gap values — never the typographic minus sign `−` (U+2212) or an en/em dash. `parse_tv_brief()`'s numeric regex character class is `[+-]`, which only matches ASCII; a Unicode minus makes the number invisible to the parser even though it renders identically to a human reader.
- **`futures` must keep the literal `**Benchmark:**` / `**Theme:**` headers** from the generic convention above (line 62) even though futures also carries macro-overlay content (DXY/bonds/VX1! context) — put that content as bullets *under* `**Theme:**` (or its own clearly-separate block before it), don't rename `**Theme:**` to something else like `**Macro overlays:**`. `parse_tv_brief()` locates macro/theme text by searching for those two exact literal strings.
- `### Top 3 Setups` — prose or a table with Entry/Stop/TP1/R:R columns. For `momentum_stocks`/`momentum_etf`/`momentum_ark`, top 3 from the Top 20 table above — not independently re-selected. For `momentum_ark`, note any cluster overlap and swap in next-ranked name from a different cluster if needed.
- `## Overall Market Read` — bullet list
- For `instrument_type="daily_summary"`: lead with a `## Quick Reference` table (Instrument | Direction | Top 3 | Key Action), one short section per instrument, and close with a `## Cross-Market Read` table.
- For `lux_screener_scan` briefs (`sp_ndx`, `r2k`): the scan result includes a `chatter_section` field — always include it as `## Chatter Conflicts & Confluences` after the Top 10 table and before Overall Market Read. Also include it in the daily summary's Cross-Market Read and in the weekly review's chatter callout. If `chatter_section` is empty or says "No notable…", omit the section rather than including a blank header.
- For `lux_screener_scan instrument_type="thematic_stocks"` (full report, saved as `thematic_stocks.md`): output all symbols grouped by theme. Each theme section = `### {Theme} {bias_arrow} ({B}B / {Br}Br / {N} total)` header, then a full markdown table `| SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | HWO | SCORE |` with all symbols sorted score descending. Close with a cross-thematic macro read paragraph.
- For `thematic_stocks` summary (saved with `is_summary=true` as `thematic_stocks-summary.md`): lead with a theme-level summary table `| Theme | Bias | Bull / Bear / Total | Top Names | Best Score |`, then a "Top Picks by Theme" table of all symbols scoring ≥ 5 `| SYMBOL | THEME | S&O RATING | SIGNAL | PAC | OSC DIV | SCORE |`, then an "Avoid" table of bottom 10, then a 2-bullet macro read.
- For `thematic_etfs` summary (saved with `is_summary=true` as `thematic_etfs-summary.md`): lead with a combined rotation table `| ETF Theme | Bias | Leading ETFs | Fading ETFs |` covering all 8 themes, then a "Top ETF Picks" table of bullish ETFs with room to NW band, then an avoid list, then a cross-theme macro read.

The tool auto-prepends the `# {TYPE} Morning Brief` + date header, so the brief body should start at `## {TYPE}`. See `reports/2026-Wk24/2026-Jun-13/` for reference structure.

**Reports folder layout:** `reports/<YYYY-WkNN>/<YYYY-Mon-DD>/<type>.md` — daily reports are nested under an ISO 8601 week folder (Monday-start, year-prefixed so it sorts correctly across year boundaries, e.g. `2026-Wk27`) to keep `reports/` from accumulating hundreds of flat date folders. Income ETF artifacts are the exception: use `reports/inc-etf/<YYYY-WkNN>/` for weekly files and `reports/inc-etf/Mon-review/<YYYY-Mon>/` for monthly reviews. `reports/weekly/` (weekly review narratives) and `reports/archive/` (zipped old weeks) are separate, un-nested top-level folders — not part of this pattern. A weekly scheduled task (`tv-mcp-archive-old-reports`, Sundays) zips and moves week folders older than 8 weeks into `reports/archive/`; see `scripts/archive-old-reports.mjs`.

**Key files:**
- `rules.json` — screener name per instrument type
- `strategy-momentum_stocks.json` — momentum stocks bias/entry/exit rules
- `strategy-crypto.json` — crypto spot bias/entry/exit rules
- `strategy-crypto_perps.json` — crypto perps bias/entry/exit rules (both long AND short)
- `~/.tradingview-mcp/sessions/` — saved daily briefs

**Required indicators on chart** (auto-added if missing):
- Nadaraya-Watson Envelope [LuxAlgo] — all instrument types
- Trendlines with Breaks Oscillator [LuxAlgo] — crypto, crypto_perps, futures only (equity types use lux_screener_scan as L2 filter instead)
- Volume — all instrument types

**NW Envelope note**: Does NOT appear in `data_get_study_values` (it's a price overlay, not an oscillator). Use `data_get_pine_labels` with `study_filter: "Nadaraya-Watson"` to get signal markers: ▲ = price crossed above a band, ▼ = price crossed below. The most recent label (first in array) indicates current band position.

---

## Strategy Reference

### Strategy 1 — Momentum Stocks (`strategy-momentum_stocks.json`)

| | |
|---|---|
| **Screener** | `MOMENTUM` (Stock Screener, US equities) — already filters Price > EMA50 1M |
| **Timeframe** | Weekly (1W) for L2 scan; daily chart context for entry |
| **Pipeline** | L1: MOMENTUM screener → L2: `lux_screener_scan 1W` (BOS + Bullish S&O + ▲ signal hard filter) → L3: NW Envelope extension check per symbol |
| **Side** | Long only. |
| **Indicators** | NW Envelope + Volume (on chart). TWB removed — S&O Signal replaces it at L2. |

**L3 bias (per-symbol NW check):**
- `nw_position = inside` → room to run, valid entry candidate
- `nw_position = extended` (▲) → price above upper NW band, skip
- `nw_position = early` (▼) → price below lower band, avoid

**Entry:** Symbol passed lux_screener_scan + NW inside bands + R:R ≥ 1.5 (NW upper minus price / price minus NW lower)
**Exits:** Stop below NW lower band (weekly). TP1: scale 1/3 at upper NW band. TP2: trail 9-week EMA.
**Risk:** 1% max risk/trade, 1:2 min R:R, max 3 positions.

---

### Strategy 2 — Crypto Spot (`strategy-crypto.json`)

| | |
|---|---|
| **Source** | Static `CSV/CRYPTO.csv` watchlist; `max_symbols: 0` scans the complete list |
| **Timeframe** | Daily bias, 4H entry confirmation |
| **Benchmark** | No hard BTC-SMA gate. Evaluate every symbol on its own TWB + NW + S/R data; use BTC as session context. |
| **Side** | Long only. |
| **Exchange** | Coinbase USD spot pairs generated from the CSV |
| **Universe** | Whatever is present in `CSV/CRYPTO.csv`; no runtime blocklist |

**Bias rules:**
- Long: symbol TWB Histogram positive and above signal, NW not extended, and price above S/R support
- Bonus confirmation: `sr_break > 0` can validate a breakout even when the NW reading is extended
- Skip: negative TWB, an unconfirmed move beyond the upper NW band, or rejection at S/R resistance

**Entry:** Daily TWB positive and above signal + 4H confirmation + volume + NW inside bands, unless `sr_break > 0` confirms the breakout.
**Exits:** Stop below breakout low. TP1: 1/3 at upper NW band. TP2: 1/3 at 2R + trail 4H 9 EMA. TP3: 1/3 if 4H 9 EMA violated for 2 candles. Emergency: BTC −8% intraday → exit ALL.
**Risk:** 2% max/trade, max 3 positions, no averaging down.

---

### Strategy 3 — Crypto Perps (`strategy-crypto_perps.json`)

| | |
|---|---|
| **Source** | Static `CSV/PERPS.csv` watchlist; `max_symbols: 0` scans the complete list |
| **Timeframe** | Daily bias, 4H entry confirmation |
| **Benchmark** | BTC perp **TWB Histogram direction** (not SMA) |
| **Side** | **Both long AND short** depending on BTC TWB signal |
| **Exchange** | Coinbase CDE (USDC-settled perps) |
| **Universe** | Whatever is present in `CSV/PERPS.csv`; no runtime blocklist |

**Benchmark signal rules:**
- BTC TWB Histogram **> 0** → uptrend → scan ALL alts for **LONG** setups
- BTC TWB Histogram **< 0** → downtrend → scan ALL alts for **SHORT** setups
- Histogram crossing zero = highest conviction direction change
- Near zero = neutral zone → skip or reduce size

**Long entry:** BTC TWB positive + symbol TWB positive + above signal line + consolidating near highs + 4H confirms + volume + funding neutral/negative + OI rising
**Short entry:** BTC TWB negative + symbol TWB negative + below signal line + rejection from resistance + 4H confirms + volume + **wait for dead-cat bounce to lower NW band** (never chase initial drop)

**Long exits:** Stop below breakout low. TP1: 1/3 at upper NW band. TP2: 1/3 at 2R + trail 4H 9 EMA. TP3: 4H 9 EMA violated 2 candles.
**Short exits:** Stop above entry high. TP1: 1/3 at lower NW band. TP2: 1/3 at 2R + trail 4H 9 EMA from below. TP3: price closes above 4H 9 EMA for 2 candles.
**Funding exit:** Long: exit if funding >0.1%/hr. Short: exit if funding <−0.05%/hr.
**Emergency:** BTC ±8% intraday → exit ALL.

**Commodity perps:** When SILVER or GOLD is present in the CSV, it is exempt from the BTC benchmark. Use its own TWB signal + DXY direction.

**Risk:** 2% max/trade, max 3 positions, max 3x leverage, no averaging down.

---

## Static CSV Watchlists

- `CSV/CRYPTO.csv`, `CSV/PERPS.csv`, and `CSV/FUTURES.csv` are the source of truth.
- `scripts/build-watchlist-configs.mjs` regenerates the corresponding strategy watchlists.
- The builder preserves every CSV row; there is no hidden runtime blocklist.
- These three strategies use `max_symbols: 0`, so a normal `morning_brief` scans the entire generated watchlist. Callers can still pass `offset` and `max_symbols` explicitly to batch a run.

---

## Crypto Workflow

```
morning_brief instrument_type="crypto"
```
- No crypto screener window is required; symbols come from `CSV/CRYPTO.csv`
- The complete generated watchlist is scanned by default
- No BTC 50-day-SMA gate; apply per-symbol TWB + NW + S/R rules
- Timeframe: Daily for bias, 4H for entry confirmation
- Coinbase USD spot pairs only
- Emergency exit: BTC drops 8%+ intraday → exit ALL positions

## Crypto Perps Workflow

```
morning_brief instrument_type="crypto_perps"
```
- No CEX screener window is required; symbols come from `CSV/PERPS.csv`
- The complete generated watchlist is scanned by default
- Benchmark: BTC perp TWB Histogram direction (positive = longs, negative = shorts)
- Both sides active — brief outputs top 3 LONG or top 3 SHORT candidates
- Commodity perps, when present in the CSV, are evaluated independently of BTC

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Scheduled Tasks

8 scheduled tasks run this project unattended: `futures-morning-routine` (7:30am daily), `decision-email-routine` (8:15am daily), `weekly-scan-routine` (7:43pm weekdays), `weekly-decision-routine` (8:39pm weekdays), `tv-top-setups-report` (8pm weekdays), `tv-mcp-archive-old-reports` (Sun 3am), `income-etf-weekly-routine` (Sat 10am), `income-etf-monthly-review-routine` (1st Sun 11am). `weekly-decision-routine-oneshot` is a ninth, manual-trigger-only duplicate for forcing a re-run without waiting on the cron (e.g. to resend after a bug fix).

**Version control:** the live SKILL.md a scheduler actually executes lives at `~/.claude/scheduled-tasks/<name>/SKILL.md`, outside this repo and outside git. This repo holds the canonical, version-controlled copy at `scripts/scheduled-tasks/<name>.md` — that copy is the source of truth. After editing one, run `scripts/scheduled-tasks/sync-to-claude.ps1` (PowerShell) to push it to the live location; the scheduler never reads the repo copy directly, so an edit made only here has no effect until the sync script runs. Symlinking instead of copying was tried and rejected — this machine requires admin/Developer Mode for `New-Item -ItemType SymbolicLink`.

**Shared render scripts** (all emit Gmail-safe HTML — plain `border`/`cellpadding`/`bgcolor` attributes, never CSS `background`, since Gmail's send pipeline strips `<style>` blocks, `class` attributes, and any inline `style="...background..."`, confirmed 2026-08-15):
- `scripts/decision-classify.mjs` + `scripts/decision-render.mjs` — the 7 weekly equity decision emails. Classification is fully mechanical (setup_quality/entry_quality/eligibility from scan JSON), so both steps are scripted.
- `scripts/daily-decision-render.mjs` — the 3 daily crypto/crypto_perps/futures decision emails. Only the render step is scripted; classification stays with the LLM (strategy rules like crypto_perps' "consolidating near highs" pattern read are genuine judgment calls, not mechanical thresholds) — the LLM writes a small decisions JSON (see decision-email-routine's SKILL.md for the schema) instead of hand-typing HTML, and this script turns that into the email body.
- `scripts/md-to-html.mjs` — generic markdown→HTML converter (headers, bold, bullets, pipe tables) for reports that are already pure markdown with no per-row color-coding need: `income-etf-weekly-routine` and `income-etf-monthly-review-routine` both save a `.md` report first, then run this to produce the email body.

Retired: `ark-weekly-brief` and `weekly-equity-brief` (predecessors to the weekly-scan/decision-routine split, deleted 2026-08-15 — not on any cron, fully superseded).

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`
