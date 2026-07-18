---
name: decision-email-routine
description: Reads saved briefs and CT+TV data, produces 3 decision HTML files and 3 Gmail drafts
---

You are running the decision engine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Run the following steps IN ORDER without stopping or asking for confirmation.

--- STEP 0: LOCATE TODAY'S REPORTS FOLDER ---
Determine today's date. Compute the ISO week folder (YYYY-WkNN, Monday-start) and date folder (YYYY-Mon-DD).
The reports base path is: C:\work\tradingview-mcp-jackson\reports\{YYYY-WkNN}\{YYYY-Mon-DD}\

--- STEP 1: VERIFY REQUIRED FILES EXIST ---
Check that ALL THREE of the following files exist in today's reports folder:
  1. crypto.md
  2. crypto_perps.md
  3. futures.md

Also check that ct_tv_data.json exists in the same folder.

If ANY of these 4 files is missing, STOP immediately and report:
  "Decision engine aborted — missing required file(s): [list missing files]. Run futures-morning-routine first."

Do NOT proceed if any file is missing.

--- STEP 2: READ ALL INPUT DATA ---
Read all 4 files into context:
  - crypto.md          (full text)
  - crypto_perps.md    (full text)
  - futures.md         (full text)
  - ct_tv_data.json    (full JSON)

Also read the 3 strategy files:
  - C:\work\tradingview-mcp-jackson\config\strategy-crypto.json
  - C:\work\tradingview-mcp-jackson\config\strategy-crypto_perps.json
  - C:\work\tradingview-mcp-jackson\config\strategy-futures.json

--- STEP 3: CRYPTO DECISION EMAIL ---
Using ONLY the raw data from crypto.md and the rules in strategy-crypto.json, reason through each symbol and produce trade decisions. Do not apply rules beyond what is in the strategy file. Use your own judgment.

Key rules to apply from strategy-crypto.json:
- Each symbol is evaluated independently on its own TWB + NW + S/R signals
- No BTC benchmark — do NOT use BTC as a filter or gate for other symbols
- sr_break > 0 overrides NW extension for longs
- Long only (spot)

Render as complete HTML with inline styles only:
<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:800px">
  <h1>Crypto Decision Brief — {DATE}</h1>
  <p style="font-size:12px;color:#666">TV only · Coinbase spot · Each symbol evaluated independently</p>
  <h2>Trade Decisions</h2>
  [Top Setups table — EVERY cell must be filled. Columns: Symbol | Side (Long) | Entry | Stop | TP1 | Notes. Green row background #e8f5e9 for longs. Never leave Symbol or Side blank.]
  [Watch List as <ul> — include symbol name on each bullet]
  [Overall Read as <ul>]
  <h2>All Symbols Scanned</h2>
  [Table: Symbol | TWB Gap | NW Position | S/R Break | Bias | Watch]
</div>
Table style: border-collapse:collapse;width:100%;font-size:13px. TH: border:1px solid #ccc;padding:4px 8px;background:#f5f5f5. TD: border:1px solid #ccc;padding:4px 8px.

Save the HTML to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/crypto-decision.html
Read that file back and create a Gmail draft using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__create_draft:
  - to: ["bvajjala@gmail.com"]
  - subject: "Crypto Decision Brief — {DATE}"
  - htmlBody: exact file contents read from crypto-decision.html

Wait for draft creation to complete before proceeding.

--- STEP 4: CRYPTO PERPS DECISION EMAIL ---
Using ONLY the raw data from crypto_perps.md and the rules in strategy-crypto_perps.json, reason through each symbol and produce trade decisions.

Key rules to apply from strategy-crypto_perps.json:
- Each symbol is evaluated independently on its own TWB + NW signals
- No BTC benchmark — do NOT use BTC TWB as a gate for other symbols
- Both long AND short setups based on each symbol's own TWB histogram direction
- Commodity perps (SILVER, GOLD) evaluated on their own TWB + DXY direction

Render as complete HTML with inline styles only:
<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:800px">
  <h1>Perps Decision Brief — {DATE}</h1>
  <p style="font-size:12px;color:#666">TV only · Coinbase CDE · Both sides · Each symbol evaluated independently</p>
  <h2>Trade Decisions</h2>
  [Top Setups table — EVERY cell must be filled. Columns: Symbol | Side (Long/Short) | Entry | Stop | TP1 | Notes. Green row background #e8f5e9 for longs, red #fdecea for shorts. Never leave Symbol or Side blank.]
  [Watch List as <ul> — include symbol name on each bullet]
  [Overall Read as <ul>]
  <h2>All Symbols Scanned</h2>
  [Table: Symbol | TWB Gap | NW Position | Bias | Watch]
</div>
Table style: border-collapse:collapse;width:100%;font-size:13px. TH: border:1px solid #ccc;padding:4px 8px;background:#f5f5f5. TD: border:1px solid #ccc;padding:4px 8px.

Save the HTML to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/crypto-perps-decision.html
Read that file back and create a Gmail draft using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__create_draft:
  - to: ["bvajjala@gmail.com"]
  - subject: "Perps Decision Brief — {DATE}"
  - htmlBody: exact file contents read from crypto-perps-decision.html

Wait for draft creation to complete before proceeding.

--- STEP 5: FUTURES DECISION EMAIL ---
Using the raw data from futures.md AND ct_tv_data.json combined, plus the rules in strategy-futures.json, reason through each market and produce trade decisions.

Key rules to apply from strategy-futures.json:
- CT direction is ALWAYS the primary signal
- TV TWB gap and NW position are timing context only
- CT and TV must agree for a trade (both CT and TV bias aligned)
- Sector concentration rules apply (max 1 energy position: CL/BZ/NG)

Render as complete HTML with inline styles only:
<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:800px">
  <h1>Futures Decision Brief — {DATE}</h1>
  <p style="font-size:12px;color:#666">CT primary · TV timing</p>
  <h2>Trade Decisions</h2>
  [Top Setups table — EVERY cell must be filled. Columns: Market (TV symbol e.g. GC1!) | Side (Long/Short) | Entry | Stop | TP1/TP2 | Notes. Green row background #e8f5e9 for longs, red #fdecea for shorts. Never leave Market or Side blank.]
  [Watch List as <ul> — include symbol name on each bullet]
  [Overall Read as <ul>]
  <h2>Combined Data</h2>
  [ALL markets from ct_tv_data.json: Market | CT Bias | ST | LT | Close | Pivot | R1 | TV NW | TV Gap | TV Watch]
</div>
Table style: border-collapse:collapse;width:100%;font-size:13px. TH: border:1px solid #ccc;padding:4px 8px;background:#f5f5f5. TD: border:1px solid #ccc;padding:4px 8px.

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/futures-decision.html
Read that file back and create a Gmail draft using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__create_draft:
  - to: ["bvajjala@gmail.com"]
  - subject: "Futures Decision Brief — {DATE}"
  - htmlBody: exact file contents read from futures-decision.html

--- DONE ---
Report: crypto Top Setups count, perps Top Setups count, futures Top Setups vs Watch List count, confirm all 3 Gmail drafts created.
