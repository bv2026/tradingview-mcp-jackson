---
name: decision-email-routine
description: Daily ~8:15am ET (45-min buffer after futures-morning-routine) — reads the 3 saved morning briefs, produces 3 decision HTML files sent directly as 3 Gmail emails
---

You are running the decision engine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Run the following steps IN ORDER without stopping or asking for confirmation.

**Shell commands (the `node …render.mjs …` calls and any `rm`) use forward-slash paths**
(`C:/work/…`, `C:/Windows/Temp/…`). The Bash tool runs Git Bash, which strips unquoted
backslashes, so a literal `C:\work\x` becomes `C:workx` and fails. Read/Write tool paths may stay
in either style.

--- STEP 0: LOCATE TODAY'S REPORTS FOLDER ---
Determine today's date. Compute the ISO week folder (YYYY-WkNN, Monday-start) and date folder (YYYY-Mon-DD).
The reports base path is: C:\work\tradingview-mcp-jackson\reports\{YYYY-WkNN}\{YYYY-Mon-DD}\

--- STEP 1: VERIFY REQUIRED FILES EXIST ---
Check that ALL THREE of the following files exist in today's reports folder:
  1. crypto.md
  2. crypto_perps.md
  3. futures.md

If ANY of these 3 files is missing, STOP immediately and report:
  "Decision engine aborted — missing required file(s): [list missing files]. Run futures-morning-routine first."

Do NOT proceed if any file is missing.

--- STEP 2: READ ALL INPUT DATA ---
Read all 3 briefs into context:
  - crypto.md          (full text)
  - crypto_perps.md    (full text)
  - futures.md         (full text)

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

Write to `C:/Windows/Temp/crypto_decisions.json` (scratch file, not the reports folder):
```json
{
  "title": "Crypto Decision Brief",
  "subtitle": "TV only · Coinbase spot · Each symbol evaluated independently",
  "top_setups": [
    { "symbol": "BTC-USD", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "notes": "..." }
  ],
  "watch_list_columns": ["Symbol", "NW Position", "Note"],
  "watch_list": [
    { "symbol": "ETH-USD", "bias": "bearish", "col2": "early", "col3": "..." }
  ],
  "overall_read": ["bullet 1", "bullet 2"],
  "all_symbols_columns": ["Symbol", "TWB Gap", "NW Position", "S/R Break", "Bias", "Watch"],
  "all_symbols": [
    { "symbol": "BTC-USD", "bias": "bullish", "col2": "...", "col3": "...", "col4": "...", "col5": "...", "col6": "..." }
  ]
}
```
Every symbol from crypto.md goes in `all_symbols` (col2..col6 map positionally to
`all_symbols_columns[1..]`). `top_setups` is only the symbols that actually qualify as trade
decisions — never leave `symbol` or `side` blank on a row that's included. Side is always "Long"
for this type (spot, long only) — the script colors Long rows green automatically. `watch_list` and
`all_symbols` rows must both carry a top-level `bias` field ("bullish"/"bearish"/"neutral", matching
the symbol's TWB bias) — this drives row shading (bullish = green, bearish = red) independently of
whatever text appears in a visible column, and is required, not optional — confirmed 2026-08-15
that leaving it out renders a flat, uncolored table. `watch_list` is a table now, not a bulleted
list — keep each row's `col2`/`col3`/... short (a phrase, not a full sentence); put the fuller
reasoning across the row's columns rather than one long paragraph per symbol, which is what made
the old bulleted version repetitive and hard to scan (confirmed 2026-08-15, user feedback).
`overall_read` stays a flat array of short strings — it's cross-market prose, not per-symbol, so it
renders as a plain single-column table with no row coloring.

Then run:
  `node C:/work/tradingview-mcp-jackson/scripts/daily-decision-render.mjs C:/Windows/Temp/crypto_decisions.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/crypto-decision.html {DATE}`

Read the generated `crypto-decision.html` back and use its exact contents as the email body — do
not re-type or re-format it. Delete `C:/Windows/Temp/crypto_decisions.json` after the render succeeds.

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

Write to `C:/Windows/Temp/crypto_perps_decisions.json`:
```json
{
  "title": "Perps Decision Brief",
  "subtitle": "TV only · Coinbase CDE · Both sides · Each symbol evaluated independently",
  "top_setups": [
    { "symbol": "BTC-PERP", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "notes": "..." }
  ],
  "watch_list_columns": ["Symbol", "Candidate", "NW Position", "Note"],
  "watch_list": [
    { "symbol": "ETH-PERP", "bias": "bearish", "col2": "Short", "col3": "early", "col4": "..." }
  ],
  "overall_read": ["bullet 1", "bullet 2"],
  "all_symbols_columns": ["Symbol", "TWB Gap", "NW Position", "Bias", "Watch"],
  "all_symbols": [
    { "symbol": "BTC-PERP", "bias": "bullish", "col2": "...", "col3": "...", "col4": "...", "col5": "..." }
  ]
}
```
`side` is "Long" or "Short" per symbol — the script colors Long rows green, Short rows red
automatically. Never leave `symbol` or `side` blank on a row included in `top_setups`. `watch_list`
and `all_symbols` rows must both carry a top-level `bias` field ("bullish"/"bearish"/"neutral") —
this drives row shading the same way `side` does for top_setups; omitting it renders a flat,
uncolored table (confirmed 2026-08-15). `watch_list` is a table now, not a bulleted list — keep
each row's columns short phrases, not full sentences (confirmed 2026-08-15, user feedback: the old
bulleted version repeated the same phrasing across rows and was hard to scan). `overall_read` stays
a flat array of short strings, rendered as a plain single-column table with no row coloring.

