# Session Handoff — TradingView MCP Jackson
**Date:** 2026-08-01  
**Handoff to:** Codex (Claude Code)  
**Project root:** `C:\work\tradingview-mcp-jackson`

---

## Current State

All watchlist scans healthy and trusted for daily use. All 3 daily decision emails (crypto, perps, futures) now generating correctly with full data. No remaining blockers.

**Perps watchlist:** 33 symbols (added TECH/CHN/DFNSE on 2026-08-01)

---

## What Was Done This Session (2026-08-01)

### 1. Decision Engine Overhaul — Equity R:R Pipeline Fix

**Root cause:** `readNwEnvelope()` in `src/core/lux_screener.js` was using `getPineLines()` to read NW band levels, but the NW Envelope uses `plot()` overlays (not `line.new()` objects), so `getPineLines` always returned zero results. Additionally the property name was wrong (`.lines` instead of `.horizontal_levels`). Result: `nw_upper`, `nw_lower`, `rr` were null for every equity symbol, so `decision-classify.mjs` could never mark anything "ready".

**Fix:** Replaced `getPineLines()` with `getStudyValues()` (reads Data Window, which does show `plot()` overlay values). Added label-price fallback for `extended`/`early` positions. Added `nw_data_warning` field to scan output when all passers have null R:R.

### 2. Decision Engine — New Qualification Buckets

Two new buckets added to `scripts/decision-classify.mjs` and `scripts/decision-render.mjs`:

- **`ready_norr`** — `nw_position === 'inside'` but `rr` is null (band data unavailable). Previously these incorrectly landed in `watch_low_rr`. Now surfaced in Top Setups (light blue row) with "confirm R:R before entry" note. Prevents silent all-watch output when band data is absent.

- **`extended_continuation`** — `nw_position === 'extended'` AND `score >= 4`. Trend continuation entry at 50% size (indigo row). Previously all extended names were hard-blocked regardless of score.

Validation: `decision-classify.mjs` now prints `console.warn` if passers ≥ 3, actionable = 0, and all rr = null (signals a data pipeline failure rather than a market condition).

Updated `weekly-decision-routine/SKILL.md`: removed the incorrect note saying null R:R is "expected, not a bug".

### 3. CT+TV Data Pipeline Fix (`scripts/ct_tv_data.py`)

**Root cause:** `futures.md` format changed after July 17. Three specific breakages:

| Bug | Old format | New format |
|---|---|---|
| Symbol lookup | `ES1!` (bare) | `CME_MINI:ES1!` (exchange-prefixed) → dict lookup always missed |
| TWB gap regex | `TWB gap +5.9` or `TWB -29/-35` | `Hist +174.83 ... sig 293.58` → no match |
| NW string match | `"NW-early"`, `"Already NW-extended"` | `"NW early"`, `"NW extended"` (no hyphen) |

All three combined caused every market to have `tv_gap: null`, `tv_nw: null`, `tv_bias: ""` — the futures decision email had no CT+TV agreements, so it showed only "wait and watch" since July 17.

**Fix:** Updated `parse_tv_brief()` to:
1. Strip exchange prefix on symbol extraction (`raw_sym.split(":")[-1]`)
2. Added `Hist ... sig` regex alongside existing `TWB gap` and `TWB hist/sig` patterns
3. Extended NW string matching to handle both hyphenated and space-separated forms
4. Added fallback REGIME derivation from verbose BIAS text when explicit tags absent

**Validation gate added:** After building combined output, checks if >50% of TV-mapped markets have null `tv_gap` — exits with code 2 and error to stderr. `futures-morning-routine` already stops on non-zero exit. Also emits `_validation` block in JSON output for post-save inspection.

`futures-morning-routine/SKILL.md` updated: new step validates `_validation.null_gap_count / tv_mapped_count` ratio before saving `ct_tv_data.json`.

Today's `ct_tv_data.json` regenerated: 0/18 null gaps (CTE/Cotton has no TV mapping — expected).

### 4. Perps Watchlist Expansion

Added 3 missing symbols from the Coinbase Derivatives Tradable list (verified by loading each on TradingView chart):

| Added | TV Symbol | Description |
|---|---|---|
| `TECHUSDC.P` | `COINBASE:TECHUSDC.P` | Tech100 / USDC Perpetual |
| `CHNUSDC.P` | `COINBASE:CHNUSDC.P` | China10 / USDC Perpetual |
| `DFNSEUSDC.P` | `COINBASE:DFNSEUSDC.P` | DFNSE / USDC Perpetual |

`CSV/PERPS.csv` updated (gitignored); `config/strategy-crypto_perps.json` rebuilt → 33 symbols.

Note: AI PERP (`AIUSDC.P`) was already present at line 21 — not a gap.

---

## What Was Done This Session (2026-07-26)

### MCP Review + Income ETF Weekly/Monthly Routines

