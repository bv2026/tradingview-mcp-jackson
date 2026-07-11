# TradingView MCP — Prompt Cheat Sheet

Quick reference for the daily/weekly trading workflow. Prompts are what you type to Claude; scripts are what you (or Claude) run in a terminal.

---

## 🗓️ Daily routine (market days)

| Goal | Prompt |
|---|---|
| **Run all briefs + thematic reports + daily summary** | `morning brief all` |
| Single core brief | `morning brief momentum_stocks` (or `momentum_etf`, `momentum_ark`, `crypto`, `crypto_perps`, `futures`) |
| Single momentum brief | `morning brief sp_ndx` (or `r2k`) |
| Thematic stocks scan (121 symbols) | `lux screener scan thematic_stocks` |
| Thematic ETF scan | `morning brief thematic_etfs_1` then `morning brief thematic_etfs_2` |
| Read back a saved brief | `get the momentum_stocks brief` (or any type) |
| Read today's daily summary | `get the daily summary` |

> `all` covers **all 8 standard** instruments (momentum_stocks, momentum_etf, momentum_ark, crypto, crypto_perps, futures, sp_ndx, r2k) **plus thematic reports**: lux_screener_scan thematic_stocks (121 symbols → `thematic_stocks.md` + `thematic_stocks-summary.md`), morning_brief thematic_etfs_1 + thematic_etfs_2 (`thematic_etfs_1.md`, `thematic_etfs_2.md`, `thematic_etfs-summary.md`), and a final `daily-summary.md`.
>
> Large screeners (momentum_stocks/momentum_etf/momentum_ark, ~100 symbols each) can exceed the tool's ~60-70s timeout on a plain call — batch with `offset`/`max_symbols` (e.g. `offset=0 max_symbols=50` then `offset=50 max_symbols=50`) if a call times out. The `all` workflow instruction batches these three automatically.

**Reports land in:** `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/` (daily reports are nested under an ISO 8601 week folder, e.g. `reports/2026-Wk27/2026-Jul-03/`)

| File | Contents |
|---|---|
| `{type}.md` | Full brief per instrument |
| `thematic_stocks.md` | All 121 stocks, grouped by theme, with all LuxAlgo signals |
| `thematic_stocks-summary.md` | Theme-level table + top picks (score ≥ 5) + avoid list |
| `thematic_etfs_1.md` / `thematic_etfs_2.md` | Full ETF briefs (49 + 41 ETFs) |
| `thematic_etfs-summary.md` | Combined ETF rotation summary across all 8 themes |
| `daily-summary.md` | Quick-reference 4-line block per instrument (all types) |

---

## 📅 Weekly routine (Saturdays)

Run these terminal commands, then ask Claude to narrate:

```bash
node scripts/build-weekly-review.mjs       # consolidate Mon–Fri across all instruments
node scripts/build-momentum-watchlists.mjs # rebuild sp_ndx + r2k from the week's CSVs
node scripts/build-watchlist-configs.mjs   # rebuild thematic_stocks + thematic_etfs_1/_2 (if CSVs changed)
```

| Goal | Prompt |
|---|---|
| Narrate the weekly review (after running the script) | see full prompt below |
| Read back a weekly review | `get the weekly review for W26` |

**Weekly narrative prompt** (paste after running `build-weekly-review.mjs`):
```
Look in C:\work\tradingview-mcp-jackson\reports\weekly\ and find the most recent
*-data.json file that does NOT yet have a matching *.md file — that is this week's
data bundle. Read it, then write the narrative to the same folder with the same
week tag (e.g. if the bundle is 2026-W26-data.json, write 2026-W26.md).

For style reference, read the most recent *.md that already exists in that folder.

Structure the report as:

## Week {N} Review ({YEAR})

One short section per instrument that had data. For each:
- **Top 3 setups** — highest conviction names (most days flagged, strong accel_seq,
  positive follow-through in pct_move)
- **Names to avoid** — weak/mixed conviction or negative follow-through
- A 1-2 sentence market read for that instrument

Close with:
## Cross-Market Read
3-5 bullets on themes consistent across instruments this week.
```

