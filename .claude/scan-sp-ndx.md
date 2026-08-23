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

## STEP 1b: REBUILD WATCHLIST FROM CSV

Run the momentum watchlist builder to ensure `config/strategy-sp_ndx.json` reflects the latest CSV:

```bash
node /c/work/tradingview-mcp-jackson/scripts/build-momentum-watchlists.mjs
```

**Verify the output immediately — do not proceed if any check fails:**

```bash
node -e "
const fs = require('fs');
const path = 'C:/work/tradingview-mcp-jackson/config/strategy-sp_ndx.json';
const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
const wl = cfg.watchlist;
if (!Array.isArray(wl) || wl.length === 0) throw new Error('watchlist is empty or missing');
const bad = wl.filter(e => !e.symbol || e.wtd === undefined || e.sentiment === undefined);
if (bad.length) throw new Error('entries missing required fields: ' + bad.map(e=>e.symbol||'?').join(', '));
console.log('sp_ndx watchlist OK: ' + wl.length + ' symbols, source: ' + cfg.watchlist_source);
console.log('First 5: ' + wl.slice(0,5).map(e=>e.symbol).join(', '));
"
```

If this throws, STOP: "scan-sp-ndx aborted — watchlist rebuild failed: {error}". Do not scan a broken watchlist.

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
node /c/work/tradingview-mcp-jackson/scripts/decision-classify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-sp_ndx.json /c/Windows/Temp/class_sp_ndx.json
```

---

## STEP 6: RENDER HTML EMAIL

```bash
date "+%b %d, %Y"
```

```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-render.mjs sp_ndx /c/Windows/Temp/class_sp_ndx.json /c/Windows/Temp/sp_ndx_email.html /c/Windows/Temp/sp_ndx_signals.json "{date}" "{YYYY-Mon-DD}"
```

Read `/c/Windows/Temp/sp_ndx_email.html`. Copy signals JSON to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/sp_ndx-signals.json`.

---

## STEP 7: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"S&P 500 + Nasdaq 100 Decision — {date}"`
- `htmlBody`: full HTML

---

## STEP 8: CLEANUP
```bash
rm -f /c/Windows/Temp/class_sp_ndx.json /c/Windows/Temp/sp_ndx_email.html /c/Windows/Temp/sp_ndx_signals.json
```

Report: "scan-sp-ndx complete — N symbols scanned, email sent for {date}."