**Review findings:**
- All 95 sanity tests pass. Income ETF tools correctly wired in `src/tools/screener.js` → `src/core/income_etf*.js`.
- `settings.json` was missing the 3 new income ETF tool allowlist entries — fixed.
- `config/strategy-r2k.json` and `config/strategy-sp_ndx.json` were uncommitted Saturday watchlist refreshes — committed.

**New scheduled routines created:**
1. `income-etf-weekly-routine` — Saturdays 10:00 AM
2. `income-etf-monthly-review-routine` — Sundays 11:00 AM (self-gates to first Sunday)

---

## What Was Done This Session (2026-07-25)

### Permission Allowlist: Windows-path vs POSIX-path mismatch

`futures-morning-routine` still prompted despite 2026-07-24 fix because Bash tool uses POSIX paths (`/c/work/...`) while allow rules used Windows paths (`C:/work/...`). Fixed in `.claude/settings.json`. Broader audit found and fixed same gap across all 11 scheduled tasks.

Global rule added to `~/.claude/CLAUDE.md`: any new/edited scheduled task must get matching POSIX-path `.claude/settings.json` permission entries as part of its creation.

---

## Scheduled Task State

| Task | Schedule | Status |
|---|---|---|
| `futures-morning-routine` | Weekdays 10:37 AM | **Active** — 3 briefs → ct_tv_data.json (with validation gate) |
| `decision-email-routine` | Daily ~8:15 AM | **Active** — reads 4 files → 3 decision HTMLs → 3 Gmail drafts |
| `weekly-scan-routine` | Weekdays ~6:05 PM | **Active** — 7 lux_screener_scan jobs → 7 scan JSONs |
| `weekly-decision-routine` | Weekdays ~6:50 PM | **Active** — classify + render → 7 HTML emails + 7 Gmail drafts |
| `income-etf-weekly-routine` | Saturdays 10:00 AM | **Active** |
| `income-etf-monthly-review-routine` | Sundays 11:00 AM | **Active** (self-gates to first Sunday) |
| `cannonedge-daily-pipeline` | Daily 5:40 PM | Active |
| `tv-mcp-archive-old-reports` | Sundays 3 AM | Active |
| `bot-rhood-daily-scan` | Weekdays 12:38 PM | Active |

---

## Architecture Summary

```
DAILY DECISION ENGINE:
  crypto           → morning_brief → crypto-decision.html → Gmail draft
  crypto_perps     → morning_brief → crypto-perps-decision.html → Gmail draft
  futures          → morning_brief → ct_tv_data.py → futures-decision.html → Gmail draft

WEEKLY DECISION ENGINE:
  7 equity types   → lux_screener_scan → scan-{type}.json
                   → decision-classify.mjs → buckets (ready/ready_norr/extended_continuation/watch_*)
                   → decision-render.mjs → {type}-decision.html → Gmail draft

NW ENVELOPE BAND DATA:
  - Reads via getStudyValues() (Data Window, works with plot() overlays)
  - Falls back to label price for extended/early positions
  - ready_norr bucket catches inside symbols when band data unavailable

ALL-MORNING-BRIEF ROUTING:
  momentum_stocks / momentum_etf -> lux_screener_scan split batches
  other core types              -> direct morning_brief path

NW CLOSE-OUT STATUS:
  NW is a location/timing overlay only. PAC/S&O/OSC are sufficient for the immediate
  workflow; band values may be null because the normal Data Window does not expose
  the NW Envelope bands. Defer separate NW-indicator engineering until a controlled
  comparison demonstrates incremental entry-timing value.
```

**Key files:**

| What | Where |
|---|---|
| CT+TV data fetcher (with validation gate) | `scripts/ct_tv_data.py` |
| Equity decision classifier | `scripts/decision-classify.mjs` |
| Equity decision renderer | `scripts/decision-render.mjs` |
| NW envelope reader | `src/core/lux_screener.js` → `readNwEnvelope()` |
| Perps watchlist (gitignored) | `CSV/PERPS.csv` (33 symbols) |
| Perps strategy config | `config/strategy-crypto_perps.json` |
| Futures morning routine skill | `~/.claude/scheduled-tasks/futures-morning-routine/SKILL.md` |
| Weekly decision routine skill | `~/.claude/scheduled-tasks/weekly-decision-routine/SKILL.md` |

---

## Known Gaps / Next Session

- **`ready_norr` validation pending**: The `getStudyValues()` fix for NW band data is code-complete but untested on a live scan. First Monday scan (2026-08-04) will show whether NW Envelope values actually appear in Data Window. If `nw_data_warning` fires in scan output, NW Envelope may not be visible on the chart at scan time.
- **CT data mapping gaps**: 9-10 futures symbols have `tv_symbol: null` in `TV_TO_CT_MARKET` (YM1!, RTY1!, BZ1!, ZN1!, ETH1!, 6B1!, 6J1!, DX1!, GF1!) — no CT+TV agreement possible for these. Could add CT market codes if CannonEdge covers them.
- **Futures indicator validation** due ~2026-08-03: re-check TWB/NW hit rate vs CannonEdge baseline (see memory).

---

## Git State

Branch: `main` — committed and pushed as of 2026-08-01.
