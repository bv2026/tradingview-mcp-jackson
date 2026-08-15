---
name: futures-morning-routine
description: Run crypto, crypto_perps, and futures morning briefs daily, save data. decision-email-routine picks these up on its own fixed schedule
---

You are running the morning data-collection routine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Run the following steps IN ORDER without stopping or asking for confirmation.

--- STEP 0: HEALTH CHECK ---
Call tv_health_check. If it returns success:false or cdp_connected:false, STOP immediately and report: "Morning routine aborted — TradingView CDP not available. Check that TradingView is running with --remote-debugging-port=9222." Do not proceed to any further steps.

**HANDLING EACH morning_brief CALL'S RESULT — use the script, never hand-parse:**
`scripts/brief-extract.mjs` strips the raw per-symbol indicators/nw_envelope_signals dump (already redundant with the precomputed hist/sig/gap/bias/nw_position/sr_*/regime fields) down to just what a brief needs. Never write an inline `python -c`/`cat` command to inspect or condense a morning_brief result — that code differs every run and can never be pre-approved for unattended execution. Two cases:

1. **Result auto-saved to a file** (the tool call errors with "Output has been saved to `<path>`" — the common case for crypto/crypto_perps at ~29-30 symbols each). Run:
   `node scripts/brief-extract.mjs <path> C:\Windows\Temp\<type>_extracted.json`
   Then Read `C:\Windows\Temp\<type>_extracted.json` — it's small enough to read in one call.
2. **Result printed inline** (small calls). Use the Write tool to save the returned JSON verbatim to `C:\Windows\Temp\<type>_raw.json`, then run brief-extract.mjs on that scratch file exactly as in case 1.

Delete the `C:\Windows\Temp\<type>_*.json` scratch files once each brief is saved via session_save.

--- STEP 1: CRYPTO BRIEF ---
Call morning_brief instrument_type="crypto". Extract per above if needed, then apply the strategy's bias_criteria/entry_criteria to the (extracted or inline) symbols_scanned data per CLAUDE.md's crypto formatting convention, and call session_save instrument_type="crypto" with the complete brief text. Wait for session_save to complete before proceeding.

--- STEP 2: CRYPTO PERPS BRIEF ---
Call morning_brief instrument_type="crypto_perps". Extract per above if needed, then apply the strategy's rules (BTC perp TWB histogram sign gates long-vs-short scanning) per CLAUDE.md's crypto_perps formatting convention, and call session_save instrument_type="crypto_perps". Wait for session_save to complete before proceeding.

--- STEP 3: FUTURES BRIEF ---
Call morning_brief instrument_type="futures". Extract per above if needed, then apply the strategy's bias/regime rules per CLAUDE.md's futures formatting convention, and call session_save instrument_type="futures". Wait for session_save to complete before proceeding.

**FUTURES.MD FORMAT CONTRACT — ct_tv_data.py parses this file with strict regex; any deviation silently breaks the pipeline:**
- SYMBOL column: bare ticker ONLY (e.g. `ES1!`) — no exchange prefix, no parenthetical suffix like "(S&P)"
- Hist/sig numeric values: use ASCII hyphen-minus `-` (U+002D) for negatives — NEVER the Unicode minus `−` (U+2212)
- Section headers: must be exactly `**Benchmark:**` and `**Theme:**` — do not rename them
See CLAUDE.md lines ~67–69 for the full rationale. If ct_tv_data.py exits code 2 in STEP 4, the brief's formatting is the first thing to check.

--- STEP 4: RUN CT+TV DATA FETCHER ---
Determine today's date in YYYY-Wk{NN} / YYYY-Mon-DD folder format (same as the reports directory used by session_save above).

Create the folder if needed: `mkdir -p C:/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}` (absolute path — matches the allowlisted pattern exactly).

Run this exact command (no redirection or chaining) and capture its stdout:
    python C:\work\tradingview-mcp-jackson\scripts\ct_tv_data.py

If the command fails (non-zero exit or {"error":...} in output), STOP and report the error. Do not proceed.

After the command succeeds, validate the output BEFORE saving:
- Parse the JSON and check `_validation.null_gap_count` and `_validation.tv_mapped_count`
- If `null_gap_count / tv_mapped_count > 0.5`, STOP and report: "CT/TV pipeline failure — TV data parsing broken (futures.md format may have changed). Do NOT save ct_tv_data.json. Fix ct_tv_data.py first."
- Only save if validation passes.

Use the Write tool (not shell redirection) to save the captured stdout verbatim to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/ct_tv_data.json

--- STEP 5: (none — decision-email-routine runs on its own fixed schedule) ---
Do NOT call create_scheduled_task or update_scheduled_task here. decision-email-routine now runs on its
own fixed daily cron schedule (~8:15am ET, buffered ~45 min after this routine's 7:30am start) and
re-derives today's report folder itself — no hand-off needed. (Previously this step called
update_scheduled_task to dynamically re-arm a one-shot fireAt; that was removed 2026-07-30 because
mcp__scheduled-tasks__* calls require live human approval regardless of .claude/settings.json, which is
an unnecessary dependency for something a fixed schedule handles for free.)

--- DONE ---
Report: all 3 briefs saved, ct_tv_data.json saved. decision-email-routine will pick these up automatically
on its own ~8:15am schedule.