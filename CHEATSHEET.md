# TradingView MCP — Prompt Cheat Sheet

Quick reference for the daily/weekly trading workflow. Prompts are what you type to Claude; scripts are what you (or Claude) run in a terminal.

---

## 🗓️ Daily routine (market days)

| Goal | Prompt |
|---|---|
| **Run all 8 briefs + daily summary** | `morning brief all` |
| Single core brief | `morning brief stocks` (or `etf`, `ark`, `crypto`, `crypto_perps`, `futures`) |
| Single StockTwits brief | `morning brief stwits_lg` (or `stwits_sm`) |
| Read back a saved brief | `get the stocks brief` (or any type) |
| Read today's daily summary | `get the daily summary` |

> `all` covers **all 8** instruments (stocks, etf, ark, crypto, crypto_perps, futures, stwits_lg, stwits_sm) and auto-writes a daily-summary.

**Reports land in:** `reports/{YYYY-Mon-DD}/{type}.md` + `daily-summary.md`

---

## 📅 Weekly routine (Saturdays)

Run these two terminal commands, then ask Claude to narrate:

```bash
node scripts/build-weekly-review.mjs      # consolidate Mon–Fri across all instruments
node scripts/build-stwits-watchlist.mjs   # rebuild next week's StockTwits watchlists
```

| Goal | Prompt |
|---|---|
| Narrate the weekly review (after running the script) | `write the weekly review` |
| Read back a weekly review | `get the weekly review for W25` |

> `build-weekly-review.mjs` writes the data bundle to `reports/weekly/{YYYY-Www}-data.json`; Claude then writes `reports/weekly/{YYYY-Www}.md`.
> `build-stwits-watchlist.mjs` auto-picks the newest `Stocktwits-Top-*-Week-NN.md` from `C:\work\StockTwits\Reports\` and rewrites the `stwits_lg`/`stwits_sm` watchlists. **No restart needed.**

---

## 🧩 The two book families

| | **Core** (6) | **StockTwits** (2) |
|---|---|---|
| Source | Live TradingView MOMENTUM screeners | Weekly StockTwits Top-momentum report |
| Refresh | Live, every run | Weekly (Saturday script) |
| Types | stocks, etf, ark, crypto, crypto_perps, futures | stwits_lg (SPX+NDX), stwits_sm (Russell) |
| In `all` run? | ✅ Yes | ✅ Yes |
| Extra signal | — | Retail sentiment / WTD / watchers per symbol |

### StockTwits recommended cadence
The StockTwits watchlists refresh **weekly** (Friday-close data), so the daily run is *monitoring a fixed candidate set for entry triggers*, not discovering new names.

- **Saturday:** `node scripts/build-stwits-watchlist.mjs` — regenerates both lists from the newest report.
- **Monday:** `morning brief stwits_lg` and `morning brief stwits_sm` — set the week's playbook.
- **Mid-week (Wed):** re-run both to catch triggers that fired during the week.
- By Thu/Fri the weekly data is stale vs price — value tails off. Use the live `morning brief stocks` (core) for fresh mid-week discovery the frozen list can't provide.

---

## 🔬 LuxAlgo batch screener scan

Scans a watchlist through 3 LuxAlgo screeners (S&O, PAC, OSC) on the **LUXALGO_SCREENERS** chart tab and returns a ranked table + top 10 / bottom 10.

```
lux screener scan sp_ndx        # S&P 500 + Nasdaq 100 momentum (40 names)
lux screener scan r2k            # Russell 2000 momentum (25 names)
lux screener scan stwits_lg      # prior-week StockTwits SPX+NDX list
lux screener scan stwits_sm      # prior-week StockTwits Russell list
```

**Score = S&O rating (+3/+2/0/−2) + Signal (+2/+1/−1) + OSC Div (+2/−2) + HWO (+1/−1) + PAC Structure (+1/−2)**
Top 10 = highest score. Bottom 10 = lowest score. Saves to `reports/{date}/{type}.md`.

**Watchlist sources:**
| Type | Source |
|---|---|
| `sp_ndx` | `CSV/momentum-sp500-*.csv` + `CSV/momentum-nasdaq100-*.csv` — IN symbols combined |
| `r2k` | `CSV/momentum-russell2000-*.csv` — IN symbols |
| `stwits_lg/sm` | `config/strategy-stwits_lg/sm.json` — rebuilt each Saturday |

**Prerequisites:** LUXALGO_SCREENERS tab must be open in TradingView with all 3 screeners (S&O, PAC, OSC) loaded and healthy (no "!" error icons). If they show errors after a code change, delete and re-add them from the Indicators search dialog.

---

## ⚙️ When a restart is needed

A **Claude Desktop restart** is required only after **code changes** to the MCP server (e.g. adding a new instrument type to the tool enums). It is **NOT** needed for:
- Running any brief
- Rebuilding watchlists (`build-stwits-watchlist.mjs`)
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
| Daily reports | `reports/{YYYY-Mon-DD}/` |
| Weekly reviews | `reports/weekly/` |
| Strategy rules per type | `config/strategy-{type}.json` |
| Screener/chart-tab config | `config/rules.json` |
| Scripts | `scripts/build-stwits-watchlist.mjs`, `scripts/build-weekly-review.mjs` |
| Raw scan data | `~/.tradingview-mcp/sessions/` |
| StockTwits source reports | `C:\work\StockTwits\Reports\` |
