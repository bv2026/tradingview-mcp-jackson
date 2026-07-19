---
name: weekly-scan-routine
description: Sunday 9 AM — run all 7 weekly equity scans, save raw JSON, trigger weekly-decision-routine
---

You are running the weekly equity SCAN routine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Your ONLY job is to run the scans and save raw JSON results. Do NOT analyze, do NOT produce reports, do NOT send emails. Leave all reasoning for the decision routine.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call tv_health_check. If success:false or cdp_connected:false, STOP immediately:
"Weekly scan routine aborted — TradingView CDP not available. Ensure TradingView is running with --remote-debugging-port=9222."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date (Sunday). Derive:
- ISO week folder: YYYY-WkNN (Monday-start, year-prefixed, e.g. 2026-Wk30)
- Date folder: YYYY-Mon-DD (e.g. 2026-Jul-20)
- Full path: C:\work\tradingview-mcp-jackson\reports\{YYYY-WkNN}\{YYYY-Mon-DD}\

Create the folder if it does not exist.

---

## STEP 2: RUN ALL 7 SCANS IN SEQUENCE

Run each lux_screener_scan call one at a time. Wait for each to complete before starting the next.

**MERGE RULE (applies to all split scans):**
After both halves return, combine their symbols_raw arrays, deduplicate by symbol, re-sort by score descending. Save ONLY these three fields — do NOT include table, top_candidates, avoid_list, chatter_section or any other field from the raw result (those fields are per-half artifacts and are meaningless or broken after merging):
  { "instrument_type": "...", "symbol_count": <total>, "symbols_raw": [...merged, deduped, sorted by score desc...] }

**Single-call scans (sp_ndx, r2k):** save the full result object as-is (no merge needed).

**Scan 1 — momentum_stocks (split, ~81 symbols):**
  Call 1a: lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" offset=0 max_symbols=50
  Call 1b: lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" offset=50
  Apply merge rule above.
  Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_stocks.json

**Scan 2 — momentum_etf (split, ~52 symbols):**
  Call 2a: lux_screener_scan instrument_type="momentum_etf" timeframe="1W" offset=0 max_symbols=30
  Call 2b: lux_screener_scan instrument_type="momentum_etf" timeframe="1W" offset=30
  Apply merge rule above.
  Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_etf.json

**Scan 3 — sp_ndx:**
  lux_screener_scan instrument_type="sp_ndx" timeframe="1W"
  Save full result to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-sp_ndx.json

**Scan 4 — r2k:**
  lux_screener_scan instrument_type="r2k" timeframe="1W"
  Save full result to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-r2k.json

**Scan 5 — momentum_ark (split, ~117 symbols):**
  Call 5a: lux_screener_scan instrument_type="momentum_ark" timeframe="1W" offset=0 max_symbols=60
  Call 5b: lux_screener_scan instrument_type="momentum_ark" timeframe="1W" offset=60
  Apply merge rule above.
  Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_ark.json

**Scan 6 — thematic_stocks (split, ~121 symbols):**
  Call 6a: lux_screener_scan instrument_type="thematic_stocks" timeframe="1W" offset=0 max_symbols=60
  Call 6b: lux_screener_scan instrument_type="thematic_stocks" timeframe="1W" offset=60
  Apply merge rule above.
  Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_stocks.json

**Scan 7 — thematic_etfs (split, ~90 symbols):**
  Call 7a: lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" offset=0 max_symbols=50
  Call 7b: lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" offset=50
  Apply merge rule above.
  Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_etfs.json

If a scan call errors or times out, save { "instrument_type": "...", "error": "<message>", "symbols_raw": [] }.

---

## STEP 3: VERIFY ALL 7 FILES THEN TRIGGER DECISION ROUTINE

Check that all 7 of these files exist in today's reports folder AND do not contain a top-level "error" key:
  scan-momentum_stocks.json
  scan-momentum_etf.json
  scan-sp_ndx.json
  scan-r2k.json
  scan-momentum_ark.json
  scan-thematic_stocks.json
  scan-thematic_etfs.json

**If ALL 7 files are present and valid (no errors):**
Schedule the decision routine to fire 5 minutes from now.
Call mcp__scheduled-tasks__create_scheduled_task with:
  taskId: "weekly-decision-routine-oneshot"
  description: "One-time weekly decision run triggered by weekly-scan-routine"
  prompt: (read the full contents of C:\Users\vsbra\.claude\scheduled-tasks\weekly-decision-routine\SKILL.md and pass it verbatim)
  fireAt: <ISO 8601 timestamp 5 minutes from now with local timezone offset>

**If ANY file is missing or contains an error:**
Do NOT schedule the decision routine.
Report which scans failed and instruct the user to re-run those scans manually, then trigger weekly-decision-routine manually from the Scheduled sidebar once all 7 files are present.

---

## DONE
Report:
- Which scans succeeded and how many symbols each returned
- Which scans failed (if any) and why
- Confirm all JSON files saved
- Either: "Decision routine scheduled for {fireAt}" or "Decision routine NOT triggered — fix failed scans first"
