---
name: futures-morning-routine
description: Run crypto, crypto_perps, and futures morning briefs daily at 10:30 AM EST, save data, then trigger the decision-email-routine
---

You are running the morning data-collection routine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Run the following steps IN ORDER without stopping or asking for confirmation.

--- STEP 0: HEALTH CHECK ---
Call tv_health_check. If it returns success:false or cdp_connected:false, STOP immediately and report: "Morning routine aborted — TradingView CDP not available. Check that TradingView is running with --remote-debugging-port=9222." Do not proceed to any further steps.

--- STEP 1: CRYPTO BRIEF ---
Call morning_brief instrument_type="crypto". Follow the embedded instruction — write the full formatted crypto brief and call session_save instrument_type="crypto" with the complete brief text. Wait for session_save to complete before proceeding.

--- STEP 2: CRYPTO PERPS BRIEF ---
Call morning_brief instrument_type="crypto_perps". Follow the embedded instruction — write the full formatted crypto_perps brief and call session_save instrument_type="crypto_perps". Wait for session_save to complete before proceeding.

--- STEP 3: FUTURES BRIEF ---
Call morning_brief instrument_type="futures". Follow the embedded instruction — write the full formatted futures brief and call session_save instrument_type="futures". Wait for session_save to complete before proceeding.

--- STEP 4: RUN CT+TV DATA FETCHER ---
Determine today's date in YYYY-Wk{NN} / YYYY-Mon-DD folder format (same as the reports directory used by session_save above).

Run this command and capture the full JSON output:
    python C:\work\tradingview-mcp-jackson\scripts\ct_tv_data.py

If the command fails (non-zero exit or {"error":...} in output), STOP and report the error. Do not proceed.

Save the JSON output to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/ct_tv_data.json

--- STEP 5: TRIGGER DECISION ENGINE ---
Create a one-time scheduled task that fires 3 minutes from now:

Call mcp__scheduled-tasks__create_scheduled_task with:
  - name: "decision-email-routine"
  - skillPath: "C:\\Users\\vsbra\\.claude\\scheduled-tasks\\decision-email-routine\\SKILL.md"
  - fireAt: <ISO timestamp 3 minutes from now, e.g. "2026-07-18T10:45:00">
  - repeat: false

--- DONE ---
Report: all 3 briefs saved, ct_tv_data.json saved, decision-email-routine scheduled for {fireAt time}.
