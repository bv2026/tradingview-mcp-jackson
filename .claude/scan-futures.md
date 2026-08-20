# Skill: scan-futures

Standalone E2E pipeline for the Futures strategy — from scan to Gmail email.
Invoke with `/scan-futures`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-futures aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive:
- ISO week folder: `YYYY-WkNN` (Monday-start, year-prefixed, e.g. `2026-Wk34`)
- Date folder: `YYYY-Mon-DD` (e.g. `2026-Aug-17`)
- Full path: `C:\work\tradingview-mcp-jackson\reports\{YYYY-WkNN}\{YYYY-Mon-DD}\`

Create the folder:
```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: FUTURES BRIEF
Call `morning_brief instrument_type="futures"`.

**Handle result:**
- If auto-saved to a file (tool returns a path): run `node scripts/brief-extract.mjs <path> /c/Windows/Temp/futures_extracted.json`
- If returned inline: Write the JSON verbatim to `/c/Windows/Temp/futures_raw.json`, then run `node scripts/brief-extract.mjs /c/Windows/Temp/futures_raw.json /c/Windows/Temp/futures_extracted.json`

Read `/c/Windows/Temp/futures_extracted.json`.

Apply strategy rules from `config/strategy-futures.json`. Format per CLAUDE.md futures conventions:
- SYMBOL column: bare ticker only (`ES1!` not `ES1! (S&P)`)
- Hist/sig values: ASCII hyphen-minus `-` for negatives (never Unicode `−`)
- Section headers: exactly `**Benchmark:**` and `**Theme:**`
- Hist/sig numeric format: `Hist ±X.XX ... sig ±Y.YY` in the SIGNAL cell

Call `session_save instrument_type="futures"` with the complete formatted brief.

---

## STEP 3: RUN CT+TV DATA FETCHER
```bash
python /c/work/tradingview-mcp-jackson/scripts/ct_tv_data.py
```

If non-zero exit, STOP and report the error.

Validate output JSON:
- Check `_validation.null_gap_count` / `_validation.tv_mapped_count`
- If `null_gap_count / tv_mapped_count > 0.5`, STOP: "CT/TV pipeline failure — futures.md format may have changed."

Use the Write tool to save captured stdout to:
`reports/{YYYY-WkNN}/{YYYY-Mon-DD}/ct_tv_data.json`

Delete scratch files:
```bash
rm -f /c/Windows/Temp/futures_extracted.json /c/Windows/Temp/futures_raw.json
```

---

## STEP 4: FUTURES DECISION EMAIL

Read `config/strategy-futures.json` and `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/ct_tv_data.json`.

**PRIMARY RULE: CT always wins.** CT ST/LT arrows determine direction. TV data (NW, TWB gap) is timing context only — it never overrides CT direction.

Write your decisions to `/c/Windows/Temp/futures_decisions.json`:
```json
{
  "title": "Futures Decision Brief",
  "subtitle": "CT primary · TV timing context · Daily",
  "top_setups": [
    { "symbol": "ES1!", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "notes": "..." }
  ],
  "watch_list_columns": ["Symbol", "CT Signal", "Note"],
  "watch_list": [
    { "symbol": "NQ1!", "bias": "neutral", "col2": "...", "col3": "..." }
  ],
  "overall_read": ["bullet 1", "bullet 2"],
  "all_symbols_columns": ["Symbol", "CT ST", "CT LT", "TV Gap", "NW Position", "Bias"],
  "all_symbols": [
    { "symbol": "ES1!", "bias": "bullish", "col2": "UP", "col3": "UP", "col4": "+174.8", "col5": "inside", "col6": "bullish" }
  ]
}
```

Every symbol from futures.md goes in `all_symbols`. `bias` field drives row shading (bullish=green, bearish=red). Side for top_setups: "Long" or "Short".

Get today's date string:
```bash
date "+%b %d, %Y"
```

Render the HTML:
```bash
node /c/work/tradingview-mcp-jackson/scripts/daily-decision-render.mjs /c/Windows/Temp/futures_decisions.json /c/Windows/Temp/futures_email.html "{date}"
```

Read `/c/Windows/Temp/futures_email.html`.

---

## STEP 5: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Futures Decision Brief — {date}"`
- `htmlBody`: full HTML content from `futures_email.html`

---

## STEP 6: CLEANUP
```bash
rm -f /c/Windows/Temp/futures_decisions.json /c/Windows/Temp/futures_email.html
```

Report: "scan-futures complete — email sent for {date}."
