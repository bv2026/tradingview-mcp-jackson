# Skill: scan-crypto-perps

Standalone E2E pipeline for the Crypto Perps strategy — from scan to Gmail email.
Invoke with `/scan-crypto-perps`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-crypto-perps aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: CRYPTO PERPS BRIEF

**NOTE:** crypto_perps uses the same chart tab as crypto (`6y8jPo4Y` MY-PERPS). If you ran `/scan-crypto` in this same session, wait for it to complete fully before running this skill — do not run both simultaneously.

Call `morning_brief instrument_type="crypto_perps"`.

**Handle result:**
- If auto-saved to a file: run `node scripts/brief-extract.mjs <path> C:\Windows\Temp\crypto_perps_extracted.json`
- If returned inline: Write JSON to `C:\Windows\Temp\crypto_perps_raw.json`, then run `node scripts/brief-extract.mjs C:\Windows\Temp\crypto_perps_raw.json C:\Windows\Temp\crypto_perps_extracted.json`

Read `C:\Windows\Temp\crypto_perps_extracted.json`.

Apply strategy rules from `config/strategy-crypto_perps.json`. Key rules:
- **Benchmark: BTC perp TWB Histogram direction.** Positive → scan ALL for LONG. Negative → scan ALL for SHORT.
- Both sides active (long AND short)
- Commodity perps (SILVER/GOLD) exempt from BTC benchmark — use their own TWB + DXY direction
- Format per CLAUDE.md crypto_perps conventions: Top 3 LONG or Top 3 SHORT, per-symbol table, Overall Market Read

Call `session_save instrument_type="crypto_perps"` with the complete formatted brief.

Delete scratch files:
```bash
rm -f /c/Windows/Temp/crypto_perps_extracted.json /c/Windows/Temp/crypto_perps_raw.json
```

---

## STEP 3: CRYPTO PERPS DECISION EMAIL

Read `config/strategy-crypto_perps.json` and the saved brief from STEP 2.

Write decisions to `C:\Windows\Temp\crypto_perps_decisions.json`:
```json
{
  "title": "Crypto Perps Decision Brief",
  "subtitle": "TV only · Coinbase CDE USDC perps · BTC TWB gates direction",
  "top_setups": [
    { "symbol": "BTC-PERP", "side": "Long", "entry": "...", "stop": "...", "tp1": "...", "notes": "..." }
  ],
  "watch_list_columns": ["Symbol", "NW Position", "Note"],
  "watch_list": [
    { "symbol": "ETH-PERP", "bias": "neutral", "col2": "inside", "col3": "..." }
  ],
  "overall_read": ["BTC TWB: positive — long bias", "bullet 2"],
  "all_symbols_columns": ["Symbol", "TWB Gap", "NW Position", "Bias", "Side", "Watch"],
  "all_symbols": [
    { "symbol": "BTC-PERP", "bias": "bullish", "col2": "...", "col3": "...", "col4": "...", "col5": "Long", "col6": "..." }
  ]
}
```

Every symbol from the brief goes in `all_symbols`. `bias` drives row shading (bullish=green, bearish=red). Side is "Long" or "Short" depending on BTC TWB direction.

Get today's date:
```bash
date "+%b %d, %Y"
```

Render HTML:
```bash
node /c/work/tradingview-mcp-jackson/scripts/daily-decision-render.mjs C:\Windows\Temp\crypto_perps_decisions.json C:\Windows\Temp\crypto_perps_email.html "{date}"
```

Read `C:\Windows\Temp\crypto_perps_email.html`.

---

## STEP 4: SEND EMAIL
Call `mcp__18e26973-458f-4842-a557-521c0713ac9e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Crypto Perps Decision Brief — {date}"`
- `body`: full HTML from `crypto_perps_email.html`
- `mimeType`: `"text/html"`

---

## STEP 5: CLEANUP
```bash
rm -f /c/Windows/Temp/crypto_perps_decisions.json /c/Windows/Temp/crypto_perps_email.html
```

Report: "scan-crypto-perps complete — email sent for {date}."
