---
name: decision-email-routine
description: Daily ~8:15am ET (45-min buffer after futures-morning-routine) — reads saved briefs + CT/TV data, produces 3 decision HTML files sent directly as 3 Gmail emails
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

**Do NOT hand-write HTML.** Write your decisions as a small JSON file instead, then run the shared
render script — it mechanically produces Gmail-safe HTML (plain `border`/`cellpadding`/`bgcolor`
attributes, never CSS `background`, since Gmail's send pipeline strips `<style>` blocks, `class`
attributes, and any inline `style="...background..."`). This is both cheaper (no more typing full
`<tr>/<td>` boilerplate by hand every day) and immune to that bug by construction.

Write to `C:\Windows\Temp\crypto_decisions.json` (scratch file, not the reports folder):
```json
{
  "title": "Crypto Decision Brief",
  "subtitle": "TV only · Coinbase spot · Each symbol evaluated independently",
  "top_setups": [
    { "symbol": "BTC-USD", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "notes": "..." }
  ],
  "watch_list": ["ETH-USD — reason...", "..."],
  "overall_read": ["bullet 1", "bullet 2"],
  "all_symbols_columns": ["Symbol", "TWB Gap", "NW Position", "S/R Break", "Bias", "Watch"],
  "all_symbols": [
    { "symbol": "BTC-USD", "col2": "...", "col3": "...", "col4": "...", "col5": "...", "col6": "..." }
  ]
}
```
Every symbol from crypto.md goes in `all_symbols` (col2..col6 map positionally to
`all_symbols_columns[1..]`). `top_setups` is only the symbols that actually qualify as trade
decisions — never leave `symbol` or `side` blank on a row that's included. Side is always "Long"
for this type (spot, long only) — the script colors Long rows green automatically.

Then run:
  `node C:\work\tradingview-mcp-jackson\scripts\daily-decision-render.mjs C:\Windows\Temp\crypto_decisions.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/crypto-decision.html {DATE}`

Read the generated `crypto-decision.html` back and use its exact contents as the email body — do
not re-type or re-format it. Delete `C:\Windows\Temp\crypto_decisions.json` after the render succeeds.

Send it as a Gmail email using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step):
  - to: ["bvajjala@gmail.com"]
  - subject: "Crypto Decision Brief — {DATE}"
  - htmlBody: exact file contents read from crypto-decision.html

Wait for the send to complete before proceeding.

--- STEP 4: CRYPTO PERPS DECISION EMAIL ---
Using ONLY the raw data from crypto_perps.md and the rules in strategy-crypto_perps.json, reason through each symbol and produce trade decisions.

Key rules to apply from strategy-crypto_perps.json:
- Each symbol is evaluated independently on its own TWB + NW signals
- No BTC benchmark — do NOT use BTC TWB as a gate for other symbols
- Both long AND short setups based on each symbol's own TWB histogram direction
- Commodity perps (SILVER, GOLD) evaluated on their own TWB + DXY direction

**Do NOT hand-write HTML.** Write your decisions as a small JSON file instead, then run the shared
render script — same reasoning as STEP 3 (cheaper, and immune to the Gmail background-CSS bug by
construction).

Write to `C:\Windows\Temp\crypto_perps_decisions.json`:
```json
{
  "title": "Perps Decision Brief",
  "subtitle": "TV only · Coinbase CDE · Both sides · Each symbol evaluated independently",
  "top_setups": [
    { "symbol": "BTC-PERP", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "notes": "..." }
  ],
  "watch_list": ["ETH-PERP — reason...", "..."],
  "overall_read": ["bullet 1", "bullet 2"],
  "all_symbols_columns": ["Symbol", "TWB Gap", "NW Position", "Bias", "Watch"],
  "all_symbols": [
    { "symbol": "BTC-PERP", "col2": "...", "col3": "...", "col4": "...", "col5": "..." }
  ]
}
```
`side` is "Long" or "Short" per symbol — the script colors Long rows green, Short rows red
automatically. Never leave `symbol` or `side` blank on a row included in `top_setups`.

Then run:
  `node C:\work\tradingview-mcp-jackson\scripts\daily-decision-render.mjs C:\Windows\Temp\crypto_perps_decisions.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/crypto-perps-decision.html {DATE}`

Read the generated `crypto-perps-decision.html` back and use its exact contents as the email body.
Delete `C:\Windows\Temp\crypto_perps_decisions.json` after the render succeeds.

Send it as a Gmail email using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step):
  - to: ["bvajjala@gmail.com"]
  - subject: "Perps Decision Brief — {DATE}"
  - htmlBody: exact file contents read from crypto-perps-decision.html

Wait for the send to complete before proceeding.

--- STEP 5: FUTURES DECISION EMAIL ---
Using the raw data from futures.md AND ct_tv_data.json combined, plus the rules in strategy-futures.json, reason through each market and produce trade decisions.

Key rules to apply from strategy-futures.json:
- CT direction is ALWAYS the primary signal
- TV TWB gap and NW position are timing context only
- CT and TV must agree for a trade (both CT and TV bias aligned)
- Sector concentration rules apply (max 1 energy position: CL/BZ/NG)

**Do NOT hand-write HTML.** Write your decisions as a small JSON file instead, then run the shared
render script — same reasoning as STEP 3/4.

Write to `C:\Windows\Temp\futures_decisions.json`:
```json
{
  "title": "Futures Decision Brief",
  "subtitle": "CT primary · TV timing",
  "top_setups": [
    { "market": "GC1!", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "tp2": "...", "notes": "..." }
  ],
  "watch_list": ["CL1! — reason...", "..."],
  "overall_read": ["bullet 1", "bullet 2"],
  "all_symbols_heading": "Combined Data",
  "all_symbols_columns": ["Market", "CT Bias", "ST", "LT", "Close", "Pivot", "R1", "TV NW", "TV Gap", "TV Watch"],
  "all_symbols": [
    { "symbol": "GC1!", "col2": "...", "col3": "...", "col4": "...", "col5": "...", "col6": "...", "col7": "...", "col8": "...", "col9": "...", "col10": "..." }
  ]
}
```
`market` (or `symbol` — either key works) and `side` must never be blank on a `top_setups` row.
Include EVERY market from ct_tv_data.json in `all_symbols`, not just the ones with trade decisions.
`side` "Long"/"Short" drives row color automatically.

Then run:
  `node C:\work\tradingview-mcp-jackson\scripts\daily-decision-render.mjs C:\Windows\Temp\futures_decisions.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/futures-decision.html {DATE}`

Read the generated `futures-decision.html` back and use its exact contents as the email body.
Delete `C:\Windows\Temp\futures_decisions.json` after the render succeeds.

Send it as a Gmail email using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step):
  - to: ["bvajjala@gmail.com"]
  - subject: "Futures Decision Brief — {DATE}"
  - htmlBody: exact file contents read from futures-decision.html

--- DONE ---
Report: crypto Top Setups count, perps Top Setups count, futures Top Setups vs Watch List count, confirm all 3 Gmail emails sent.