Then run:
  `node C:/work/tradingview-mcp-jackson/scripts/daily-decision-render.mjs C:/Windows/Temp/crypto_perps_decisions.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/crypto-perps-decision.html {DATE}`

Read the generated `crypto-perps-decision.html` back and use its exact contents as the email body.
Delete `C:/Windows/Temp/crypto_perps_decisions.json` after the render succeeds.

Send it as a Gmail email using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step):
  - to: ["bvajjala@gmail.com"]
  - subject: "Perps Decision Brief — {DATE}"
  - htmlBody: exact file contents read from crypto-perps-decision.html

Wait for the send to complete before proceeding.

--- STEP 5: FUTURES DECISION EMAIL ---
Using ONLY the raw data from futures.md and the rules in strategy-futures.json, reason through each
market and produce trade decisions. (CannonEdge/CT consumption was removed 2026-08-30 — this is
now a TV-only decision, same shape as crypto/perps.)

Key rules to apply from strategy-futures.json:
- Each market is evaluated independently on its own TWB histogram + NW position + regime + S/R — no benchmark
- For each market determine the regime (TRENDING_LONG / TRENDING_SHORT / MEAN_REVERTING) from the brief's `regime` field + regime_detection rules, then apply the matching bias_criteria (trend_long/short, mean_rev_long/short)
- TWB gap sign is the primary directional read; NW position ("extended"/"early"/"inside") is timing context
- Apply macro_overlays from market_context (DXY affects metals/FX, ZB/ZN affects equity index, VX1! sets overall risk mode)
- Sector concentration rules apply (max 1 energy, 1 metals, 1 equity-index position; max 3 futures total)

**Do NOT hand-write HTML.** Write your decisions as a small JSON file instead, then run the shared
render script — same reasoning as STEP 3/4.

Write to `C:/Windows/Temp/futures_decisions.json`:
```json
{
  "title": "Futures Decision Brief",
  "subtitle": "TV only · CT/CannonEdge not used · Each market evaluated independently",
  "top_setups": [
    { "market": "GC1!", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "tp2": "...", "notes": "..." }
  ],
  "watch_list_columns": ["Market", "Candidate", "NW Position", "Note"],
  "watch_list": [
    { "symbol": "CL1!", "bias": "bullish", "col2": "Long", "col3": "early", "col4": "..." }
  ],
  "overall_read": ["bullet 1", "bullet 2"],
  "all_symbols_heading": "TradingView Futures Data",
  "all_symbols_columns": ["Market", "TWB Gap", "NW", "Regime", "S/R", "Watch"],
  "all_symbols": [
    { "symbol": "GC1!", "bias": "bullish", "col2": "+133.10", "col3": "extended", "col4": "TRENDING_LONG", "col5": "sup 55 / res 90", "col6": "buy dips only" }
  ]
}
```
`market` (or `symbol` — either key works) and `side` must never be blank on a `top_setups` row.
Include EVERY market from futures.md in `all_symbols`, not just the ones with trade decisions.
**`col2`..`colN` map positionally to `all_symbols_columns[1..]`, so the row needs exactly one
`colK` per column after "Market" — here col2..col6 for the 6-column header. `bias` is the
top-level row-color field, NOT a column.** `side` "Long"/"Short" drives `top_setups`/`watch_list`
row color automatically. `watch_list` and `all_symbols` rows must both carry a top-level `bias`
field ("bullish"/"bearish"/"neutral") — derive it from the market's TWB bias in futures.md (gap
sign). Omitting `bias` renders a flat, uncolored table (confirmed 2026-08-15). `watch_list` is a
table, not a bulleted list — keep each row's columns short phrases, not full sentences (confirmed
2026-08-15, user feedback). `overall_read` stays a flat array of short strings, rendered as a
plain single-column table with no row coloring.

Then run:
  `node C:/work/tradingview-mcp-jackson/scripts/daily-decision-render.mjs C:/Windows/Temp/futures_decisions.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/futures-decision.html {DATE}`

Read the generated `futures-decision.html` back and use its exact contents as the email body.
Delete `C:/Windows/Temp/futures_decisions.json` after the render succeeds.

Send it as a Gmail email using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step):
  - to: ["bvajjala@gmail.com"]
  - subject: "Futures Decision Brief — {DATE}"
  - htmlBody: exact file contents read from futures-decision.html

--- DONE ---
Report: crypto Top Setups count, perps Top Setups count, futures Top Setups vs Watch List count, confirm all 3 Gmail emails sent.