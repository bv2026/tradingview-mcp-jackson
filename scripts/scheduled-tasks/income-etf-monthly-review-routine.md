---
name: income-etf-monthly-review-routine
description: First Sunday of month 11 AM — income ETF monthly governance review (self-gates to first Sunday only)
---

You are running the monthly income ETF governance review for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Run the following steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: FIRST-SUNDAY GATE
Compute today's date. If today's date is greater than 7, it is NOT the first Sunday of the month.
STOP and report:
"Income ETF monthly review skipped — today ({DATE}) is not the first Sunday of the month. Next run will check again next Sunday."

If today's date is 1–7 and it is a Sunday, continue.

---

## STEP 1: DETERMINE REVIEW MONTH
The review covers the PREVIOUS calendar month, which has completed weekly scans.
Compute the previous month date:
- If today is e.g. 2026-Aug-03, previous month = July → use date string "2026-07-01"
- If today is 2027-Jan-05, previous month = December 2026 → use date string "2026-12-01"

---

## STEP 2: RUN MONTHLY REVIEW
Call income_etf_monthly_review with:
  date="{PREVIOUS-MONTH-DATE}"  (any YYYY-MM-DD in the previous calendar month)

If the call throws "No completed income ETF weekly snapshots were found for the review month":
- STOP and report: "Income ETF monthly review aborted — no weekly snapshots found for {PREVIOUS-MONTH}. Ensure the weekly Saturday routine ran at least once last month."

---

## STEP 3: RENDER THE MONTHLY REVIEW AND SAVE
Follow the `instruction` field from the result to render the Markdown monthly governance review.

Required sections (in order):
1. Monthly Decision — headline: maintain / reduce / expand / watch
2. Weekly Snapshot Table — all weeks in the month: week | generated_at | universe_size | qualified_count | invested_pct | cash_pct
3. Persistent Qualifications — funds with maximum_consecutive_qualified_scans >= 2 (confirmed)
4. Pending Confirmations — funds with maximum_consecutive_qualified_scans = 1 (not yet confirmed)
5. Entries Since First Scan — appeared in latest portfolio but not the first
6. Exits Since First Scan — were in first portfolio but absent from latest
7. Latest Portfolio Target — from latest_portfolio (positions, weights, cash)
8. NAV vs Income Observations — draw from ticker_summary latest_nav_total_return_1m_pct vs latest_indicated_yield_pct trends
9. Items for Review — NAV declines, pending confirmations approaching two scans, issuer checks due

Rendering rules:
- Do NOT recalculate scores, allocations, income, or persistence counts.
- Do NOT describe a one-scan candidate (pending_confirmation) as confirmed.
- Use the structured result values exactly as returned.

After rendering, call session_save with:
  instrument_type="income_etf_monthly_review"
  date="{PREVIOUS-MONTH-DATE}"

session_save writes reports/inc-etf/Mon-review/{YYYY-Mon}/monthly-review.md.

---

## STEP 4: SEND GMAIL EMAIL DIRECTLY

**Do NOT hand-convert the markdown to HTML.** Run the shared converter script instead — it emits
Gmail-safe HTML (plain `border`/`cellpadding`/`bgcolor` attributes, never CSS `background`, since
Gmail's send pipeline strips `<style>` blocks, `class` attributes, and any inline
`style="...background..."` — confirmed 2026-08-15) and is far cheaper than re-deriving the same
conversion by reasoning through the file every month:

  `node C:\work\tradingview-mcp-jackson\scripts\md-to-html.mjs reports/inc-etf/Mon-review/{YYYY-Mon}/monthly-review.md reports/inc-etf/Mon-review/{YYYY-Mon}/monthly-review.html`

Read the generated `monthly-review.html` back and use its exact contents as the email body — do
not re-type or re-format it.

Call mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step) with:
  to: ["bvajjala@gmail.com"]
  subject: "Income ETF Monthly Governance Review — {PREVIOUS-MONTH}"  (e.g. "Income ETF Monthly Governance Review — 2026-Jul")
  htmlBody: the exact contents of monthly-review.html read above

---

## DONE

Report:
- Review month covered
- Number of weekly snapshots aggregated
- Persistent qualified count and pending count
- Entries and exits since first scan
- "Gmail email sent" confirmation
- Any failures