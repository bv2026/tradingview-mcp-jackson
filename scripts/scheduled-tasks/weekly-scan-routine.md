---
name: weekly-scan-routine
description: Daily (weekdays) — run all 7 weekly-timeframe equity scans, save raw JSON, trigger weekly-decision-routine
---

You are running the weekly equity SCAN routine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Your ONLY job is to run the scans and save raw JSON results. Do NOT analyze, do NOT produce reports, do NOT send emails. Leave all reasoning for the decision routine.

Run steps IN ORDER without stopping or asking for confirmation.

## LOGGING + METRICS (write incrementally — do this even though nothing else instructs you to)

This routine and `weekly-decision-routine` share one append-only log per day, so a stalled run is diagnosable from disk alone. Append (do not overwrite) one line per event to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/_run-log.txt`, each line prefixed with an ISO timestamp (`date -u +%Y-%m-%dT%H:%M:%SZ`):
- At the very start of STEP 0, before anything else: `START weekly-scan-routine`. In the same Bash call, also capture `T0=$(date +%s)`.
- After each of the 7 scan types finishes its extract-to-file step in STEP 2: `SCAN <type> ok (N symbols)` or the error, plus `TIMING scan_<type> $((NOW-T_PREV))s` where `T_PREV` is the epoch captured right after the previous type's line (or T0 for the first type).
- After STEP 3's verification finishes: `VERIFY ok 7/7` (or however many passed) plus `TIMING step3_verify $((T3-T_LAST_SCAN))s`.
- At the very end: `DONE weekly-scan-routine` plus `TIMING total $((TEND-T0))s`.

Also log one data-volume line per scan type, right after its `SCAN <type> ok` line: `TOKENS-APPROX scan_<type> ~$((BYTES/4)) tokens ($BYTES bytes)` where `BYTES` is `wc -c` of that type's extracted `scan-<type>.json`. This is a byte-count proxy for data volume, not exact model token usage — it exists to spot which scan is unexpectedly slow or large, not as a billing-accurate figure. Do NOT include any of this in emails or reports shown to the user — `_run-log.txt` is local-only.

---

## STEP 0: HEALTH CHECK
Call tv_health_check. If success:false or cdp_connected:false, STOP immediately:
"Weekly scan routine aborted — TradingView CDP not available. Ensure TradingView is running with --remote-debugging-port=9222."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive:
- ISO week folder: YYYY-WkNN (Monday-start, year-prefixed, e.g. 2026-Wk30)
- Date folder: YYYY-Mon-DD (e.g. 2026-Jul-20)
- Full path: C:\work\tradingview-mcp-jackson\reports\{YYYY-WkNN}\{YYYY-Mon-DD}\

Create the folder if it does not exist.

---

## STEP 2: RUN ALL 7 SCANS IN SEQUENCE

Run each lux_screener_scan call one at a time. Wait for each to complete before starting the next.

**BATCH SIZE — always `max_symbols=20`, no exceptions.** Confirmed repeatedly (2026-08-15): `max_symbols=50` or `60` reliably times out at the MCP transport layer even when the system is completely healthy — this is a duration limit, not a real failure, and retrying the same large batch just times out again. `20` is the largest size that consistently completes. Do not "optimize" by trying bigger batches — it costs more time/tokens via retries than it saves.

**DO NOT read, extract, or hand-transcribe each call's response body.** This was the single biggest source of wasted tokens in earlier runs (repeatedly copying ~50K-character inline JSON payloads by hand). It is unnecessary: every `lux_screener_scan` call — whether its response prints inline or auto-saves to a file for being too large — already persists the result to `C:\work\tradingview-mcp-jackson\evidence\latest\<type>.raw.json`, and for split scans (multiple offset calls for the same instrument_type back-to-back) it automatically **accumulates and dedupes across calls**, so by the time the last offset batch for a type finishes, that file already holds the complete, deduped, merged symbol set. Just fire each offset call and move to the next one — do not read its output.

**Extracting the final report for each type — one command, after all of that type's offset batches are done:**
  `node scripts/scan-extract.mjs C:\work\tradingview-mcp-jackson\evidence\latest\<type>.raw.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-<type>.json <instrument_type> --full`
This reads the tool's own accumulated file directly — no scan-merge.mjs, no scratch files, no manual JSON copying, for any instrument type (split or single-call).

**Caveat:** the accumulation file (`evidence/latest/<type>.raw.json`) is not date-scoped. If a previous run was interrupted mid-sequence for a type and left it half-populated, that stale partial state could rarely bleed into a later run for the same type. If `scan-verify.mjs` in STEP 3 reports a symbol count that looks obviously wrong for a type (e.g. far under the expected universe size below), re-run that type's full offset sequence from offset=0 before trusting the extracted file.

**Scan 1 — momentum_stocks (~100 symbols):**
  Calls: lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" max_symbols=20, offset=0,20,40,60,80
  Extract to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_stocks.json

**Scan 2 — momentum_etf (~100 symbols):**
  Calls: lux_screener_scan instrument_type="momentum_etf" timeframe="1W" max_symbols=20, offset=0,20,40,60,80
  Extract to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_etf.json

**Scan 3 — sp_ndx (~36 symbols, usually fits in one call):**
  lux_screener_scan instrument_type="sp_ndx" timeframe="1W"
  Extract to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-sp_ndx.json

**Scan 4 — r2k (~25 symbols, usually fits in one call):**
  lux_screener_scan instrument_type="r2k" timeframe="1W"
  Extract to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-r2k.json

**Scan 5 — momentum_ark (~117 symbols):**
  Calls: lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20, offset=0,20,40,60,80,100
  Extract to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_ark.json

**Scan 6 — thematic_stocks (~117 symbols):**
  Calls: lux_screener_scan instrument_type="thematic_stocks" timeframe="1W" max_symbols=20, offset=0,20,40,60,80,100
  Extract to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_stocks.json

**Scan 7 — thematic_etfs (~77 symbols, NOT ~90 — corrected 2026-08-15 from actual `slice_range` totals):**
  Calls: lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" max_symbols=20, offset=0,20,40,60
  Extract to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_etfs.json

Each type's symbol universe can drift slightly week to week — treat the offset lists above as a starting point and keep going in steps of 20 until a call's `slice_range` (e.g. `"81–100 of 100"`) shows you've reached the total; the exact total is authoritative over the counts noted here.

If a scan call errors persistently (not just a timeout — see the retry guidance below) after retrying once, save `{ "instrument_type": "...", "error": "<message>", "symbols_raw": [] }` to that type's report path instead.

**Transient timeouts:** if a single call times out ("Request timed out") but `tv_health_check` still reports `cdp_connected: true`, this is a known transient MCP timeout — just retry the identical call once before treating it as a real failure.

**Broken screener indicators (all-UNVERIFIED, flat score-2 pattern):** if a call succeeds but every symbol has `so_status`/`pac_status`/`osc_status` all `"UNVERIFIED"` and a flat `score: 2` (with `top_section` saying "No symbols scanned"), the S&O/PAC/OSC screener indicators are broken. Do NOT try to diagnose or manually fix this via screenshots, `chart_manage_indicator` remove/re-add (it fails silently with `entity_id: null` when broken this way), or other inspection steps — go straight to: call `mcp__tradingview__tv_launch` with `kill_existing: true`, wait for `tv_health_check` to report `cdp_connected: true` again, then simply retry the same `lux_screener_scan` call — it auto-navigates to and recreates the LUXALGO_SCREENERS tab with healthy indicators on its own; no manual indicator re-add is needed after the restart (confirmed 2026-08-15).

---

## STEP 3: VERIFY ALL 7 FILES

Check that all 7 of these files exist in today's reports folder AND do not contain a top-level "error" key.
Use `scripts/scan-verify.mjs` (already allowlisted in this project's `.claude/settings.json`) instead of
hand-rolled `node -e` or PowerShell checks — those aren't allowlisted and will stall the run on an approval
prompt nobody is there to answer:
  `node scripts/scan-verify.mjs reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_stocks.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_etf.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-sp_ndx.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-r2k.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_ark.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_stocks.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_etfs.json`

Prints one line per file: `OK` (structurally and semantically healthy), `WARN` (a narrower/heuristic
data-quality signal — e.g. a specific symbol TradingView couldn't resolve, or a batch-wipeout/NW-check-
truncation pattern — printed but does NOT fail the exit code), `MISSING`, or `ERROR`. Exits non-zero only
for MISSING/ERROR/structurally-invalid files or a confirmed `indicator_error_warning` (S&O/OSC entered
TradingView's own error state mid-scan — the data downstream of that point is not real, not just
incomplete). Added 2026-08-15 after an r2k scan shipped with 10 symbols' worth of blank so/pac/osc data
that was initially misdiagnosed as an "illiquid small-cap quirk" — see `checkScanHealth()` in
`src/core/lux-scan-contract.js` for the full incident writeup and detection logic. **Read every WARN line
in the output, not just the exit code** — these are exactly the kind of silent-corruption signal that
led to that incident, and decision-classify.mjs / the LLM's trade-decision reasoning downstream has no
other way to know about them.

Likewise, if a temp-file cleanup step needs confirming, use the already-allowlisted POSIX-style
`Bash(rm -f /c/Windows/Temp/*)` form (paths starting `/c/...`), not a Windows-style `C:/Windows/Temp/...`
rm or a PowerShell `Get-ChildItem` — neither of those is allowlisted and both will stall on approval.

**Do NOT schedule or trigger `weekly-decision-routine` from here.** It runs on its own fixed weekday
cron schedule (~6:50pm ET, buffered ~42 min after this routine's 6:08pm start) and re-derives today's
report folder itself — no hand-off needed. This routine's job ends at file verification. (Previously this
step called `create_scheduled_task`/`update_scheduled_task` to dynamically arm a one-shot follow-up task;
that was removed 2026-07-30 because `mcp__scheduled-tasks__*` calls require live human approval regardless
of `.claude/settings.json`, which is an unnecessary dependency for something a fixed schedule handles for free.)

**If ANY file is missing or contains an error:**
Report which scans failed and instruct the user to re-run those scans manually before `weekly-decision-routine`'s
next fixed-schedule run, since it will otherwise proceed with whatever scan files exist at ~6:50pm and note
the rest as missing (per its own STEP 1) rather than failing outright.

---

## DONE
Report:
- Which scans succeeded and how many symbols each returned
- Which scans failed (if any) and why
- Confirm all JSON files saved
- Reminder that weekly-decision-routine will pick these up automatically on its own ~6:50pm schedule