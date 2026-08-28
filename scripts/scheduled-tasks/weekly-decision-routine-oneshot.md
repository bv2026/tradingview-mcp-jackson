---
name: weekly-decision-routine-oneshot
description: One-time manual re-run of weekly-decision-routine, same content, cron-independent trigger
version: 1.0.0
last_updated: 2026-08-28
---

**Version 1.0.0** (2026-08-28) — first versioned baseline. Content unchanged from the pre-versioning
scheduled task; this run is the reference execution that confirmed the routine end-to-end (5/7 emails
sent, sp_ndx/r2k correctly skipped for schema-incompatible scan data). Also published as a directly
invocable project Skill at `.claude/skills/weekly-decision-routine/SKILL.md` — see
[VERSIONS.md](VERSIONS.md) for the canonical/live/skill copy map and how to keep them in sync.

You are running the weekly equity DECISION routine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Your job is to read the raw scan JSON files saved by weekly-scan-routine, reason through the data using strategy rules, and produce 7 HTML decision emails sent directly to the inbox.

**USE THE SCRIPTS — do not hand-classify or hand-write the HTML:** `scripts/decision-classify.mjs` and `scripts/decision-render.mjs` implement the hard filter, L3 qualification, and all 7 HTML/signals templates from STEP 3/4/5/5B below verbatim. Applying these rules by reading raw JSON and reasoning symbol-by-symbol for ~500 symbols is slow, expensive, and error-prone — always run the scripts instead. Read STEP 3/4/5/5B below to understand what the scripts do and to write the prose sections they don't cover (Overall Market Read, cross-market posture), not to re-derive the classification by hand.

Any intermediate scratch files (e.g. the `class_<type>.json` classifier output) go in C:\Windows\Temp\ (e.g. C:\Windows\Temp\class_momentum_stocks.json). NEVER write scratch files to the reports folder. The reports folder must contain ONLY the 7 final HTML decision files AND the 7 signals JSON files when you are done. Delete any temp files from C:\Windows\Temp\ at the end of STEP 5 before sending emails.

Run steps IN ORDER without stopping or asking for confirmation.

## LOGGING (write incrementally — do this even though nothing else instructs you to)

This routine runs unattended in a fresh session with no memory of past runs, and its full transcript is not visible to anyone afterward — only the files it leaves on disk. If a run stalls or gets cut off partway (context limit, tool error, anything), the only way to know how far it got is a log file written as you go, not one written only at the end.

Append (do not overwrite) one line per event to `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/_run-log.txt`, each line prefixed with an ISO timestamp:
- At the very start of STEP 0, before anything else: `START weekly-decision-routine`
- After STEP 1 finishes: which of the 7 scan files were present/missing
- After each of the 7 `decision-classify.mjs` calls in STEP 4: `CLASSIFY <type> ok (N passers)` or the error
- After each of the 7 `decision-render.mjs` calls in STEP 5: `RENDER <type> ok` or the error
- Immediately before starting STEP 6: `STEP 6 START — sending 7 emails`
- After EACH individual `send_message` call succeeds in STEP 6 (not batched at the end): `EMAIL <n>/7 <type> sent — id <message id>`. Write this line right after that specific send call returns, before moving to the next one, so a truncated run still shows exactly which emails went out.
- At the very end: `DONE — N/7 emails sent` (or however many actually succeeded)

Use a plain `Write`/append call for this — it must not depend on any step after STEP 6 to be visible.

## METRICS (timing + approximate data volume per step)

Append these to the SAME `_run-log.txt` file, interleaved with the LOGGING lines above by real time order. Use Bash `date +%s` (epoch seconds) to bracket each phase — do not estimate durations from memory.

1. In the same Bash call as the `START` log line, also capture `T0=$(date +%s)`.
2. Right after STEP 1's file-check finishes: `T1=$(date +%s)` then append `TIMING step1_verify $((T1-T0))s`.
3. Right after STEP 2's reads finish: `T2=$(date +%s)` then append `TIMING step2_read_data $((T2-T1))s`, and append `TOKENS-APPROX step2_input ~$((BYTES/4)) tokens ($BYTES bytes)` where `BYTES` is the combined `wc -c` of all scan-<type>.json + strategy-<type>.json files just read.
4. Right after the 7th `decision-classify.mjs` call: `T4=$(date +%s)` then append `TIMING step4_classify $((T4-T2))s`.
5. Right after the 7th `decision-render.mjs` call: `T5=$(date +%s)` then append `TIMING step5_render $((T5-T4))s`, and append `TOKENS-APPROX step5_output ~$((BYTES/4)) tokens ($BYTES bytes)` where `BYTES` is the combined `wc -c` of the 7 rendered HTML files.
6. Right after the 7th `send_message` call: `T6=$(date +%s)` then append `TIMING step6_email $((T6-T5))s`.
7. At the very end, alongside the `DONE` line: `TEND=$(date +%s)` then append `TIMING total $((TEND-T0))s`.

