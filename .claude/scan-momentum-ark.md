# Skill: scan-momentum-ark

Standalone E2E pipeline for ARK Thematic (momentum_ark) — from scan to Gmail email.
Invoke with `/scan-momentum-ark`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-momentum-ark aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 2: SCAN (137 symbols, 7 batches of 20)

**BATCH SIZE: always `max_symbols=20`.**

Fire all calls in sequence (do NOT read response bodies — accumulates in `evidence/latest/momentum_ark.raw.json`):
```
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=20
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=40
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=60
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=80
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=100
lux_screener_scan instrument_type="momentum_ark" timeframe="1W" max_symbols=20 offset=120
```

Keep going in steps of 20 if `slice_range` shows more symbols remain (count can drift week to week).

**Transient timeouts:** retry once if `cdp_connected:true`.
**Broken indicators:** `tv_launch kill_existing=true`, wait, retry.

---

## STEP 3: EXTRACT
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-extract.mjs /c/work/tradingview-mcp-jackson/evidence/latest/momentum_ark.raw.json /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_ark.json momentum_ark --full
```

---

## STEP 4: VERIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-verify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_ark.json
```

Read every WARN line. Re-run STEP 2 from offset=0 if MISSING or ERROR.

---

## STEP 5: CLASSIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-classify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-momentum_ark.json C:\Windows\Temp\class_momentum_ark.json
```

---

## STEP 6: RENDER HTML EMAIL

ARK uses a cluster-aware layout (ai_semis / fintech_crypto / autonomy_space / ai_software / genomics). The render script handles cluster columns automatically when `type=momentum_ark`.

```bash
date "+%b %d, %Y"
```

```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-render.mjs momentum_ark C:\Windows\Temp\class_momentum_ark.json C:\Windows\Temp\momentum_ark_email.html C:\Windows\Temp\momentum_ark_signals.json "{date}" "{YYYY-Mon-DD}"
```

Read `C:\Windows\Temp\momentum_ark_email.html`. Copy signals JSON to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/momentum_ark-signals.json`.

---

## STEP 7: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"ARK Thematic Decision — {date}"`
- `body`: full HTML
- `mimeType`: `"text/html"`

---

## STEP 8: CLEANUP
```bash
rm -f /c/Windows/Temp/class_momentum_ark.json /c/Windows/Temp/momentum_ark_email.html /c/Windows/Temp/momentum_ark_signals.json
```

Report: "scan-momentum-ark complete — N symbols scanned, email sent for {date}."
