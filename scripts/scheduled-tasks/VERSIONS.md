# Routine versions & copy map

Every routine in this project can exist in up to three places. Check this file **before** building
any email/report/decision output by hand — if a routine is listed here, use it instead of
reinventing the format (see [[feedback-check-scheduled-tasks-before-emailing]]).

| Copy | Purpose | Who reads it |
|---|---|---|
| `scripts/scheduled-tasks/<name>.md` | **Canonical source.** Version-controlled, checked into git. Edit here first. | Nobody executes this directly |
| `~/.claude/scheduled-tasks/<name>/SKILL.md` | **Live scheduler copy.** Outside git. Pushed one-way from the canonical copy via `sync-to-claude.ps1`. | The cron/scheduler at run time |
| `.claude/skills/<name>/SKILL.md` (project skill, only for routines worth running on demand) | **Manually invocable copy.** Discoverable via `/`-style skill invocation any time, not just at the cron time. | You, when the user asks to run/redo something interactively |

**After editing a canonical copy:** run `scripts/scheduled-tasks/sync-to-claude.ps1` to push it live,
and if a matching `.claude/skills/<name>/` exists, update it too (bump `version` + `last_updated` in
its frontmatter, add a changelog line). The three copies are not auto-linked — nothing enforces
they match beyond this manual step and this table existing.

**Prefer a modular skill over one big file** for anything with distinct sub-steps a user might want
to tweak independently (e.g. which types to run, email subject lines, classification thresholds).
See `.claude/skills/weekly-decision-routine/` for the pattern: a slim `SKILL.md` orchestrator plus
a `references/` folder of focused, independently-editable files loaded only as each step is reached.

## Current routines

| Name | Version | Last updated | Canonical | Live (scheduled) | Project skill |
|---|---|---|---|---|---|
| weekly-decision-routine | 1.0.0 | 2026-08-28 | ✅ | ✅ (weekdays ~6:50pm) | ✅ `.claude/skills/weekly-decision-routine/` |
| weekly-decision-routine-oneshot | 1.0.0 | 2026-08-28 | ✅ | ✅ (manual trigger only) | — (same as weekly-decision-routine) |
| decision-email-routine | — (unversioned) | — | ✅ | ✅ (daily 8:15am) | — |
| weekly-scan-routine | — (unversioned) | — | ✅ | ✅ (weekdays 7:43pm) | — |
| futures-morning-routine | — (unversioned) | — | ✅ | ✅ (daily 7:30am) | — |
| tv-top-setups-report | — (unversioned) | — | ✅ | ✅ (weekdays 8pm) | — |
| tv-mcp-archive-old-reports | — (unversioned) | — | ✅ | ✅ (Sun 3am) | — |
| income-etf-weekly-routine | — (unversioned) | — | ✅ | ✅ (Sat 10am) | — |
| income-etf-monthly-review-routine | — (unversioned) | — | ✅ | ✅ (1st Sun 11am) | — |

Routines marked "unversioned" haven't been given a `version`/`last_updated` frontmatter pair yet —
add one (starting at `1.0.0`) the next time you touch that file, following the
weekly-decision-routine pattern above. Only build a project skill for a routine when there's a
real case for running it on demand outside its cron; not every routine needs one.

## Changelog

- **2026-08-30** — **CannonEdge / CT+TV consumption removed from this repo** (the CannonEdge
  signal is being rebuilt and isn't usable right now; the `cannonedge-daily-pipeline` scraper
  still runs). Deleted
  `scripts/ct_tv_data.py`, `src/core/external-evidence/cannon.js` + `cannon-market-family.js`,
  `src/core/futures-evidence-scoring.js`, `src/core/crypto-evidence-scoring.js`,
  `config/cannon-market-families.json`, and 4 cannon test files. `src/core/morning.js` no longer
  attaches Cannon evidence or runs futures/crypto evidence-scoring. **futures-morning-routine**:
  STEP 4 (ct_tv fetcher) removed. **decision-email-routine**: STEP 5 Futures email rewritten
  TV-only (TWB gap / NW / regime / S/R from `futures.md`); `ct_tv_data.json` no longer required
  or read. `.claude/scan-futures.md` + `.claude/futures-decision.md` updated to TV-only.
  Also converted the routine's `C:\Windows\Temp\...` / `python C:\work\...` backslash paths to
  forward-slash form (Git Bash strips unquoted backslashes → junk files in repo root). Both
  routines synced to live.
- **2026-08-28** — weekly-decision-routine versioned at 1.0.0 and published as a modular project
  skill (`.claude/skills/weekly-decision-routine/`), after a live run surfaced that this routine's
  existence wasn't being checked before hand-rolling emails. This file created as the general fix.
- **2026-08-28** — Discovered `weekly-decision-routine-oneshot` had no canonical copy in this repo,
  so `sync-to-claude.ps1` never touched it — its live copy had silently drifted to an old draft
  (legacy hard-filter classification instead of V1 evidence scoring, no METRICS section, and a
  TABLE STYLE using raw CSS `style="background:..."` — the exact Gmail-stripping bug the main
  routine fixed on 2026-08-15). Created `weekly-decision-routine-oneshot.md` as its canonical copy
  (mirrors weekly-decision-routine.md, renamed frontmatter) and added it to `sync-to-claude.ps1`'s
  task list. **Lesson: a routine only stays in sync if it has a canonical file AND is in the sync
  script's list — check both when adding any new scheduled task, not just one.**