> `build-weekly-review.mjs` writes the data bundle to `reports/weekly/{YYYY-Www}-data.json`; Claude then writes `reports/weekly/{YYYY-Www}.md`.
> `build-momentum-watchlists.mjs` auto-picks the newest dated CSVs from `CSV/` (momentum-sp500, momentum-nasdaq100, momentum-russell2000, market-chatter) and rewrites `config/strategy-sp_ndx.json` and `config/strategy-r2k.json`. **No restart needed.**

---

## 🧩 The three brief families

| | **Core** (6) | **Momentum** (2) | **Thematic** (3) |
|---|---|---|---|
| Source | Live TradingView MOMENTUM screeners | Weekly CSV exports | Weekly CSV watchlists |
| Refresh | Live, every run | Weekly (Saturday script) | Weekly (Saturday script) |
| Types | momentum_stocks, momentum_etf, momentum_ark, crypto, crypto_perps, futures | sp_ndx, r2k | thematic_stocks (lux scan), thematic_etfs_1/_2 |
| In `all` run? | ✅ Yes | ✅ Yes | ✅ Yes |
| Extra signal | — | Retail sentiment / WTD / watchers / chatter | LuxAlgo S&O+PAC+OSC scores (stocks); TWB+NW+Vol grouped by theme (ETFs) |
| Summary file? | — | — | ✅ `thematic_stocks-summary.md`, `thematic_etfs-summary.md` |

### Watchlist recommended cadence

- **Saturday:** drop 4 dated CSVs into `CSV/`, then `node scripts/build-momentum-watchlists.mjs` — rebuilds sp_ndx + r2k watchlists + chatter annotations.
- **Saturday (if thematic watchlists changed):** update `CSV/Watchlist_Stocks.csv` and/or `CSV/Watchlist_ETFs.csv`, then `node scripts/build-watchlist-configs.mjs` — regenerates all thematic configs (stocks + etfs_1 + etfs_2).
- **Daily (Mon–Fri):** `morning brief all` — runs everything: all 8 core/momentum briefs + thematic_stocks LuxAlgo scan (121 symbols) + thematic_etfs_1/_2 + all summary files + daily-summary.
- By Thu/Fri the weekly data is stale vs price — the live `morning brief momentum_stocks` (core) provides fresher mid-week discovery.

---

## 🔬 LuxAlgo batch screener scan

Scans a watchlist through 3 LuxAlgo screeners (S&O, PAC, OSC) on the **LUXALGO_SCREENERS** chart tab and returns a ranked table + top 10 / bottom 10.

```
lux screener scan sp_ndx          # S&P 500 + Nasdaq 100 momentum (40 names, current week)
lux screener scan r2k              # Russell 2000 momentum (25 names, current week)
lux screener scan thematic_stocks  # Full thematic watchlist (121 stocks, 8 themes, grouped output)
```

**Score = S&O rating (+3/+2/0/−2) + Signal (+2/+1/−1) + OSC Div (+2/−2) + HWO (+1/−1) + PAC Structure (+1/−2)**
Top 10 = highest score. Bottom 10 = lowest score. For `thematic_stocks`, output is grouped by theme with per-theme bullish/bearish count. Saves to `reports/{date}/{type}.md`.

**Watchlist sources:**
| Type | Source |
|---|---|
| `sp_ndx` | `CSV/momentum-sp500-*.csv` + `CSV/momentum-nasdaq100-*.csv` — IN symbols combined |
| `r2k` | `CSV/momentum-russell2000-*.csv` — IN symbols |
| `thematic_stocks` | `CSV/Watchlist_Stocks.csv` — all 121 symbols, 8 themes, rebuilt via `build-watchlist-configs.mjs` |

**Prerequisites:** LUXALGO_SCREENERS tab must be open in TradingView with all 3 screeners (S&O, PAC, OSC) loaded and healthy (no "!" error icons). If they show errors after a code change, delete and re-add them from the Indicators search dialog.

---

## 🗂️ Thematic reports

### Thematic Stocks — 121 symbols, 8 themes (LuxAlgo scan)

```
lux screener scan thematic_stocks  # 121 stocks grouped by theme, S&O+PAC+OSC scores
```

Runs via `lux_screener_scan` (not `morning_brief`). Output: full per-symbol table by theme + top 10 / bottom 10. Auto-generates two files when run as part of `all`:
- `thematic_stocks.md` — all 121 symbols with every signal
- `thematic_stocks-summary.md` — theme-level table + top picks (score ≥ 5) + avoid list

