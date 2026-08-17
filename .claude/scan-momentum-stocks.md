# Skill: scan-momentum-stocks

Standalone E2E pipeline for Momentum Stocks — from scan to Gmail email.
Invoke with `/scan-momentum-stocks`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-momentum-stocks aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: SCAN (~100 symbols, 5 batches of 20)

**BATCH SIZE: always `max_symbols=20`.** Larger batches time out at the MCP transport layer — do not try to optimize with bigger values.

**Do NOT read or hand-transcribe each call's response.** Every `lux_screener_scan` call auto-saves and accumulates results to `evidence/latest/momentum_stocks.raw.json`. Just fire each call and move on.

Run all 5 calls in sequence:
```
lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" max_symbols=20 offset=20
lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" max_symbols=20 offset=40
lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" max_symbols=20 offset=60
lux_screener_scan instrument_type="momentum_stocks" timeframe="1W" max_symbols=20 offset=80
```

Keep going in steps of 20 if the last call's `slice_range` shows more symbols remain (the ~100 count can drift week to week).

**Transient timeouts:** if a call times out but `tv_health_check` still shows `cdp_connected:true`, retry once.

**Broken indicators (all-UNVERIFIED, flat score-2):** call `tv_launch kill_existing=true`, wait for health check to pass, then retry.

---

## STEP 3: EXTRACT TO FILE
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-extract.mjs /c/work/tradingview-mcp-jackson/evidence/latest/momentum_stocks.raw.json /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_stocks.json momentum_stocks --full
```

---

## STEP 4: VERIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-verify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_stocks.json
```

Read every WARN line — these signal silent corruption. If result is MISSING or ERROR, re-run STEP 2 from offset=0 before continuing.

---

## STEP 5: CLASSIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-classify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_stocks.json C:\Windows\Temp\class_momentum_stocks.json
```

---

## STEP 6: RENDER HTML EMAIL

Get today's date:
```bash
date "+%b %d, %Y"
```

Get the scan date (same as today's date folder, format `YYYY-Mon-DD`).

```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-render.mjs momentum_stocks C:\Windows\Temp\class_momentum_stocks.json C:\Windows\Temp\momentum_stocks_email.html C:\Windows\Temp\momentum_stocks_signals.json "{date}" "{scan_date}"
```

Read `C:\Windows\Temp\momentum_stocks_email.html`.

Also copy signals to reports folder:
Use the Write tool (or Bash cp) to save `C:\Windows\Temp\momentum_stocks_signals.json` to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/momentum_stocks-signals.json`.

---

## STEP 7: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Momentum Stocks Decision — {date}"`
- `body`: full HTML from `momentum_stocks_email.html`
- `mimeType`: `"text/html"`

---

## STEP 8: CLEANUP
```bash
rm -f /c/Windows/Temp/class_momentum_stocks.json /c/Windows/Temp/momentum_stocks_email.html /c/Windows/Temp/momentum_stocks_signals.json
```

Report: "scan-momentum-stocks complete — N symbols scanned, email sent for {date}."
