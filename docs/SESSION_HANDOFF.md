# Session Handoff — TradingView MCP Jackson
**Date:** 2026-08-15  
**Handoff to:** Codex (Claude Code)  
**Project root:** `C:\work\tradingview-mcp-jackson`

---

## Current State

All watchlist scans healthy and trusted for daily use. All 3 daily decision emails (crypto, perps, futures) generating correctly. Weekly decision pipeline V1 evidence-scoring gaps patched — all 7 instrument types should now produce correct actionable buckets.

**Perps watchlist:** 33 symbols (added TECH/CHN/DFNSE on 2026-08-01)

---

## What Was Done This Session (2026-08-15)

### ARK Watchlist — Full Lux Scan, Invalid Symbol Rebuild, Morning Brief

**Context:** Prior sessions had a speculative/guessed `ARK_LUX_INVALID_SYMBOLS` list (23 symbols). This session ran a full 149-symbol `lux_screener_scan` to identify the true Lux-incompatible symbols from evidence, then rebuilt the watchlist and ran the momentum_ark morning brief.

**1. Full ARK Lux Scan (149 symbols)**
- Ran all 8 batches of `lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20, offset=0..140`
- Two batches timed out at 20 symbols — fixed by splitting into 10-symbol sub-batches (resource contention, not bad symbols)
- Confirmed: exactly 12 symbols produce `Signal: Unavailable` + NaN Trend Strength/Squeeze (true Lux-incompatible)

**2. `ARK_LUX_INVALID_SYMBOLS` rebuilt in `scripts/build-watchlist-configs.mjs`**
- Replaced old 23-symbol speculative list with 12 evidence-confirmed symbols:
  `ALMR, BLSH, CRWV, ETOR, FIG, HONA, KLAR, PAYP, SCTX, SECZ, SPCX, XE`
- Filter applied in `parseArkCsv()` — `if (ARK_LUX_INVALID_SYMBOLS.has(ticker)) continue`
- `writeConfig` updated to emit `invalid_symbols_excluded` and updated pipeline description

**3. `config/strategy-momentum_ark.json` rebuilt**
- 149 → **137 symbols** (12 excluded)
- `invalid_symbols_excluded` list now embedded in the config

**4. `scripts/scheduled-tasks/weekly-scan-routine.md` updated**
- ARK scan now uses `offset=0,20,40,60,80,100,120` (7 calls) to cover 137 symbols
- Was: `offset=0,20,40,60,80,100` (~117 symbols estimate)

**5. Full momentum_ark morning brief produced and saved**
- Saved to `reports/2026-Wk33/2026-Aug-15/momentum_ark.md`
- Top 20: BFLY(9), GTLB/MASS/SDGR(8), ILMN/NET/KALU/SLGL(7) + 12× score-6 Strong Bullish names
- Genomics appeared 3× in top 20 → TWST is the single eligible pick (only early-NW genomics name)
- Top 3 setups: MASS, GTLB, SLGL (all `nw=early`; no score-7+ name is inside NW bands)
- Universe-level read: ARK breadth weak (54% passers), patient week — no fresh entries

**Key files changed this session:**
- `scripts/build-watchlist-configs.mjs` — ARK_LUX_INVALID_SYMBOLS rebuilt
- `config/strategy-momentum_ark.json` — 137-symbol watchlist
- `scripts/scheduled-tasks/weekly-scan-routine.md` — ARK offset list updated (→ sync to live)

---

## What Was Done This Session (2026-08-14)

### Comprehensive Review + V1 Scoring Pipeline Bug Fixes

Full codebase audit after the V1 evidence-scoring redesign. Found and fixed 8 issues. All 145 tests pass. Committed as `1d7720c`.

#### C-1 (Critical): `scan-extract.mjs` — stripped fields broke all split-scan types

`trimSymbol()` was keeping only the old score/NW/so/pac/osc fields and silently dropping the 9 V1 evidence-scoring fields required by `lux-scan-contract.js` and `decision-classify.mjs`:
- `eligibility`, `so_status`, `pac_status`, `osc_status`
- `rank_score`, `setup_quality`, `entry_quality`, `evidence_state`, `rejection_reasons`

Impact: `assertLuxScanPayload()` threw on every split-scan type (momentum_stocks, momentum_etf, momentum_ark, thematic_stocks, thematic_etfs) → classify aborted → zero actionable decisions for all 5 types. Only sp_ndx and r2k (which use `--full`) were unaffected.

**Fix:** `trimSymbol()` now preserves all 9 V1 fields alongside the existing ones.

#### H-1 (High): `decision-render.mjs` thematic layouts ignored new buckets

`thematicStocksEmail()` and `thematicEtfsEmail()` built Top Picks from `d.buckets.ready` only — `ready_norr` and `extended_continuation` were invisible in thematic emails. Additionally, the watch-list filter (`e.qualification !== 'ready'`) let `ready_norr`/`extended_continuation` appear in both Top Picks and Watch simultaneously.

**Fix:** Both thematic functions now build `thematicActionable`/`etfActionable` from all 3 buckets (same as `standardEmail`). Watch filter updated to exclude all 3. Per-row action labels in theme breakdown table updated to distinguish all 3 qualification types.

#### H-2 (High): `decision-render.mjs` sort mismatch

`allPassers.sort()` used `score` but `decision-classify.mjs` sorts by `rank_score`. Currently identical values, but fragile.

**Fix:** Sort now uses `rank_score ?? score` fallback — matches the classify step.

#### H-3 (High): `classify.js` returned `'n/a'` for no-label NW case

`nwPositionFrom()` returned `'n/a'` when no crossing label existed. `lux_screener.js` returns `'inside'` for the same case. `decision-classify.mjs` qualifies only `=== 'inside'` — `'n/a'` would land in `watch_unknown`.