This is a data-volume proxy (bytes/4), not exact model token usage — actual consumption also includes tool-call overhead and reasoning not reflected in file sizes. It is meant to spot where a run is slow or unexpectedly large, not as a billing-accurate figure. Do NOT put any of this in the emails — it is local-only, for `_run-log.txt`.

---

## STEP 0: LOCATE TODAY'S REPORTS FOLDER
Compute today's date. Derive ISO week folder (YYYY-WkNN) and date folder (YYYY-Mon-DD).
Reports path: C:\work\tradingview-mcp-jackson\reports\{YYYY-WkNN}\{YYYY-Mon-DD}\

---

## STEP 1: VERIFY ALL 7 SCAN FILES EXIST
Check that these files exist in today's reports folder:
  scan-momentum_stocks.json
  scan-momentum_etf.json
  scan-sp_ndx.json
  scan-r2k.json
  scan-momentum_ark.json
  scan-thematic_stocks.json
  scan-thematic_etfs.json

If any file is missing or contains "error" at the top level, note it but continue with the files that do exist. Do NOT abort — produce reports for available scans and flag missing ones.

---

## STEP 2: READ ALL INPUT DATA
Read all available scan JSON files into context.
Also read the 7 strategy files:
  C:\work\tradingview-mcp-jackson\config\strategy-momentum_stocks.json
  C:\work\tradingview-mcp-jackson\config\strategy-momentum_etf.json
  C:\work\tradingview-mcp-jackson\config\strategy-sp_ndx.json
  C:\work\tradingview-mcp-jackson\config\strategy-r2k.json
  C:\work\tradingview-mcp-jackson\config\strategy-momentum_ark.json
  C:\work\tradingview-mcp-jackson\config\strategy-thematic_stocks.json
  C:\work\tradingview-mcp-jackson\config\strategy-thematic_etfs.json

---

## STEP 3: SCREENER GLOSSARY (apply to ALL instrument types)

Each symbol in symbols_raw carries fields from three LuxAlgo screeners:

**S&O (Signals & Overlays):**
- RATING: Strong Bullish / Bullish / Neutral / Bearish / Strong Bearish — confluence of bullish S&O elements
- SIGNAL: ▲+ (strong bullish), ▲ (bullish), ▼ (bearish), ▼+ (strong bearish)
- EXITS: Count of exit signals fired since last entry — higher = signal more consumed/stale
- SMART TRAIL / CATCHER / TRACER: Individual trend filter components (Bullish/Bearish)
- TREND STRENGTH: Momentum magnitude — 🔥 + high % = strong trend, ❄️ = weak/cooling
- LUX VOLATILITY: High/Moderate/Low — high = wider swings, harder entries
- SQUEEZE: Bollinger/Keltner compression % — high squeeze = coiling, often precedes breakout

**PAC (Price Action Concepts):**
- RATING: Bullish PAC confluence level
- STRUCTURE: BOS (Break of Structure = bullish trend intact), CHoCH (possible reversal), CHoCH+ (confirmed reversal)
- ORDER BLOCK: Outside (price away from block), Entered (price testing block), Inside (price within block)
- FVG: Unmitigated (price magnet still active), Mitigated (filled), Outside (no active gap)
- P&D ZONES: Above Equilibrium / Within Premium (extended) / Within Equilibrium / Under Equilibrium / Within Discount (buying zone)
- LIQUIDITY GRABS: Bullish (stop hunt below lows — now bullish), Bearish (stop hunt above highs)
- EQHL: EQH (equal highs = liquidity above), EQL (equal lows = liquidity below)

**OSC (Oscillators):**
- RATING: Bullish oscillator confluence level
- HWO SIGNAL: HyperWave Oscillator — △ Up / ▽ Down / ▼ Overbought Down / △ Oversold Up
- MONEY FLOW: >50 = net buying pressure, <50 = net selling pressure
- OVERFLOW: Excess momentum value — high = overextension risk
- HYPERWAVE: HyperWave trend wave reading — higher = stronger trend
- REVERSALS: Reversal Up/Down (+) — detected turning points
- DIVERGENCES: Bullish = price lower low + oscillator higher low (hidden strength — ADD conviction); Bearish = opposite (REDUCE conviction)

