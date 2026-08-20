# Skill: scan-momentum-etf

Standalone E2E pipeline for Momentum ETF — from scan to Gmail email.
Invoke with `/scan-momentum-etf`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-momentum-etf aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: SCAN (~100 symbols, 5 batches of 20)

**BATCH SIZE: always `max_symbols=20`.**

Fire all calls in sequence (do NOT read response bodies — results accumulate in `evidence/latest/momentum_etf.raw.json`):
```
lux_screener_scan instrument_type="momentum_etf" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="momentum_etf" timeframe="1W" max_symbols=20 offset=20
lux_screener_scan instrument_type="momentum_etf" timeframe="1W" max_symbols=20 offset=40
lux_screener_scan instrument_type="momentum_etf" timeframe="1W" max_symbols=20 offset=60
lux_screener_scan instrument_type="momentum_etf" timeframe="1W" max_symbols=20 offset=80
```

Keep going in steps of 20 if `slice_range` shows more symbols remain.

**Transient timeouts:** retry once if health check still shows `cdp_connected:true`.
**Broken indicators (all-UNVERIFIED, flat score-2):** `tv_launch kill_existing=true`, wait, retry.

---

## STEP 3: EXTRACT
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-extract.mjs /c/work/tradingview-mcp-jackson/evidence/latest/momentum_etf.raw.json /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_etf.json momentum_etf --full
```

---

## STEP 4: VERIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-verify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_etf.json
```

Read every WARN line. Re-run STEP 2 from offset=0 if MISSING or ERROR.

---

## STEP 5: CLASSIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-classify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_etf.json /c/Windows/Temp/class_momentum_etf.json
```

---

## STEP 6: RENDER HTML EMAIL

```bash
date "+%b %d, %Y"
```

```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-render.mjs momentum_etf /c/Windows/Temp/class_momentum_etf.json /c/Windows/Temp/momentum_etf_email.html /c/Windows/Temp/momentum_etf_signals.json "{date}" "{YYYY-Mon-DD}"
```

Read `/c/Windows/Temp/momentum_etf_email.html`. Copy signals JSON to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/momentum_etf-signals.json`.

---

## STEP 7: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Momentum ETF Decision — {date}"`
- `body`: full HTML
- `mimeType`: `"text/html"`

---

## STEP 8: CLEANUP
```bash
rm -f /c/Windows/Temp/class_momentum_etf.json /c/Windows/Temp/momentum_etf_email.html /c/Windows/Temp/momentum_etf_signals.json
```

Report: "scan-momentum-etf complete — N symbols scanned, email sent for {date}."
