# Skill: scan-crypto

Standalone E2E pipeline for the Crypto Spot strategy — from scan to Gmail email.
Invoke with `/scan-crypto`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-crypto aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: CRYPTO BRIEF
Call `morning_brief instrument_type="crypto"`.

**Handle result:**
- If auto-saved to a file: run `node scripts/brief-extract.mjs <path> /c/Windows/Temp/crypto_extracted.json`
- If returned inline: Write JSON to `/c/Windows/Temp/crypto_raw.json`, then run `node scripts/brief-extract.mjs /c/Windows/Temp/crypto_raw.json /c/Windows/Temp/crypto_extracted.json`

Read `/c/Windows/Temp/crypto_extracted.json`.

Apply strategy rules from `config/strategy-crypto.json`. Format per CLAUDE.md crypto conventions:
- Long only (spot, Coinbase USD pairs)
- No BTC benchmark gate — each symbol evaluated independently on TWB + NW + S/R
- `sr_break > 0` overrides NW extension for longs
- Include `### Top 3 Setups`, per-symbol markdown table, `## Overall Market Read`

Call `session_save instrument_type="crypto"` with the complete formatted brief.

Delete scratch files:
```bash
rm -f /c/Windows/Temp/crypto_extracted.json /c/Windows/Temp/crypto_raw.json
```

---

## STEP 3: CRYPTO DECISION EMAIL

Read `config/strategy-crypto.json` and the saved brief from STEP 2.

Write decisions to `/c/Windows/Temp/crypto_decisions.json`:
```json
{
  "title": "Crypto Spot Decision Brief",
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

Every symbol from the brief goes in `all_symbols`. `bias` field drives row shading (bullish=green, bearish=red). Side is always "Long" for spot.

Get today's date:
```bash
date "+%b %d, %Y"
```

Render HTML:
```bash
node /c/work/tradingview-mcp-jackson/scripts/daily-decision-render.mjs /c/Windows/Temp/crypto_decisions.json /c/Windows/Temp/crypto_email.html "{date}"
```

Read `/c/Windows/Temp/crypto_email.html`.

---

## STEP 4: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Crypto Spot Decision Brief — {date}"`
- `htmlBody`: full HTML from `crypto_email.html`

---

## STEP 5: CLEANUP
```bash
rm -f /c/Windows/Temp/crypto_decisions.json /c/Windows/Temp/crypto_email.html
```

Report: "scan-crypto complete — email sent for {date}."
