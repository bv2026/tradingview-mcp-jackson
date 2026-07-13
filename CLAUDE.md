# TradingView MCP — Claude Instructions

84 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222).

## Morning Workflow (primary daily use)

Three independent briefs — run each in its own TradingView screener window:

```
morning_brief instrument_type="momentum_stocks" # equity momentum
morning_brief instrument_type="crypto"       # crypto spot (Coinbase)
morning_brief instrument_type="crypto_perps" # crypto perps (Coinbase CDE)
```

**Step 1 — sync screener** (when TV screener results change during the day):
```
screener_get screener_name="MOMENTUM" max_symbols=10
screener_get screener_name="MOMENTUM-CRYPTO" max_symbols=9
screener_get screener_name="MOMENTUM-PERPS" max_symbols=12
```

**Step 2 — run brief** — pulls live symbols, scans each symbol, returns structured data for Claude to apply strategy rules.

**Step 3 — save brief** (optional):
```
session_save brief="<Claude's output>"
session_get   # retrieve today's or yesterday's saved brief
```

**Precomputed fields (as of `src/core/classify.js`):** each symbol in `symbols_scanned` already carries `hist`/`sig` (parsed TWB Histogram/Signal, comma/unicode-minus/bond-tick strings normalized to numbers), `gap` (hist − sig), `bias` (bullish/bearish/neutral from gap sign), and `nw_position` (extended/early/n/a from the most recent NW label — `nw_envelope_signals` is trimmed to 1 label since only the most recent is ever used). `momentum_stocks`/`momentum_etf`/`sp_ndx`/`r2k` also carry `momentum_tag` (bullish-early/bullish-extended/bearish-neutral/neutral); `momentum_ark` carries `ark_status` (BASE_BUILDING/EXTENDED/SKIP — BREAKOUT_READY is never auto-assigned, it still requires the RS-vs-QQQ check by hand) and `cluster`; `futures` carries `regime` (TRENDING_LONG/TRENDING_SHORT/MEAN_REVERTING — a single-bar approximation, override with regime_detection/macro_overlays/cross-report judgment as before). Use these fields directly for the GAP sort and tables below instead of re-parsing the raw `indicators`/`nw_envelope_signals` strings.

**Brief formatting convention (REQUIRED for `session_save`):**
The `morning_brief` tool's embedded instruction says to output bare pipe-delimited lines (`SYMBOL | BIAS: ... | SIGNAL: ...`). Do NOT save that raw form — it does not render as a table in markdown. Always reshape the analysis into proper GitHub-flavored markdown before calling `session_save`:
- `## {TYPE}` section, then `**Benchmark:**` and `**Theme:**` bullet blocks
- For `momentum_stocks`, `momentum_etf`, and `momentum_ark` (large symbol lists mixing bullish/bearish/neutral, or BASE_BUILDING/BREAKOUT_READY/EXTENDED/SKIP for ark): insert a `### Top 20 Setups` table here, before the full symbol table. Sorted descending by `GAP` (TWB Histogram − Signal — strongest divergence first). This is a trade-quality ranking, NOT the same as the underlying screener's own live rank (MOMENTUM/MOMENTUM-ETF/MOMENTUM-ARK have their own sort/filters — see `config/screeners/MOMENTUM.md` / `MOMENTUM-ETF.md` / `MOMENTUM-ARK.md`). State this distinction in one line above the table so readers don't confuse the two orderings.
  - For `momentum_stocks`/`momentum_etf`: columns `| RANK | SYMBOL | TWB HIST | TWB SIG | GAP | CLOSE | NW POSITION |`, filtered to **Bullish-biased symbols only**.
  - For `momentum_ark`: columns `| RANK | SYMBOL | STATUS | TWB HIST | TWB SIG | GAP | CLOSE | CLUSTER |`, filtered to **BASE_BUILDING/BREAKOUT_READY status only** (EXTENDED and SKIP excluded — not fresh entries). Add a cluster-concentration note below the table if any correlation cluster (ai_semis/fintech_crypto/autonomy_space/ai_software/genomics) appears more than once, naming the single best pick per cluster per the cluster_rule.
