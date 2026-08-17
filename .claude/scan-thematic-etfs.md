# Skill: scan-thematic-etfs

Standalone E2E pipeline for Thematic ETFs — from scan to Gmail email.
Invoke with `/scan-thematic-etfs`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-thematic-etfs aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: SCAN (~77 symbols, 4 batches of 20)

**BATCH SIZE: always `max_symbols=20`. Uses the LUXALGO-SCREENERS chart tab (`8DqlkdU0`).**

Fire all calls in sequence (accumulates in `evidence/latest/thematic_etfs.raw.json`):
```
lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" max_symbols=20 offset=20
lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" max_symbols=20 offset=40
lux_screener_scan instrument_type="thematic_etfs" timeframe="1W" max_symbols=20 offset=60
```

Keep going in steps of 20 if `slice_range` shows more symbols remain.

**Transient timeouts:** retry once if `cdp_connected:true`.
**Broken indicators:** `tv_launch kill_existing=true`, wait, retry.

---

## STEP 3: EXTRACT
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-extract.mjs /c/work/tradingview-mcp-jackson/evidence/latest/thematic_etfs.raw.json /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_etfs.json thematic_etfs --full
```

---

## STEP 4: VERIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-verify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_etfs.json
```

Read every WARN line. Re-run STEP 2 from offset=0 if MISSING or ERROR.

---

## STEP 5: CLASSIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-classify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-thematic_etfs.json C:\Windows\Temp\class_thematic_etfs.json
```

---

## STEP 6: RENDER HTML EMAIL

Thematic ETFs uses a rotation-table layout across 8 themes. The render script handles it for `type=thematic_etfs`.

```bash
date "+%b %d, %Y"
```

```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-render.mjs thematic_etfs C:\Windows\Temp\class_thematic_etfs.json C:\Windows\Temp\thematic_etfs_email.html C:\Windows\Temp\thematic_etfs_signals.json "{date}" "{YYYY-Mon-DD}"
```

Read `C:\Windows\Temp\thematic_etfs_email.html`. Copy signals JSON to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/thematic_etfs-signals.json`.

---

## STEP 7: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Thematic ETFs Decision — {date}"`
- `body`: full HTML
- `mimeType`: `"text/html"`

---

## STEP 8: CLEANUP
```bash
rm -f /c/Windows/Temp/class_thematic_etfs.json /c/Windows/Temp/thematic_etfs_email.html /c/Windows/Temp/thematic_etfs_signals.json
```

Report: "scan-thematic-etfs complete — N symbols scanned, email sent for {date}."
