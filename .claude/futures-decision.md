# Skill: futures-decision

Triggered automatically after `session_save instrument_type="futures"` saves today's futures brief.
Can also be invoked manually with `/futures-decision`.

## What this skill does

Combines CannonEdge CT evening data with the TradingView futures brief, reasons through trade decisions, renders an HTML email, and creates a Gmail draft.

---

## Step 1 — Fetch combined data

Run the data fetcher and capture its JSON output:

```bash
python scripts/ct_tv_data.py
```

If the script exits with an error (futures.md not found), stop and tell the user to run the futures brief first.

---

## Step 2 — Reason through the data

You are the decision engine. Apply these rules exactly:

**PRIMARY RULE: CT always wins.**
- CT ST/LT arrows determine trade direction. UP = long candidates only. DOWN = short candidates only.
- TV data (NW position, TWB gap) is timing context only. It never overrides CT direction.

**Timing rules (TV):**
- `tv_nw = early` → fresh signal, price near the band, room to run → timing is good
- `tv_nw = extended` → price already ran past the band → wait, do not enter now
- `tv_nw = inside` → price between bands → neutral timing, use TWB gap for conviction
- `tv_gap` positive + CT UP → bullish momentum confirms long
- `tv_gap` negative + CT DOWN → bearish momentum confirms short
- `tv_gap` conflicting with CT direction → note the conflict, CT still wins, but flag for Watch List

**Classification:**
- **Top Setup**: CT direction clear + TV timing ready (NW early or inside, gap confirms) + CT levels exist
- **Watch List**: CT direction clear but TV not ready (NW extended, or gap conflicts) — state what needs to change
- **Skip**: CT NEUTRAL, or no CT data

**For each Top Setup provide:**
- Direction (Long/Short)
- Entry zone (relative to CT Pivot)
- Stop (below Pivot for longs, above Pivot for shorts — use judgment on buffer)
- T1 (CT R1 for longs, S1 for shorts)
- T2 (CT R2 for longs, S2 for shorts)
- R:R estimate
- One-sentence reasoning grounded in the data

**Overall Read:**
- Macro theme (from TV macro/theme text)
- Sector alignment (which groups are CT+TV confirmed)
- Key risk (what could flip the picture)

---

## Step 3 — Render HTML email

Build a single HTML string with inline styles only (no external CSS, no markdown).

Structure:
```
<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:800px">
  <h1>Decision Brief — {DATE}</h1>
  <p style="font-size:12px;color:#666">CT primary · TV timing</p>

  <h2>Trade Decisions</h2>
  [Top Setups table — green (#2d7a2d) for longs, red (#c0392b) for shorts]
  [Watch List as <ul>]
  [Overall Read as <ul>]

  <h2>Combined Data</h2>
  [Raw CT+TV table: Market | CT Bias | ST | LT | Close | Pivot | T1 | TV NW | TV Gap | TV Watch]
</div>
```

Table style: `border-collapse:collapse;width:100%;font-size:13px`
TH style: `border:1px solid #ccc;padding:4px 8px;background:#f5f5f5`
TD style: `border:1px solid #ccc;padding:4px 8px`

---

## Step 4 — Save HTML to reports folder

Save the HTML to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/futures-decision.html`.

Use the same week/date folder logic as the futures brief — derive week folder from today's date using ISO week number: `{year}-Wk{week:02d}`.

---

## Step 5 — Create Gmail draft

Use the `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__create_draft` tool with these parameters:

- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Decision Brief — {DATE}"`
- `htmlBody`: the full HTML string rendered in Step 3

---

## Done

Report to the user:
- How many markets were in the CT snapshot
- How many had TV data
- How many Top Setups vs Watch List
- Confirm the Gmail draft was created
### CannonEdge supplemental evidence

`external_evidence.cannon` is independently sourced CannonTrading/CannonEdge daily context attached to futures rows. Preserve explicit agreement or conflict with TradingView TWB/NW/SR. Missing, unavailable, or stale Cannon is never a rejection or classification change. On intraday scans, Cannon remains daily higher-timeframe context.