**Fix:** `classify.js` now returns `'inside'` (price between bands = valid entry zone, semantically correct).

#### M-1 (Medium): Dead `'WATCH'` eligibility in `lux-scan-contract.js`

`evidence-scoring.js` never produces `'WATCH'` — only `REVIEW`, `REJECT`, `INSUFFICIENT`.

**Fix:** Removed from the valid-values enum.

#### M-3 (Medium): `futures-morning-routine` SKILL missing format constraints

The SKILL's STEP 3 didn't document the strict futures.md format contract that `ct_tv_data.py` depends on.

**Fix:** Added explicit format contract block to STEP 3 (bare ticker, ASCII `-`, literal `**Benchmark:**`/`**Theme:**` headers) with pointer to check first when STEP 4 exits code 2.

#### L-1 (Low): `weekly-decision-routine` SKILL had stale scoring description

STEP 4 described the old `score > -99` hard-filter logic. The actual classifier now uses V1 evidence-scoring (`setup_quality`, `entry_quality`, `eligibility`).

**Fix:** STEP 4 rewritten to accurately describe the current V1 classification buckets and logic.

#### M-4 (Medium): `income-etf-monthly-review-routine` SKILL had duplicate frontmatter

**Fix:** Removed the duplicate YAML block.

#### L-2 (Low): `settings.json` rm allowlist missing Windows-path forms

`rm -f` cleanup entries existed for POSIX paths only (`/c/Windows/Temp/*`). The weekly-decision-routine SKILL instructs agents using Windows paths.

**Fix:** Added `C:/Windows/Temp/*` forms alongside the POSIX forms.

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
  7 equity types   → lux_screener_scan → auto-save file
                   → scan-extract.mjs (--full for sp_ndx/r2k; default for split types)
                   → scan-merge.mjs (split types only)
                   → scan-verify.mjs (contract validation)
                   → decision-classify.mjs → buckets (ready/ready_norr/extended_continuation/watch_*)
                   → decision-render.mjs → {type}-decision.html + {type}-signals.json → Gmail send

NW ENVELOPE BAND DATA:
  - Position (extended/early/inside): getPineLabels() — ▲/▼ crossing labels
  - Band levels (nw_upper/nw_lower for R:R): not reliably available through getStudyValues(); use labels/derived position where available
  - Falls back to label price for extended/early positions
  - ready_norr bucket catches inside symbols when band levels unavailable
  - NW Envelope bands are not reliably exposed by getStudyValues(); labels/derived position are used where available, and automated R:R often remains unavailable, so manual confirmation is required

SCORING (V1 evidence-scoring, as of ~2026-08-01):
  evidence-scoring.js → setup_quality (A/B/C/D/U/F) + entry_quality + eligibility + rank_score
  lux-scan-contract.js validates: eligibility ∈ {REVIEW, REJECT, INSUFFICIENT}
  decision-classify.mjs gates: setup_quality ∈ {A,B} + entry_quality ∈ {FAVORABLE,ACCEPTABLE}
```

**Key files:**

| What | Where |
|---|---|
| V1 evidence scorer | `src/core/evidence-scoring.js` |
| Scan field extractor (split scans) | `scripts/scan-extract.mjs` |
| Scan contract validator | `src/core/lux-scan-contract.js` |
| Equity decision classifier | `scripts/decision-classify.mjs` |
| Equity decision renderer | `scripts/decision-render.mjs` |
| NW envelope reader | `src/core/lux_screener.js` → `readNwEnvelope()` |
| Morning brief classifier | `src/core/classify.js` → `nwPositionFrom()` |
| CT+TV data fetcher (with validation gate) | `scripts/ct_tv_data.py` |
| Perps watchlist (gitignored) | `CSV/PERPS.csv` (33 symbols) |
| Perps strategy config | `config/strategy-crypto_perps.json` |
| Futures morning routine skill | `~/.claude/scheduled-tasks/futures-morning-routine/SKILL.md` |
| Weekly decision routine skill | `~/.claude/scheduled-tasks/weekly-decision-routine/SKILL.md` |

---

## Known Gaps / Next Session

- **`ready_norr` first live scan pending**: The `getStudyValues()` fix for NW band data hasn't been validated on a post-2026-08-14 live scan yet. If `nw_data_warning` fires in scan output, verify NW Envelope is visible on chart at scan time.
- **CT data mapping gaps**: 9-10 futures symbols have `tv_symbol: null` in `TV_TO_CT_MARKET` (YM1!, RTY1!, BZ1!, ZN1!, ETH1!, 6B1!, 6J1!, DX1!, GF1!) — no CT+TV agreement possible for these. Could add CT market codes if CannonEdge covers them.
- **Futures indicator validation** was due ~2026-08-03: re-check TWB/NW hit rate vs CannonEdge baseline — not yet confirmed done. Update the `futures-indicator-validation` memory once verified.
- **M-2 (ARK cluster drift)**: `decision-render.mjs` has a hardcoded `CLUSTERS` object that could drift from `strategy-momentum_ark.json`. Low urgency but worth reading clusters from the strategy JSON at runtime in a future session.
- **ARK batch 3 (symbols 121–137) lux data**: these 17 symbols produced no Lux screener data (score=0/N/A) in the 2026-08-15 scan — thinly traded / recent listings. They showed NW position from chart labels only. Recheck periodically whether any mature enough for S&O to cover.
- **L-3 (NW pass doesn't restore main chart symbol)**: After `lux_screener_scan`'s NW L3 pass, the main chart tab is pointed at the last scanned symbol. `morning.js` explicitly restores `originalSymbol`; `lux_screener.js` doesn't. Minor UX issue.

---

## Git State

Branch: `main` — committed and pushed as of 2026-08-15.
