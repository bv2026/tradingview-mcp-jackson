# Skill: scan-r2k

Standalone E2E pipeline for Russell 2000 — from scan to Gmail email.
Invoke with `/scan-r2k`.

Run steps IN ORDER without stopping or asking for confirmation.

---

## STEP 0: HEALTH CHECK
Call `tv_health_check`. If `success:false` or `cdp_connected:false`, STOP:
"scan-r2k aborted — TradingView CDP not available."

---

## STEP 1: DETERMINE REPORT FOLDER
Compute today's date. Derive ISO week folder (`YYYY-WkNN`) and date folder (`YYYY-Mon-DD`).

```bash
mkdir -p /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}
```

---

## STEP 1b: REBUILD WATCHLIST FROM CSV

Run the momentum watchlist builder to ensure `config/strategy-r2k.json` reflects the latest CSV:

```bash
node /c/work/tradingview-mcp-jackson/scripts/build-momentum-watchlists.mjs
```

**Verify the output immediately — do not proceed if any check fails:**

```bash
node -e "
const fs = require('fs');
const path = 'C:/work/tradingview-mcp-jackson/config/strategy-r2k.json';
const cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
const wl = cfg.watchlist;
if (!Array.isArray(wl) || wl.length === 0) throw new Error('watchlist is empty or missing');
const bad = wl.filter(e => !e.symbol || e.wtd === undefined || e.sentiment === undefined);
if (bad.length) throw new Error('entries missing required fields: ' + bad.map(e=>e.symbol||'?').join(', '));
console.log('r2k watchlist OK: ' + wl.length + ' symbols, source: ' + cfg.watchlist_source);
console.log('First 5: ' + wl.slice(0,5).map(e=>e.symbol).join(', '));
"
```

If this throws, STOP: "scan-r2k aborted — watchlist rebuild failed: {error}". Do not scan a broken watchlist.

---

## STEP 2: SCAN (~25 symbols — usually fits in two calls)

Fire in sequence (do NOT read response bodies — accumulates in `evidence/latest/r2k.raw.json`):
```
lux_screener_scan instrument_type="r2k" timeframe="1W" max_symbols=20 offset=0
lux_screener_scan instrument_type="r2k" timeframe="1W" max_symbols=20 offset=20
```

Keep going in steps of 20 if `slice_range` shows more symbols remain.

**Transient timeouts:** retry once if `cdp_connected:true`.
**Broken indicators:** `tv_launch kill_existing=true`, wait, retry.

**r2k-specific note:** r2k has historically been prone to scan corruption (blank so/pac/osc data for some symbols — see scan health checks added 2026-08-15). Read every WARN from scan-verify.mjs carefully. Do not dismiss "illiquid small-cap quirk" explanations — if more than 2-3 symbols have blank indicator data, the scan is corrupt and must be re-run.

---

## STEP 3: EXTRACT
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-extract.mjs /c/work/tradingview-mcp-jackson/evidence/latest/r2k.raw.json /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-r2k.json r2k --full
```

---

## STEP 4: VERIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/scan-verify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-r2k.json
```

Read every WARN line. Re-run STEP 2 from offset=0 if MISSING, ERROR, or `indicator_error_warning`.

---

## STEP 5: CLASSIFY
```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-classify.mjs /c/work/tradingview-mcp-jackson/reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-r2k.json /c/Windows/Temp/class_r2k.json
```

---

## STEP 6: RENDER HTML EMAIL

```bash
date "+%b %d, %Y"
```

```bash
node /c/work/tradingview-mcp-jackson/scripts/decision-render.mjs r2k /c/Windows/Temp/class_r2k.json /c/Windows/Temp/r2k_email.html /c/Windows/Temp/r2k_signals.json "{date}" "{YYYY-Mon-DD}"
```

Read `/c/Windows/Temp/r2k_email.html`. Copy signals JSON to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/r2k-signals.json`.

---

## STEP 7: SEND EMAIL
Call `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` with:
- `to`: `["bvajjala@gmail.com"]`
- `subject`: `"Russell 2000 Decision — {date}"`
- `htmlBody`: full HTML

---

## STEP 8: CLEANUP
```bash
rm -f /c/Windows/Temp/class_r2k.json /c/Windows/Temp/r2k_email.html /c/Windows/Temp/r2k_signals.json
```

Report: "scan-r2k complete — N symbols scanned, email sent for {date}."