**NW Envelope (L3 — populated for hard-filter passers only):**
- nw_position: "inside" = price coiling between bands — VALID ENTRY ZONE
                "extended" = price above upper band — move played out, DO NOT ENTER
                "early" = price below lower band — breakdown / base-build candidate
- nw_upper: Upper NW band (reward target reference)
- nw_lower: Lower NW band (stop reference)
- rr: (nw_upper − price) / (price − nw_lower) — minimum 2.0 required for entry
- score: Composite sort score. score = -99 means failed hard filter.

---

## STEP 4: CLASSIFICATION (applies to ALL instrument types) — run the classifier script

`scripts/decision-classify.mjs` uses V1 evidence scoring (setup_quality / entry_quality / eligibility / rank_score from the scan JSON) to bucket every symbol. The old "score > -99" description no longer applies — the classifier uses `eligibility`, `setup_quality ∈ {A,B}`, and `entry_quality ∈ {FAVORABLE,ACCEPTABLE}` as its gates. Do not re-derive classification by hand.

**Qualification buckets produced:**
- `ready` — setup_quality A/B + entry FAVORABLE/ACCEPTABLE + nw_position inside + rr ≥ 2.0 → **READY TO ENTER** (green row)
- `ready_norr` — same but rr null (NW band data unavailable) → **Enter — confirm R:R first** (light blue row)
- `extended_continuation` — setup_quality A + entry LATE/EXTENDED + nw_position extended + strong momentum → **Trend continuation at 50% size** (indigo row)
- `watch_low_rr` — qualifies on setup/entry but rr < 2.0
- `watch_extended` — NW extended, not eligible for continuation
- `watch_early` — NW early/below-band
- `watch_unknown` — NW position unclear
- `fails` (eligibility=REJECT) — bearish trend or reversing momentum; shown with reason

Additional conviction boosters (note in report):
- OSC DIVERGENCES = Bullish → adds conviction to long setup
- MONEY FLOW > 60 → confirms buying pressure
- SQUEEZE > 10% → coiling, potential breakout imminent
- P&D ZONES = Within Discount → price in buying zone

For each of the 7 types run:
  `node scripts/decision-classify.mjs reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-<type>.json C:\Windows\Temp\class_<type>.json`

This produces buckets that STEP 5 renders directly — do not re-derive by hand.

Note: if `nw_data_warning` appears in the scan JSON, NW Envelope may not have been visible on the chart at scan time — all inside symbols will be `ready_norr` rather than `ready`.

---

## STEP 5 + 5B: RENDER 7 HTML DECISION EMAILS + 7 SIGNALS JSON — run the render script