**Watchlist source:** `CSV/Watchlist_Stocks.csv` → `config/strategy-thematic_stocks.json`  
**Rebuild:** `node scripts/build-watchlist-configs.mjs`

### Thematic ETFs — ~90 ETFs, 8 themes (TWB+NW+Vol, weekly TF)

```
morning brief thematic_etfs_1      # AI semis + AI power/grid + Healthcare + Financials (~49 ETFs)
morning brief thematic_etfs_2      # Crypto + Industrials/defense + Energy + Consumer + Space (~41 ETFs)
```

Split into two halves to avoid MCP timeout on weekly scans. Auto-generates three files when run as part of `all`:
- `thematic_etfs_1.md` + `thematic_etfs_2.md` — full per-ETF analysis by theme
- `thematic_etfs-summary.md` — combined rotation summary across all 8 ETF themes

**Watchlist source:** `CSV/Watchlist_ETFs.csv` → `config/strategy-thematic_etfs_1.json` + `strategy-thematic_etfs_2.json`  
**Rebuild:** `node scripts/build-watchlist-configs.mjs` (when watchlist changes)

> The single `thematic_etfs` type (full 90-ETF list) exists in the enum but will time out — always use `_1`/`_2` split. The summary is saved under `thematic_etfs` type.

---

## ⚙️ When a restart is needed

A **Claude Desktop restart** is required only after **code changes** to the MCP server (e.g. adding a new instrument type to the tool enums). It is **NOT** needed for:
- Running any brief
- Rebuilding watchlists (`build-momentum-watchlists.mjs`, `build-watchlist-configs.mjs`)
- Running the weekly review

If a brief is rejected with an "invalid enum value" error for a new instrument type → the server hasn't loaded the new code yet → restart Claude Desktop.

---

## 🔍 Ad-hoc chart prompts (any time)

| Goal | Prompt |
|---|---|
| What's on my chart now | `what's on my chart` → symbol, timeframe, indicators |
| Current indicator values | `read the study values` |
| Price levels / labels from Pine indicators | `show the pine levels` / `show the pine labels` |
| Switch symbol / timeframe | `set chart to NVDA` / `set timeframe to 4H` |
| Sync a screener's symbols | `screener get MOMENTUM` (or MOMENTUM-CRYPTO, MOMENTUM-PERPS, MOMENTUM-ETF, MOMENTUM-ARK) |
| Screenshot | `screenshot the chart` |
| Is TradingView running? | `health check` / `launch TradingView` |

---

## 🧠 How a brief works (so the output makes sense)

1. **Layer 1 — universe:** live screener (core) or static watchlist (StockTwits) supplies the symbols.
2. **Layer 2 — scan:** for each symbol the chart loads TWB Oscillator + Nadaraya-Watson Envelope + Volume, behind liveness/echo guards (every symbol gets a `fresh` flag).
3. **Layer 3 — bias:** Claude applies the strategy rules (benchmark gate → bias → entry/exit) and writes the brief.

**Key signals:** TWB Histogram **>** Signal = momentum accelerating; NW ▲ = price crossed above a band (extended), ▼ = crossed below. Benchmark gate must pass (SPY/QQQ > 50d for equities; BTC TWB direction for crypto) before any longs.

---

## 📁 Where things live

| Thing | Path |
|---|---|
| Daily reports | `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/` |
| Weekly reviews | `reports/weekly/` |
| Old week folders (8+ weeks) | zipped into `reports/archive/` by the Sunday `tv-mcp-archive-old-reports` task |
| Strategy rules per type | `config/strategy-{type}.json` |
| Screener/chart-tab config | `config/rules.json` |
| Scripts | `scripts/build-momentum-watchlists.mjs`, `scripts/build-watchlist-configs.mjs`, `scripts/build-weekly-review.mjs` |
| Raw scan data | `~/.tradingview-mcp/sessions/{date}-{type}.json` — one file per day per instrument; batched calls (offset 0, 50, ...) merge by symbol into the same file rather than overwriting, so the weekly review always sees the full day's scan |
| Momentum source CSVs | `CSV/momentum-sp500-*.csv`, `CSV/momentum-nasdaq100-*.csv`, `CSV/momentum-russell2000-*.csv`, `CSV/market-chatter-*.csv` |
| Thematic watchlist CSVs | `CSV/Watchlist_Stocks.csv`, `CSV/Watchlist_ETFs.csv` |
