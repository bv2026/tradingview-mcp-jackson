---
name: weekly-decision-routine
description: Runs the weekly equity DECISION pipeline for tradingview-mcp-jackson — reads saved scan JSON, classifies via decision-classify.mjs, renders via decision-render.mjs, and emails HTML decision briefs. Invoke manually any time (not just at its 6:50pm cron) — e.g. "run the weekly decision routine" or "redo the sp_ndx decision email".
version: 1.0.0
last_updated: 2026-08-28
---

# Weekly Decision Routine

Produces trade-decision emails from the day's scan JSON for one or more instrument types.
This is the same routine that runs unattended as the `weekly-decision-routine` scheduled task
(canonical scheduler copy: `scripts/scheduled-tasks/weekly-decision-routine.md`) — invoking this
skill directly lets you re-run it on demand (all 7 types, or a subset) without waiting on the cron.

**Canonical/live/skill copy map, versioning, and how to keep them in sync:**
see [`../../../scripts/scheduled-tasks/VERSIONS.md`](../../../scripts/scheduled-tasks/VERSIONS.md).
Bump the version there and in this file's frontmatter together whenever behavior changes.

## Which instrument types to run

Ask the user which of the 7 types they want, unless they already said "all" or named specific
types: `momentum_stocks`, `momentum_etf`, `sp_ndx`, `r2k`, `momentum_ark`, `thematic_stocks`,
`thematic_etfs`. A partial run (e.g. just `sp_ndx` after fixing its scan data) is normal and does
not require redoing the other 6.

## Steps

Read each reference file only when you reach that step — do not front-load all of them.

1. **Locate today's reports folder** — `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/` (ISO week, Monday-start).
2. **Verify scan files exist** for the requested type(s): `scan-<type>.json` in that folder. Missing
   or malformed → note it, skip that type, continue with the rest. Never abort the whole run over
   one bad type.
3. **Classify** — read [`references/classification.md`](references/classification.md) for the
   bucket rules and screener glossary, then run `scripts/decision-classify.mjs` per type. Do not
   hand-classify.
4. **Render** — read [`references/rendering.md`](references/rendering.md) for the per-type template
   shapes and the Gmail-safe table style, then run `scripts/decision-render.mjs` per type. Do not
   hand-write HTML.
5. **Verify** — `grep -c undefined` on each rendered HTML should be 0; cross-check `symbol_count`
   against `scan-<type>.json`.
6. **Email** — read [`references/emails.md`](references/emails.md) for the exact subject line and
   filename per type, then send each as a standalone `send_message` call (no `replyThreadId` —
   see [[feedback-check-scheduled-tasks-before-emailing]] memory note on why threading breaks this).
7. **Log** — if this is a full unattended-style run (all 7 types in one pass), follow
   [`references/logging-metrics.md`](references/logging-metrics.md). For a small ad hoc re-run of
   one or two types, a brief note to the user is enough — the full LOGGING/METRICS protocol exists
   for unattended runs with no visible transcript, which doesn't apply when you're talking to the
   user live.
8. **Report** — per type: symbols scanned / passers / ready to enter / watch count, overall posture
   in 1-2 sentences, confirm N/{requested} emails sent, flag any skipped type with the reason.

## Known gotcha — sp_ndx/r2k must be captured via `lux_screener_scan`, not `morning_brief`

`decision-classify.mjs` requires scan JSON shaped by `lux_screener_scan` (has `so`/`pac`/`osc`/
`score`/`eligibility` per symbol). For `sp_ndx` and `r2k` specifically, if `scan-<type>.json`
doesn't already exist for today, **capture it yourself with `lux_screener_scan`** (2 batches,
`max_symbols=20`, `offset=0` then `offset=20` — see main CLAUDE.md's watchlist workflow) before
running STEP 2. Do NOT fall back to `morning_brief` for these two types — its output for sp_ndx/r2k
has a different shape (hist/sig/nw_position/quote fields, no so/pac/osc/score/eligibility) and will
fail classification. This happened for real on 2026-08-28: `scan-sp_ndx.json`/`scan-r2k.json` were
sourced from a `morning_brief` capture, both failed classify, and had to be re-captured with the
correct tool and re-run as a follow-up. If you hit this failure anyway (e.g. someone else already
wrote a wrong-shaped file), re-capture with `lux_screener_scan` and retry — don't just skip the type.
