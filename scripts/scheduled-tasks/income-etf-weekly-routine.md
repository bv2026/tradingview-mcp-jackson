---
name: income-etf-weekly-routine
description: Saturday 10 AM — income ETF weekly monitor scan, report, sent directly as Gmail email
---

You are running the Saturday weekly income ETF monitor for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Run the following steps IN ORDER without stopping or asking for confirmation. Do NOT skip any step.

---

## DIAGNOSTIC LOGGING (temporary — for tracking down a stalled/silent run)

This routine has stalled unattended before with no visible transcript afterward. A log written only
AFTER a tool call succeeds shows nothing if that call never returns (e.g. it's stuck on an approval
prompt with nobody there to answer) — so log BEFORE each tool call too. The gap between the last
"CALLING" line and a missing matching result line IS the diagnostic: it pinpoints exactly which call
was blocked.

Compute today's ISO week folder (YYYY-WkNN) first, same as STEP 1 below, and log to:
reports/inc-etf/{YYYY-WkNN}/_run-log.txt

For every entry: Read the file if it exists (else start from empty), append one ISO-timestamped line,
then Write the full content back. Do this synchronously at each of these points, in order:
1. Before anything else: `START income-etf-weekly-routine`
2. Immediately BEFORE calling tv_health_check: `CALLING tv_health_check`
3. Immediately AFTER it returns: `tv_health_check ok (cdp_connected=<bool>)` or the exact error
4. Immediately BEFORE calling income_etf_monitor: `CALLING income_etf_monitor`
5. Immediately AFTER it returns: `income_etf_monitor ok (universe=<N>, qualified=<N>)` or the exact error
6. Immediately BEFORE calling session_save (end of STEP 3): `CALLING session_save`
7. Immediately AFTER it returns: `session_save ok` or the exact error
8. Immediately BEFORE calling send_message (STEP 4): `CALLING send_message`
9. Immediately AFTER it returns: `send_message ok — id <message id>` or the exact error
10. At the very end: `DONE`

---

## STEP 0: HEALTH CHECK
Call tv_health_check. If it returns success:false or cdp_connected:false, STOP immediately and report:
"Income ETF weekly routine aborted — TradingView CDP not available. Ensure TradingView is running with --remote-debugging-port=9222."

---

## STEP 1: DETERMINE REPORT WEEK
Compute today's date (Saturday). Derive:
- ISO week folder: YYYY-WkNN (Monday-start, year-prefixed, e.g. 2026-Wk30)

All income ETF weekly artifacts save to: C:\work\tradingview-mcp-jackson\reports\inc-etf\{YYYY-WkNN}\
  - scan-income_etf.json  (saved automatically by income_etf_monitor)
  - income_etf-alerts.json  (saved automatically by income_etf_monitor)
  - income_etf.md  (saved by session_save in Step 3)

---

## STEP 2: RUN INCOME ETF MONITOR
Call income_etf_monitor with:
  screener_name="WKLY-DIV-ETF"
  frequency="all"
  portfolio_value=100000
  min_score=55
  maximum_position_pct=8
  maximum_exposure_pct=30

The monitor internally runs the full scan, persists scan-income_etf.json and income_etf-alerts.json,
compares with the most recent prior distinct weekly snapshot, generates alerts, and returns
deterministic structured data.

If the call returns success:false or the result indicates a TradingView, screener, or tab failure:
- STOP. Do NOT proceed to report rendering.
- Report the exact error message.

---

## STEP 3: RENDER THE REPORT AND SAVE
Follow the `instruction` field from the monitor result to render a Markdown accumulation report.

Required sections (in order):
1. Portfolio Decision
2. Executive Snapshot
3. Change Alerts — critical first, then warning, then informational
4. Selected Portfolio
5. Why Cash Is Retained (omit section entirely if cash_pct = 0)
6. Exposure Review
7. Watchlist
8. Rebalance Recommendations (omit if no actual_portfolio was supplied)
9. Reinvestment Projection
10. Portfolio Actions

Rendering rules:
- Use ONLY the values from the structured result. Do NOT recalculate scores, allocations, income, or projections.
- Do NOT invent tax phases, ticker assignments, or totals absent from the result.
- For cash retention: if portfolio.cash_pct > 0, state the reason (too few qualifying funds, exposure cap hit, score gate).

After rendering, call session_save with:
  instrument_type="income_etf"

session_save writes reports/inc-etf/{YYYY-WkNN}/income_etf.md.

---

## STEP 4: SEND GMAIL EMAIL DIRECTLY

**Do NOT hand-convert the markdown to HTML.** Run the shared converter script instead — it emits
Gmail-safe HTML (plain `border`/`cellpadding`/`bgcolor` attributes, never CSS `background`, since
Gmail's send pipeline strips `<style>` blocks, `class` attributes, and any inline
`style="...background..."` — confirmed 2026-08-15) and is far cheaper than re-deriving the same
conversion by reasoning through the file every week:

  `node C:\work\tradingview-mcp-jackson\scripts\md-to-html.mjs reports/inc-etf/{YYYY-WkNN}/income_etf.md reports/inc-etf/{YYYY-WkNN}/income_etf.html`

Read the generated `income_etf.html` back and use its exact contents as the email body — do not
re-type or re-format it.

Call mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step) with:
  to: ["bvajjala@gmail.com"]
  subject: "Income ETF Weekly Monitor — {DATE}"
  htmlBody: the exact contents of income_etf.html read above

---

## DONE

Report:
- Universe size (total ETFs scanned)
- Qualified count (funds in model portfolio)
- Model invested % and cash %
- Alert counts (critical / warning / informational)
- File paths saved: scan JSON, alerts JSON, report MD
- "Gmail email sent" confirmation
- Any failures or partial results