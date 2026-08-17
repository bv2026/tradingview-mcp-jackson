# Skill: scan-sp-ndx

Standalone E2E pipeline for S&P 500 + Nasdaq 100 — from scan to Gmail email.
Invoke with `/scan-sp-ndx`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-sp-ndx aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: SCAN (~36 symbols — usually fits in one call)

Fire in sequence (do NOT read response bodies — accumulates in `evidence/latest/sp_ndx.raw.json`):
```
lux_screener_scan instrument_type="sp_ndx" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="sp_ndx" timeframe="1W" max_symbols=20 offset=20
```

Keep going in steps of 20 if `slice_range` shows more symbols remain.

**Transient timeouts:** retry once if `cdp_connected:true`.
**Broken indicators:** `tv_launch kill_existing=true`, wait, retry.

---

## STEP 3: EXTRACT
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-extract.mjs /c/work/tradingview-mcp-jackson/evidence/latest/sp_ndx.raw.json /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-sp_ndx.json sp_ndx --full
```

---

## STEP 4: VERIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-verify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-sp_ndx.json
```

Read every WARN line. Re-run STEP 2 from offset=0 if MISSING or ERROR.

---

## STEP 5: CLASSIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-classify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-sp_ndx.json C:\Windows\Temp\class_sp_ndx.json
```

---

## STEP 6: RENDER HTML EMAIL

```bash
date "+%b %d, %Y"
```

```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-render.mjs sp_ndx C:\Windows\Temp\class_sp_ndx.json C:\Windows\Temp\sp_ndx_email.html C:\Windows\Temp\sp_ndx_signals.json "{date}" "{YYYY-Mon-DD}"
```

Read `C:\Windows\Temp\sp_ndx_email.html`. Copy signals JSON to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/sp_ndx-signals.json`.

---

## STEP 7: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"S&P 500 + Nasdaq 100 Decision — {date}"`
- `body`: full HTML
- `mimeType`: `"text/html"`

---

## STEP 8: CLEANUP
```bash
rm -f /c/Windows/Temp/class_sp_ndx.json /c/Windows/Temp/sp_ndx_email.html /c/Windows/Temp/sp_ndx_signals.json
```

Report: "scan-sp-ndx complete — N symbols scanned, email sent for {date}."