- A per-symbol **markdown table** with a header row and `|---|` separator: `| SYMBOL | BIAS | SIGNAL | WATCH |` (use `| SYMBOL | STATUS | RS | SIGNAL | CLUSTER |` for `momentum_ark`). This table keeps the screener's own live rank order (i.e., do NOT re-sort it to match the Top 20 table above — the Top 20 table is a separate curated view, the full table is the raw scan in screener order). Precede this table with a `### Screener List` header and add a leading `#` column numbering each row 1-N in screener rank order.
- `### Top 3 Setups` — prose or a table with Entry/Stop/TP1/R:R columns. For `momentum_stocks`/`momentum_etf`/`momentum_ark`, these should be the top 3 from the Top 20 Setups table above (same trade-quality ranking, deepest tier) — not independently re-selected. For `momentum_ark`, note any cluster overlap among the top 3 and swap in the next-ranked name from a different cluster if needed to respect the max-1-per-cluster rule.
- `## Overall Market Read` — bullet list
- For `instrument_type="daily_summary"`: lead with a `## Quick Reference` table (Instrument | Direction | Top 3 | Key Action), one short section per instrument, and close with a `## Cross-Market Read` table.
- For `lux_screener_scan` briefs (`sp_ndx`, `r2k`): the scan result includes a `chatter_section` field — always include it as `## Chatter Conflicts & Confluences` after the Top 10 table and before Overall Market Read. Also include it in the daily summary's Cross-Market Read and in the weekly review's chatter callout. If `chatter_section` is empty or says "No notable…", omit the section rather than including a blank header.
- For `lux_screener_scan instrument_type="thematic_stocks"` (full report, saved as `thematic_stocks.md`): output all symbols grouped by theme. Each theme section = `### {Theme} {bias_arrow} ({B}B / {Br}Br / {N} total)` header, then a full markdown table `| SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | HWO | SCORE |` with all symbols sorted score descending. Close with a cross-thematic macro read paragraph.
- For `thematic_stocks` summary (saved with `is_summary=true` as `thematic_stocks-summary.md`): lead with a theme-level summary table `| Theme | Bias | Bull / Bear / Total | Top Names | Best Score |`, then a "Top Picks by Theme" table of all symbols scoring ≥ 5 `| SYMBOL | THEME | S&O RATING | SIGNAL | PAC | OSC DIV | SCORE |`, then an "Avoid" table of bottom 10, then a 2-bullet macro read.
- For `thematic_etfs` summary (saved with `is_summary=true` as `thematic_etfs-summary.md`): lead with a combined rotation table `| ETF Theme | Bias | Leading ETFs | Fading ETFs |` covering all 8 themes across both halves, then a "Top ETF Picks" table of bullish ETFs with room to NW band, then an avoid list, then a cross-theme macro read.

The tool auto-prepends the `# {TYPE} Morning Brief` + date header, so the brief body should start at `## {TYPE}`. See `reports/2026-Wk24/2026-Jun-13/` for reference structure.

**Reports folder layout:** `reports/<YYYY-WkNN>/<YYYY-Mon-DD>/<type>.md` — daily reports are nested under an ISO 8601 week folder (Monday-start, year-prefixed so it sorts correctly across year boundaries, e.g. `2026-Wk27`) to keep `reports/` from accumulating hundreds of flat date folders. `reports/weekly/` (weekly review narratives) and `reports/archive/` (zipped old weeks) are separate, un-nested top-level folders — not part of this pattern. A weekly scheduled task (`tv-mcp-archive-old-reports`, Sundays) zips and moves week folders older than 8 weeks into `reports/archive/`; see `scripts/archive-old-reports.mjs`.

**Key files:**
- `rules.json` — screener name per instrument type
- `strategy-momentum_stocks.json` — momentum stocks bias/entry/exit rules
- `strategy-crypto.json` — crypto spot bias/entry/exit rules
- `strategy-crypto_perps.json` — crypto perps bias/entry/exit rules (both long AND short)
- `~/.tradingview-mcp/sessions/` — saved daily briefs

**Required indicators on chart** (auto-added if missing):
- Trendlines with Breaks Oscillator [LuxAlgo]
- Nadaraya-Watson Envelope [LuxAlgo]
- Volume

