# Session Handoff — TradingView MCP Jackson
**Date:** 2026-07-25  
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

## What Was Done This Session (2026-07-25)

### Permission allowlist: Windows-path vs POSIX-path mismatch (root cause of a second round of daily prompts)

`futures-morning-routine`'s 2026-07-25 scheduled run still needed manual approval for `ct_tv_data.py` despite the 2026-07-24 fix below, because the Bash tool actually runs Git Bash and normalizes paths to POSIX form (`/c/work/...`), while the existing allow rule only matched the Windows-slash form (`C:/work/...`). Same root cause then hit `mkdir` and the archive script.

**Fix** (`.claude/settings.json`): added POSIX-path companion entries alongside the existing Windows-path ones:
- `Bash(python /c/work/tradingview-mcp-jackson/scripts/ct_tv_data.py*)`
- `Bash(mkdir -p /c/work/tradingview-mcp-jackson/reports/*)`
- `Bash(node C:/work/tradingview-mcp-jackson/scripts/archive-old-reports.mjs*)` + POSIX variant (`tv-mcp-archive-old-reports` task had no coverage at all)
- `Write(C:/Windows/Temp/**)` / `Write(/c/Windows/Temp/**)` + `Bash(python /c/Windows/Temp/*.py*)` + `Bash(rm /c/Windows/Temp/*)` — `weekly-decision-routine`'s scratch-file step was uncovered

**Broader audit:** user asked to check all 11 scheduled tasks across all projects for the same gap. Found and fixed:
- `canontrading-scrape` (`cannonedge-daily-pipeline`, live daily 5:40pm) — Gmail `create_draft` and `PushNotification` were missing entirely; allowlisted Python commands used bare `python` but the routine's own SKILL.md mandates the full `Python314\python.exe` path (mismatch); `daily_scrape`, `pipeline prune`, `post_summary email`, and the real `backup create daily` arg (only `create manual-test` was allowlisted) were missing. Fixed in `.claude/settings.local.json` (gitignored — personal/local only, not committed).
- `bot-rhood` — had no `.claude/settings.json` at all despite `rh-sync-positions` running live every weekday. Created one covering `rh_sync_positions` + Robinhood read tools + `bot-rhood-daily-scan`'s tools (disabled). Order-placement tools deliberately excluded — that routine hard-bans them.
- `local`, `webull-platform`, `brokers` — underlying tasks (`mcp-inventory-nightly-push`, `webull-db-backup`, `broker-daily-refresh`) are currently disabled, fixed anyway for when re-enabled. Note: `broker-daily-refresh`'s SKILL.md names `C:\work\brokers` as its project root, which doesn't match the `C:\work\trading-journal` path in global CLAUDE.md — unresolved naming mismatch, worth checking before re-enabling.

**Global fix:** added a standing rule to `~/.claude/CLAUDE.md` requiring any new/edited scheduled task to get matching `.claude/settings.json` permission entries (in POSIX-path form) as part of its creation, not after the first failure.

---

## What Was Done This Session (2026-07-24)

### Scheduled Routine — Removed Daily Approval Prompts

`futures-morning-routine` ran successfully via its scheduled trigger (health check → crypto/crypto_perps/futures briefs → `ct_tv_data.py` → re-armed `decision-email-routine`), but every MCP/Bash call in the routine was prompting for approval each day because `.claude/settings.json` only allowlisted `create_scheduled_task`/`delete_scheduled_task`.

**Fix** (`.claude/settings.json`): added allow entries for the tools these two routines actually call:
- `mcp__scheduled-tasks__update_scheduled_task`, `mcp__scheduled-tasks__list_scheduled_tasks`
- `mcp__tradingview__tv_health_check`, `mcp__tradingview__morning_brief`, `mcp__tradingview__session_save`, `mcp__tradingview__session_get`
- `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__create_draft` (Gmail draft creation, used by `decision-email-routine`) — **unverified**: guessed from the routine's documented job (3 Gmail drafts); if a prompt still appears on a different Gmail tool (e.g. `label_message`), add that tool name too
- `Bash(python C:/work/tradingview-mcp-jackson/scripts/ct_tv_data.py*)`

Committed as `1131fe1` ("Allow morning-routine tools and remove dead PostToolUse hook") along with the 2026-07-20 hook-removal/SKILL.md fixes below, which had been sitting uncommitted. Pushed to `origin/main`.

---

## What Was Done This Session (2026-07-20)

### Futures Routine Bug Fixes

**1. Dead PostToolUse hook removed** (`.claude/settings.json`)
- Hook ran `scripts/futures_decision_hook.py` on every `session_save` — script was deleted in commit `0a109e1` ("Remove legacy scripts") but the hook config was never updated.
- Hook errored silently on every brief save. Removed the entire `hooks` block.

**2. SKILL.md Step 5 corrected** (`futures-morning-routine/SKILL.md`)
- Step 5 called `create_scheduled_task` for `decision-email-routine` every day. That task persists in disabled state after each run, so `create` always found a duplicate and the agent had to improvise.
- Changed to `update_scheduled_task` with `enabled: true` — re-arms the existing task rather than creating a duplicate.

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
| `futures-morning-routine` | Weekdays 10:37 AM | **Active** — data collection only: 3 briefs → ct_tv_data.json → re-arms decision-email-routine via `update_scheduled_task` |
| `decision-email-routine` | One-time, re-armed daily by Routine 1 (+3 min) | **Active** — reads saved files → Claude reasons → 3 decision HTML files → 3 Gmail drafts. Aborts if any of the 4 required files are missing. Persists in disabled state between runs; never recreated. |
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

Branch: `main` — committed locally as of 2026-07-25 (commit `c567ae1`), not yet pushed.

- `.claude/settings.json` — dead `futures_decision_hook.py` PostToolUse hook removed; permission allowlist added for morning-routine tools (committed 2026-07-24); POSIX-path Bash entries + archive/scratch-file permissions added (committed 2026-07-25, `c567ae1`)
- `C:\Users\vsbra\.claude\scheduled-tasks\futures-morning-routine\SKILL.md` — Step 5 changed from `create_scheduled_task` to `update_scheduled_task` (lives outside this repo, not tracked by this git history)
- `C:\Users\vsbra\.claude\CLAUDE.md` — new global rule added 2026-07-25: any new/edited scheduled task must get matching `.claude/settings.json` permission entries as part of its creation (lives outside this repo)
