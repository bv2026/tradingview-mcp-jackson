# TradingView MCP — Prompt Cheat Sheet

Quick reference for the daily/weekly trading workflow. Prompts are what you type to Claude; scripts are what you (or Claude) run in a terminal.

---

## 🗓️ Daily routine (market days)

| Goal | Prompt |
|---|---|
| **Run all 8 briefs + daily summary** | `morning brief all` |
| Single core brief | `morning brief stocks` (or `etf`, `ark`, `crypto`, `crypto_perps`, `futures`) |
| Single momentum brief | `morning brief sp_ndx` (or `r2k`) |
| Read back a saved brief | `get the stocks brief` (or any type) |
| Read today's daily summary | `get the daily summary` |

> `all` covers **all 8** instruments (stocks, etf, ark, crypto, crypto_perps, futures, sp_ndx, r2k) and auto-writes a daily-summary.

**Reports land in:** `reports/{YYYY-Mon-DD}/{type}.md` + `daily-summary.md`

---

## 📅 Weekly routine (Saturdays)

Run these two terminal commands, then ask Claude to narrate:

```bash
node scripts/build-weekly-review.mjs      # consolidate Mon–Fri across all instruments
node scripts/build-momentum-watchlists.mjs  # rebuild sp_ndx + r2k from the week's CSVs
```

| Goal | Prompt |
|---|---|
| Narrate the weekly review (after running the script) | `write the weekly review` |
| Read back a weekly review | `get the weekly review for W25` |

> `build-weekly-review.mjs` writes the data bundle to `reports/weekly/{YYYY-Www}-data.json`; Claude then writes `reports/weekly/{YYYY-Www}.md`.
> `build-momentum-watchlists.mjs` auto-picks the newest dated CSVs from `CSV/` (momentum-sp500, momentum-nasdaq100, momentum-russell2000, market-chatter) and rewrites `config/strategy-sp_ndx.json` and `config/strategy-r2k.json`. **No restart needed.**

---

## 🧩 The two brief families

| | **Core** (6) | **Momentum** (2) |
|---|---|---|
| Source | Live TradingView MOMENTUM screeners | Weekly CSV exports (momentum-sp500/nasdaq100/russell2000) |
| Refresh | Live, every run | Weekly (Saturday script) |
| Types | stocks, etf, ark, crypto, crypto_perps, futures | sp_ndx (S&P+NDX combined), r2k (Russell 2000) |
| In `all` run? | ✅ Yes | ✅ Yes |
| Extra signal | — | Retail sentiment / WTD / watchers / chatter per symbol |

### Momentum watchlist recommended cadence
The sp_ndx and r2k lists refresh **weekly** from Friday-close CSV exports. The daily run monitors a fixed candidate set for entry triggers.

- **Saturday:** drop 4 dated CSVs into `CSV/`, then `node scripts/build-momentum-watchlists.mjs` — rebuilds both watchlists + chatter annotations.
- **Saturday:** `lux screener scan sp_ndx` and `lux screener scan r2k` — run the LuxAlgo batch scan, save as `sp_ndx.md` and `r2k.md`.
- **Daily (Mon–Fri):** `morning brief sp_ndx` and `morning brief sp_ndx` — TWB/NW/Vol scan for entry triggers.
- By Thu/Fri the weekly data is stale vs price — the live `morning brief stocks` (core) provides fresher mid-week discovery.

---

## 🔬 LuxAlgo batch screener scan

Scans a watchlist through 3 LuxAlgo screeners (S&O, PAC, OSC) on the **LUXALGO_SCREENERS** chart tab and returns a ranked table + top 10 / bottom 10.

```
lux screener scan sp_ndx        # S&P 500 + Nasdaq 100 momentum (40 names, current week)
lux screener scan r2k            # Russell 2000 momentum (25 names, current week)
```

**Score = S&O rating (+3/+2/0/−2) + Signal (+2/+1/−1) + OSC Div (+2/−2) + HWO (+1/−1) + PAC Structure (+1/−2)**
Top 10 = highest score. Bottom 10 = lowest score. Saves to `reports/{date}/{type}.md`.

**Watchlist sources:**
| Type | Source |
|---|---|
| `sp_ndx` | `CSV/momentum-sp500-*.csv` + `CSV/momentum-nasdaq100-*.csv` — IN symbols combined |
| `r2k` | `CSV/momentum-russell2000-*.csv` — IN symbols |

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
| Scripts | `scripts/build-momentum-watchlists.mjs`, `scripts/build-weekly-review.mjs` |
| Raw scan data | `~/.tradingview-mcp/sessions/` |
| Momentum source CSVs | `CSV/momentum-sp500-*.csv`, `CSV/momentum-nasdaq100-*.csv`, `CSV/momentum-russell2000-*.csv`, `CSV/market-chatter-*.csv` |