**NW Envelope note**: Does NOT appear in `data_get_study_values` (it's a price overlay, not an oscillator). Use `data_get_pine_labels` with `study_filter: "Nadaraya-Watson"` to get signal markers: ▲ = price crossed above a band, ▼ = price crossed below. The most recent label (first in array) indicates current band position.

---

## Strategy Reference

### Strategy 1 — Momentum Stocks (`strategy-momentum_stocks.json`)

| | |
|---|---|
| **Screener** | `MOMENTUM` (Stock Screener, US equities) |
| **Timeframe** | Daily |
| **Benchmark** | SPY / QQQ above 50-day SMA → longs only |
| **Side** | Long only. No shorts (future work). |
| **Indicators** | TWB Oscillator + NW Envelope + Volume |

**Bias rules:**
- Bullish: HH/HL pattern + TWB bullish breakout + volume surge + approaching (not outside) upper NW band + catalyst
- Bearish: LL/LH + TWB breakdown + price back below trendline → exit/avoid longs only
- Neutral: consolidation, no breakout, below-average volume

**Entry:** Flag/pennant near highs + TWB bullish B signal + volume + NW band not extended
**Exits:** Stop below breakout candle low. TP1: upper NW band (scale 1/2–1/3). TP2: trail 9 EMA.
**Risk:** 1% max risk/trade, 1:2 min R:R, max 3 positions, no entry if SPY/QQQ below 50d SMA.

---

### Strategy 2 — Crypto Spot (`strategy-crypto.json`)

| | |
|---|---|
| **Screener** | `MOMENTUM-CRYPTO` (Crypto Coins Screener, Coinbase large caps >$5B mcap, >$100M vol) |
| **Timeframe** | Daily bias, 4H entry confirmation |
| **Benchmark** | BTC above 50-day SMA → longs only. BTC below 50d SMA → all alts neutral/bearish. |
| **Side** | Long only (spot + max 3x futures). No shorts. |
| **Exchange** | Coinbase only. Non-Coinbase coins → SKIP. |
| **Universe** | BTC, ETH, SOL, XRP, DOGE, ZEC, ADA, LINK, XLM (9 coins after blocklist) |

**Bias rules:**
- Bullish: BTC above 50d SMA + HH/HL + TWB bullish + volume + approaching upper NW band + catalyst
- Bearish: BTC below 50d SMA → avoid all alt longs
- Neutral: BTC consolidating near 50d SMA, no TWB signal, chop

**Entry:** Consolidation near highs + Daily TWB bullish + 4H TWB confirms + volume + NW not extended
**Exits:** Stop below breakout low. TP1: 1/3 at upper NW band. TP2: 1/3 at 2R + trail 4H 9 EMA. TP3: 1/3 if 4H 9 EMA violated for 2 candles. Emergency: BTC −8% intraday → exit ALL.
**Risk:** 2% max/trade, max 3 positions, max 3x leverage on futures, no averaging down.

---

### Strategy 3 — Crypto Perps (`strategy-crypto_perps.json`)

| | |
|---|---|
| **Screener** | `MOMENTUM-PERPS` (CEX Screener, Coinbase, Perpetual, USDC, >$1M vol) |
| **Timeframe** | Daily bias, 4H entry confirmation |
| **Benchmark** | BTC perp **TWB Histogram direction** (not SMA) |
| **Side** | **Both long AND short** depending on BTC TWB signal |
| **Exchange** | Coinbase CDE (USDC-settled perps) |
| **Universe** | ~12 clean crypto + SILVER + GOLD after blocklist |

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

**Commodity perps (SILVER, GOLD):** Exempt from BTC benchmark. Use their own TWB signal + DXY direction. Positive TWB + DXY weakening = long. Negative TWB + DXY strengthening = short.

**Risk:** 2% max/trade, max 3 positions, max 3x leverage, no averaging down.

---

## Screener Blocklists (enforced in code)

### Crypto Spot blocklist (`CRYPTO_BLOCKLIST` in `src/core/screener.js`)
Removes: stablecoins (USDT/USDC/DAI), wrapped tokens (WBTC/WETH), tokenized gold (XAUT/PAXG), BNB, XMR, TRX

### Perps blocklist (`PERPS_BASE_BLOCKLIST` in `src/core/screener.js`)
Removes by base ticker:
- **Stocks/ETFs:** META, TSLA, GOOGL, INTC, AMZN, SPY, NVDA, AAPL, MSFT, MU, AMD, ARM, QQQ, ROBO, NBIS
- **Fiat:** EURC, USDT, USDC, DAI
- **Meme/micro:** PUMP, BILL, 1000SHIB, 1000PEPE, MEME, SNDK, CBRS, MERL, W
- **Low quality:** HYPE, CRV, BE
- **Keeps:** SILVER, GOLD, PAXG (commodity perps intentionally included)

---

## Crypto Workflow

```
morning_brief instrument_type="crypto"
```
- Screener window must be open in TradingView — separate CDP target at `tradingview.com/crypto-coins-screener/`
- Benchmark: BTC above 50-day SMA required for any alt bullish bias
- Timeframe: Daily for bias, 4H for entry confirmation
- Spot + futures (max 3x leverage), Coinbase only
- Emergency exit: BTC drops 8%+ intraday → exit ALL positions

## Crypto Perps Workflow

```
morning_brief instrument_type="crypto_perps"
```
- Screener window must be open — separate CDP target at `tradingview.com/cex-screener/`
- Benchmark: BTC perp TWB Histogram direction (positive = longs, negative = shorts)
- Both sides active — brief outputs top 3 LONG or top 3 SHORT candidates
- Commodity perps (SILVER, GOLD) evaluated independently of BTC signal

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

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`