`scripts/decision-render.mjs` implements every template below (Top Setups/Top Picks, Watch List, Scan Summary, All Symbols/Theme Breakdown/Rotation Summary, ARK cluster column + conflict check, and the `{type}-signals.json` schema) directly from a `decision-classify.mjs` output file. For each of the 7 instrument types, after STEP 4's classify run, run:

  `node scripts/decision-render.mjs <type> C:\Windows\Temp\class_<type>.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/<htmlname>-decision.html reports/{YYYY-WkNN}/{YYYY-Mon-DD}/<type>-signals.json <YYYY-Mon-DD> <YYYY-Mon-DD>

`<type>` is the instrument_type value (momentum_stocks, momentum_etf, sp_ndx, r2k, momentum_ark, thematic_stocks, thematic_etfs). `<htmlname>` matches `<type>` for every type EXCEPT momentum_ark, whose HTML file is named `ark-decision.html` (the signals file stays `momentum_ark-signals.json`).

Read the reference templates below to understand what the script produces (for troubleshooting / verifying output), not to hand-write the HTML:

### Email 1 — momentum_stocks-decision.html
Apply rules from strategy-momentum_stocks.json. Long only. Weekly timeframe.
Sections: Top Setups (RANK | SYMBOL | S&O RATING | SIGNAL | PAC | OSC DIV | NW | R:R | SCORE | STOP | TP1 | ACTION, row-colored green/yellow/pink), Watch List (bullets with reason + conviction notes), Scan Summary (counts + posture), All Symbols — Hard Filter Results (every symbol, pass or fail, with a NOTE reason).

### Email 2 — momentum_etf-decision.html
Apply rules from strategy-momentum_etf.json. Same structure as Email 1.

### Email 3 — sp_ndx-decision.html
Apply rules from strategy-sp_ndx.json. Same structure as Email 1.

### Email 4 — r2k-decision.html
Apply rules from strategy-r2k.json. Same structure as Email 1.

### Email 5 — ark-decision.html (file: ark-decision.html, signals: momentum_ark-signals.json)
Apply rules from strategy-momentum_ark.json. Long only. Weekly timeframe.
ARK-specific: flag correlation cluster conflicts among READY-TO-ENTER symbols (max 1 name per cluster) — the script checks this automatically:
- ai_semis: NVDA, AMD, AVGO, TSM
- fintech_crypto: COIN, HOOD, SOFI, NU, XYZ
- autonomy_space: TSLA, ACHR, JOBY, EH, AVAV
- ai_software: PLTR, PATH, DDOG, NET, SNOW, MDB
- genomics: CRSP, BEAM, NTLA, ILMN, RXRX, TWST, TXG, NTRA, PACB

Same structure as Email 1, with an additional CLUSTER column in Top Setups and a conflict note if any cluster has >1 ready symbol.

### Email 6 — thematic_stocks-decision.html
Apply rules from strategy-thematic_stocks.json.
Sections: Top Picks Across All Themes, Theme Breakdown (one table per theme: SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | NW | SCORE | ACTION, row-colored), Watch List, Scan Summary.

### Email 7 — thematic_etfs-decision.html
Apply rules from strategy-thematic_etfs.json.
Sections: ETF Rotation Summary (Theme | Bias | Leading ETFs | Lagging ETFs), Top ETF Picks, Watch List, Avoid (bottom 10 by score), Scan Summary + Cross-Theme Read.

### signals JSON schema (per type, read by `rh_signals_mcp` for order intents)
```json
{
  "instrument_type": "<type>",
  "scan_date": "<YYYY-Mon-DD>",
  "generated_at": "<ISO timestamp>",
  "ready_to_enter": [{"symbol": "ADI", "score": 5, "price": 386.73, "nw_upper": 430.0, "nw_lower": 350.0, "rr": 2.5}],
  "watch": [{"symbol": "MU", "nw_position": "extended", "score": 3, "reason": "NW extended — wait for pullback"}]
}
```
`ready_to_enter`: score > -99 AND nw_position = "inside" AND rr ≥ 2.0, sorted by score descending. `watch`: all other passers. Fails (score = -99) are omitted.

After running the script for all 7 types, spot-check at least one HTML file (`grep -c undefined <file>` should be 0) and confirm `symbol_count` in each signals file's parent classify output matches the corresponding scan-<type>.json before proceeding to STEP 6.

---

## TABLE STYLE (all emails)
Gmail's send pipeline strips `<style>` blocks, `class` attributes, and any inline `style="..."` containing a `background` property — confirmed via live send+fetch testing 2026-08-15. `decision-render.mjs` therefore uses plain legacy HTML attributes instead of CSS for structure/coloring (these survive Gmail's sanitizer):
- Table: `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px">` (the `bordercolor` attribute is stripped by Gmail — harmless, `border="1"` alone still renders a visible grid)
- Header row: `<tr bgcolor="#f5f5f5">`
- Row colors via `bgcolor` attribute on `<tr>`: green `#e8f5e9` = ready to enter | yellow `#fff8e1` = watch/extended | pink `#fce4ec` = watch/early
- Never use `style="background:...` anywhere in these emails — it will be silently stripped on send even though it renders fine in the locally-saved HTML file, causing the saved report and the delivered email to visually diverge.

---

## STEP 6: SEND 7 GMAIL EMAILS DIRECTLY

After all 7 HTML files are saved, read each back and send it as a Gmail email using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step). Send IN ORDER. All to: ["bvajjala@gmail.com"].

Email 1: subject "Momentum Stocks Weekly Decision — {DATE}" | file: momentum_stocks-decision.html
Email 2: subject "Momentum ETF Weekly Decision — {DATE}" | file: momentum_etf-decision.html
Email 3: subject "S&P 500 + Nasdaq 100 Weekly Decision — {DATE}" | file: sp_ndx-decision.html
Email 4: subject "Russell 2000 Weekly Decision — {DATE}" | file: r2k-decision.html
Email 5: subject "ARK Weekly Decision — {DATE}" | file: ark-decision.html
Email 6: subject "Thematic Stocks Weekly Decision — {DATE}" | file: thematic_stocks-decision.html
Email 7: subject "Thematic ETFs Weekly Decision — {DATE}" | file: thematic_etfs-decision.html

---

## DONE
Report:
- Per instrument type: symbols scanned / passers / ready to enter / watch count
- Overall cross-market posture (1-2 sentences)
- Confirm "7 HTML files saved, 7 Gmail emails sent"
- Flag any instrument type that was skipped due to missing scan file