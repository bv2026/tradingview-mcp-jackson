# TradingView MCP — Prompt Cheat Sheet

Quick reference for the daily/weekly trading workflow. Prompts are what you type to Claude; scripts are what you (or Claude) run in a terminal.

---

## 🗓️ Daily routine (market days)

| Goal | Prompt |
|---|---|
| **Run all briefs + thematic reports + daily summary** | `morning brief all` |
| Single core brief | `morning brief momentum_stocks` (or `momentum_etf`, `crypto`, `crypto_perps`, `futures`) |
| ARK Innovation scan | `lux screener scan momentum_ark` |
| S&P/Nasdaq momentum scan | `lux screener scan sp_ndx` |
| Russell 2000 momentum scan | `lux screener scan r2k` |
| Thematic stocks scan | `lux screener scan thematic_stocks` |
| Thematic ETF scan | `lux screener scan thematic_etfs` |
| Read back a saved brief | `get the momentum_stocks brief` (or any type) |
| Read today's daily summary | `get the daily summary` |

> `all` covers the core morning briefs plus the watchlist/thematic reports via `lux_screener_scan`: `momentum_ark`, `thematic_stocks`, `thematic_etfs`, and a final `daily-summary.md`.
>
> Large screeners (momentum_stocks/momentum_etf, ~100 symbols each) can exceed the tool's ~60-70s timeout on a plain call — batch with `offset`/`max_symbols` (e.g. `offset=0 max_symbols=50` then `offset=50 max_symbols=50`) if a call times out. The `all` workflow instruction batches these two automatically.

**Reports land in:** `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/` (daily reports are nested under an ISO 8601 week folder, e.g. `reports/2026-Wk27/2026-Jul-03/`)

| File | Contents |
|---|---|
| `{type}.md` | Full brief per instrument (core types via morning_brief, watchlist types via lux_screener_scan) |
| `thematic_stocks.md` | All themed stocks, grouped by theme, with all LuxAlgo signals |
| `thematic_stocks-summary.md` | Theme-level table + top picks (score ≥ 5) + avoid list |
| `thematic_etfs.md` | Full ETF scan across the theme set, LuxAlgo S&O+PAC+OSC scores |
| `thematic_etfs-summary.md` | ETF rotation summary across all 8 themes |
| `daily-summary.md` | Quick-reference 4-line block per instrument (all types) |

---

## 📅 Weekly cadence

| Day | What runs | Instruments |
|-----|-----------|-------------|
| **Saturday** | Rebuild watchlists (scripts below) | sp_ndx, r2k, ARK lists refreshed |
| **Sunday 8:00 AM ET** | **Sunday brief** — LuxAlgo 1W scan on all weekly equity/ETF types | momentum_stocks, momentum_etf, momentum_ark, sp_ndx, r2k, thematic_stocks, thematic_etfs |
| **Mon–Fri** | **Daily brief** — short-term trading instruments only | crypto, crypto_perps, futures |

**Sunday brief prompts** (run in order on Sunday morning):
```
lux screener scan momentum_stocks timeframe=1W
lux screener scan momentum_etf timeframe=1W
lux screener scan momentum_ark timeframe=1W
lux screener scan sp_ndx timeframe=1W
lux screener scan r2k timeframe=1W
lux screener scan thematic_stocks timeframe=1W
lux screener scan thematic_etfs timeframe=1W
```

**Saturday scripts** — run these terminal commands, then ask Claude to narrate:

