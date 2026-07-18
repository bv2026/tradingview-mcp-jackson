# Session Handoff — TradingView MCP Jackson
**Date:** 2026-07-18  
**Handoff to:** Codex (Claude Code)  
**Project root:** `C:\work\tradingview-mcp-jackson`

---

## Current State

All watchlist scans healthy and trusted for daily use (verified 2026-07-18):
- `momentum_ark`: 128 symbols, clean
- `thematic_stocks`: 117 symbols, clean
- `thematic_etfs`: 77 symbols, clean
- OSC RE10041 error: resolved — caused by excluded symbols, not a code bug

No remaining blockers on screener scans.

---

## What Was Done This Session (2026-07-18)

### Automated Morning Pipeline — Full 3-Brief + 3-Decision-Email Routine

Built and activated an end-to-end automated morning pipeline via the `futures-morning-routine` scheduled task (weekdays 10:37 AM local). The task runs fully automatically — no manual trigger needed.

**Pipeline sequence:**
1. `morning_brief instrument_type="crypto"` → `session_save` → crypto-decision.html → Gmail draft
2. `morning_brief instrument_type="crypto_perps"` → `session_save` → crypto-perps-decision.html → Gmail draft
3. `morning_brief instrument_type="futures"` → `session_save` → run `ct_tv_data.py` → futures-decision.html → Gmail draft

**3 Gmail drafts sent to bvajjala@gmail.com:**
- `"Crypto Decision Brief — {DATE}"`
- `"Perps Decision Brief — {DATE}"`
- `"Decision Brief — {DATE}"` (futures)

**Key design decisions:**
- Claude reads the strategy JSON file at runtime and reasons from raw TV data — no pre-baked rules in the prompt
- Crypto and perps: TV-only (no CT DB), per-symbol signals, no BTC benchmark
- Futures: CT direction is primary (always authoritative), TV is timing context only
- Gmail draft always reads the saved HTML file from disk (not re-rendered) — draft matches file exactly
- Reports saved as: `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/crypto-decision.html`, `crypto-perps-decision.html`, `futures-decision.html`

### New Script: `scripts/ct_tv_data.py`

Fetches combined CT + TV data for futures decision. Reads:
- CannonEdge CT DB (`C:\work\canontrading-scrape\data\cannonedge.db`) — snapshot, levels, commentary
- Today's `reports/{week}/{date}/futures.md` — parses the symbol table for TWB gap, NW position, watch notes

Key details:
- `TV_TO_CT_MARKET` static dict maps TV symbols → CT market codes (bypasses broken symbol_mapping DB)
- Column offset detection handles `| # | SYMBOL |` header in futures.md
- Weekend fallback: queries `MAX(post_date)` if today has no CT data
- UTF-8 stdout encoding (handles ▲▼ arrows on Windows)
- TWB gap parsed from both `gap X` and `TWB hist/sig` formats

### `.claude/` Skill Files

- `.claude/futures-decision.md` — skill for manual `/futures-decision` invocation; saves to `futures-decision.html`
- `.claude/futures-routine.md` — skill stub for manual `/futures-routine` invocation
- `.claude/settings.json` — PostToolUse hook config (hook approach was explored but abandoned; scheduled task inline logic is the live approach)

### Legacy Scripts Removed in Cleanup

The following obsolete helpers were removed during the 2026-07-18 repo audit cleanup:

- abandoned PostToolUse hook prototype
- old pre-classification approach superseded by `ct_tv_data.py` + inline LLM reasoning

---

## Scheduled Task State

| Task ID | Schedule | Status |
|---|---|---|
| `futures-morning-routine` | Weekdays 10:37 AM | **Active** — data collection only: 3 briefs → ct_tv_data.json → triggers decision-email-routine |
| `decision-email-routine` | One-time, triggered by Routine 1 (+3 min) | **Active** — reads saved files → Claude reasons → 3 decision HTML files → 3 Gmail drafts. Aborts if any of the 4 required files are missing (crypto.md, crypto_perps.md, futures.md, ct_tv_data.json) |
| `cannonedge-daily-pipeline` | Daily 5:40 PM | Active — CT scrape + ingest |
| `broker-daily-refresh` | Daily 7:40 AM | Active |
| `tv-mcp-archive-old-reports` | Sundays 3 AM | Active |
| `bot-rhood-daily-scan` | Weekdays 12:38 PM | Active |

---

## Architecture Summary

```
CORE BRIEFS (morning_brief tool):
  crypto           → MOMENTUM-CRYPTO screener → morning_brief → crypto-decision.html
  crypto_perps     → MOMENTUM-PERPS screener  → morning_brief → crypto-perps-decision.html
  futures          → static futures watchlist  → morning_brief → ct_tv_data.py → futures-decision.html

WATCHLIST SCANS (lux_screener_scan tool):
  momentum_ark     → CSV/Watchlist_ARK.csv (128 symbols)
  sp_ndx           → CSV/momentum-sp500-*.csv + nasdaq100-*.csv
  r2k              → CSV/momentum-russell2000-*.csv
  thematic_stocks  → CSV/Watchlist_Stocks.csv (117 symbols, 8 themes)
  thematic_etfs    → CSV/Watchlist_ETFs.csv (77 ETFs, 8 themes)
```

**Strategy files** (Claude reads at runtime for decisions):
- `config/strategy-crypto.json` — long only, per-symbol TWB+NW+S/R
- `config/strategy-crypto_perps.json` — both sides, per-symbol TWB+NW, commodity perps exempt
- `config/strategy-futures.json` — both sides, CT primary, TV timing, regime detection

**Reports folder:** `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/`

---

## Key File Locations

| What | Where |
|---|---|
| CT+TV data fetcher | `scripts/ct_tv_data.py` |
| Futures decision skill | `.claude/futures-decision.md` |
| Strategy configs | `config/strategy-{type}.json` |
| Rules (screeners + chart tabs) | `config/rules.json` |
| Morning brief core | `src/core/morning.js` |
| Lux screener core | `src/core/lux_screener.js` |
| Classify (precomputed fields) | `src/core/classify.js` |
| Build watchlists script | `scripts/build-watchlist-configs.mjs` |
| Reports | `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/` |
| Routine 1 skill | `C:\Users\vsbra\.claude\scheduled-tasks\futures-morning-routine\SKILL.md` |
| Routine 2 skill | `C:\Users\vsbra\.claude\scheduled-tasks\decision-email-routine\SKILL.md` |

---

## Git State

Branch: `main`  
Uncommitted new files being committed this session:
- `scripts/ct_tv_data.py`
- `.claude/futures-decision.md`
- `.claude/futures-routine.md`
- `.claude/settings.json`