```bash
node scripts/build-weekly-review.mjs       # consolidate Mon–Fri across all instruments
node scripts/build-momentum-watchlists.mjs # rebuild sp_ndx + r2k from the week's CSVs
node scripts/build-watchlist-configs.mjs   # rebuild thematic_stocks + thematic_etfs + momentum_ark (if CSVs changed)
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

| | **Core** (5) | **Watchlist — lux scan** (5) |
|---|---|---|
| Source | Live TradingView MOMENTUM screeners | Static CSV watchlists → lux_screener_scan |
| Refresh | Live, every run | Weekly (Saturday script) |
| Types | momentum_stocks, momentum_etf, crypto, crypto_perps, futures | momentum_ark, sp_ndx, r2k, thematic_stocks, thematic_etfs |
| Entry point | `morning_brief` | `lux_screener_scan` |
| In `all` run? | ✅ Yes | ✅ Yes |
| Extra signal | — | LuxAlgo S&O+PAC+OSC scores; chatter annotations (sp_ndx/r2k); ARK clusters |
| Summary file? | — | ✅ `thematic_stocks-summary.md`, `thematic_etfs-summary.md` |

### Watchlist recommended cadence

- **Saturday:** drop 4 dated CSVs into `CSV/`, then `node scripts/build-momentum-watchlists.mjs` — rebuilds sp_ndx + r2k watchlists + chatter annotations.
- **Saturday (if watchlists changed):** update `CSV/Watchlist_Stocks.csv`, `CSV/Watchlist_ETFs.csv`, and/or `CSV/Watchlist_ARK.csv`, then `node scripts/build-watchlist-configs.mjs` — regenerates all three configs (`thematic_stocks.json` + `thematic_etfs.json` + `strategy-momentum_ark.json`).
- **Sunday:** run the 7-instrument LuxAlgo 1W scan batch (see Sunday brief table above) — this is the weekly action plan.
- **Mon–Fri:** `morning brief crypto` / `morning brief crypto_perps` / `morning brief futures` — short-term trading only. Add `morning brief momentum_stocks` or `momentum_etf` mid-week if you want a fresher equity read.

---

## 🔬 LuxAlgo batch screener scan

Scans a watchlist through 3 LuxAlgo screeners (S&O, PAC, OSC) on the **LUXALGO_SCREENERS** chart tab and returns a ranked table + top 10 / bottom 10.

```
lux screener scan sp_ndx          # S&P 500 + Nasdaq 100 momentum (40 names, current week)
lux screener scan r2k              # Russell 2000 momentum (25 names, current week)
lux screener scan thematic_stocks  # Full thematic watchlist (121 stocks, 8 themes, grouped output)
```

**Hard filter (all 3 required to pass):** S&O Rating = Bullish or Strong Bullish · PAC Structure = BOS (any count) · Signal = ▲ or ▲+. Symbols failing any filter get score −99. **Sort score for passing symbols:** ▲+ signal (+1) + BOS count (BOS(3) = 3 pts) + Bullish OSC divergence (+1 tiebreaker). Top 10 = highest score. For `thematic_stocks`, output is grouped by theme. Saves to `reports/{date}/{type}.md`.

**Watchlist sources:**
| Type | Source |
|---|---|
| `sp_ndx` | `CSV/momentum-sp500-*.csv` + `CSV/momentum-nasdaq100-*.csv` — IN symbols combined |
| `r2k` | `CSV/momentum-russell2000-*.csv` — IN symbols |
| `thematic_stocks` | `CSV/Watchlist_Stocks.csv` — themed stock watchlist rebuilt via `build-watchlist-configs.mjs` |

**Prerequisites:** LUXALGO_SCREENERS tab must be open in TradingView with all 3 screeners (S&O, PAC, OSC) loaded and healthy (no "!" error icons). If they show errors after a code change, delete and re-add them from the Indicators search dialog.

---

## 🗂️ Thematic reports

### Thematic Stocks

```
lux screener scan thematic_stocks  # themed stock watchlist grouped by theme, S&O+PAC+OSC scores
```

Runs via `lux_screener_scan` (not `morning_brief`). Output: full per-symbol table by theme + top 10 / bottom 10. Auto-generates two files when run as part of `all`:
- `thematic_stocks.md` — all themed symbols with every signal
- `thematic_stocks-summary.md` — theme-level table + top picks (score ≥ 5) + avoid list

**Watchlist source:** `CSV/Watchlist_Stocks.csv` → `config/strategy-thematic_stocks.json`  
**Rebuild:** `node scripts/build-watchlist-configs.mjs`

### Thematic ETFs

```
lux screener scan thematic_etfs    # ETFs grouped by theme, LuxAlgo scores
```

Runs via `lux_screener_scan` (same pipeline as thematic_stocks). Auto-generates two files when run as part of `all`:
- `thematic_etfs.md` — full per-ETF table grouped by theme with S&O/PAC/OSC signals and scores
- `thematic_etfs-summary.md` — rotation summary across all 8 ETF themes

**Watchlist source:** `CSV/Watchlist_ETFs.csv` → `config/strategy-thematic_etfs.json`  
**Rebuild:** `node scripts/build-watchlist-configs.mjs` (when watchlist changes)

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
| Sync a live screener's symbols | `screener get MOMENTUM` or `screener get MOMENTUM-ETF` |
| Rebuild static watchlists | `node scripts/build-watchlist-configs.mjs` after editing the CSV source |
| Screenshot | `screenshot the chart` |
| Is TradingView running? | `health check` / `launch TradingView` |

---

## 🧠 How a brief works (so the output makes sense)

### ETF income

```text
income ETF scan
```

Runs `income_etf_scan` against `WKLY-DIV-ETF`. It validates and merges the Dividends, NAV performance, Overview, Fund flows, Holdings, Risk, and Technicals tabs and ranks weekly and monthly payers together, with NAV total return and NAV preservation weighted above indicated yield. The established-fund formula is `score_version: 1` and is documented in `config/screeners/WKLY-DIV-ETF.md`; limited-history funds remain watchlist-only until both required one-year NAV fields exist. There is no target fund count, `top_n` is display-only, and risk caps can leave cash unallocated. Weekly artifacts are isolated under `reports/inc-etf/<YYYY-WkNN>/`, with replaced same-week artifacts archived under `runs/<timestamp>/`. Payment frequency is retained only for cash-flow scheduling.

For the weekly scheduled workflow, run `income_etf_monitor` instead. It saves the market scan before reading holdings, compares archived prior runs, enforces two-scan confirmation for normal entries/exits, saves scanner-only alert details, and optionally accepts an external `actual_portfolio` object or broker `actual_portfolio_csv_path` for transient recommendation-only drift. Duplicate tickers are aggregated and incomplete cost basis remains unknown. Omitted cash and external funding requirements remain unknown; `external_funding_if_no_cash_available` is the explicit no-cash assumption. For a taxable brokerage set `allow_additional_funding=true`, `taxable_account=true`, and `gradual_reconciliation=true`. For monthly governance run `income_etf_monthly_review`, then save its rendered output with `session_save instrument_type="income_etf_monthly_review"`. See `docs/INCOME_ETF_OPERATIONS.md`.

**Core equity types** (momentum_stocks, momentum_etf — live screener):
1. **L1 — universe:** live MOMENTUM screener supplies the symbols.
2. **L2 — lux_screener_scan:** batches symbols through LuxAlgo S&O + PAC + OSC on the weekly chart. Hard filter: BOS + Bullish/Strong Bullish S&O Rating + ▲/▲+ Signal. Only passing symbols proceed.
3. **L3 — NW Envelope check:** per-symbol via `morning_brief`, reads the most recent NW label. Entry only when `nw_position = inside`.

**Watchlist equity types** (momentum_ark, sp_ndx, r2k, thematic_stocks, thematic_etfs — static CSV):
1. **L1 — universe:** static CSV watchlist (`Watchlist_ARK.csv` / momentum CSVs / `Watchlist_Stocks.csv` / `Watchlist_ETFs.csv`) supplies the symbols. No live screener.
2. **L2 — lux_screener_scan:** same hard filter as above (BOS + Bullish S&O + ▲ signal). Output is the ranked result — this IS the brief for these types.
3. **Entry check:** NW Envelope extension verified manually on the chart for final entries.

**Crypto/futures types** (crypto, crypto_perps, futures):
1. **L1 — universe:** static `CSV/CRYPTO.csv`, `CSV/PERPS.csv`, or `CSV/FUTURES.csv` supplies the complete symbol list. `max_symbols: 0` means uncapped by default.
2. **L2 — morning_brief scan:** chart loads TWB Oscillator + NW Envelope. TWB Histogram/Signal direction determines bias. For crypto_perps: BTC TWB direction = long or short side.
3. **L3 — bias:** Claude applies strategy rules (entry/exit/risk) and writes the brief.

**Key signals:** NW ▲ = price crossed above upper band (extended, skip), ▼ = crossed below lower band (avoid). For crypto/futures: TWB Histogram **>** Signal = momentum accelerating (bullish bias); TWB **<** Signal = bearish bias.

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
| Trading watchlist CSVs | `CSV/CRYPTO.csv`, `CSV/PERPS.csv`, `CSV/FUTURES.csv`, `CSV/Watchlist_ARK.csv` |
