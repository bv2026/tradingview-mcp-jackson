---
name: weekly-decision-routine
description: Weekly equity decision engine — reads saved scan JSON, applies LLM reasoning, produces 7 HTML emails + 7 Gmail drafts
---

You are running the weekly equity DECISION routine for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Your job is to read the raw scan JSON files saved by weekly-scan-routine, reason through the data using strategy rules, and produce 7 HTML decision emails + 7 Gmail drafts.

**SCRATCH FILES RULE:** If you need to write intermediate Python scripts or summary JSON files to process large scan data, write them to C:\Windows\Temp\ (e.g. C:\Windows\Temp\wdr_scratch.py, C:\Windows\Temp\wdr_summary.json). NEVER write scratch files to the reports folder. The reports folder must contain ONLY the 7 final HTML decision files when you are done. Delete any temp files from C:\Windows\Temp\ at the end of STEP 5 before sending drafts.

Run steps IN ORDER without stopping or asking for confirmation.

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

## STEP 4: HARD FILTER (applies to ALL instrument types)

A symbol PASSES the hard filter if score > -99, meaning ALL three were true at scan time:
1. S&O RATING = Bullish or Strong Bullish
2. PAC STRUCTURE = BOS (any count)
3. S&O SIGNAL = ▲ or ▲+

For each passer, apply L3 entry qualification:
- nw_position = "inside" AND rr ≥ 2.0 → **READY TO ENTER**
- nw_position = "inside" AND rr < 2.0 → **Watch — low R:R**
- nw_position = "extended" → **Watch — NW extended** (move played out, wait for pullback)
- nw_position = "early" → **Watch — NW early** (base-build candidate, wait for re-entry into band)

Additional conviction boosters (note in report):
- OSC DIVERGENCES = Bullish → adds conviction to long setup
- MONEY FLOW > 60 → confirms buying pressure
- SQUEEZE > 10% → coiling, potential breakout imminent
- P&D ZONES = Within Discount → price in buying zone

---

## STEP 5: PRODUCE 7 HTML DECISION EMAILS

For each instrument type, reason through ALL symbols in symbols_raw, then render a complete HTML decision email. Use inline styles only. Every table cell must be filled — never leave Symbol, Side, or Action blank.

### Email 1 — momentum_stocks-decision.html

Apply rules from strategy-momentum_stocks.json. Long only. Weekly timeframe.

```html
<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:960px;margin:0 auto;padding:16px">
  <h1>Momentum Stocks Weekly Decision — {DATE}</h1>
  <p style="font-size:12px;color:#666">LuxAlgo S&O + PAC + OSC · NW Envelope L3 · {N} symbols scanned · {WEEK}</p>

  [Banner: green #e8f5e9 if any READY TO ENTER | orange #fff3e0 if 0 ready]

  <h2>Top Setups</h2>
  [Table of all READY TO ENTER symbols, sorted score desc]
  [Columns: RANK | SYMBOL | S&O RATING | SIGNAL | PAC | OSC DIV | NW | R:R | SCORE | STOP | TP1 | ACTION]
  [Row color: green #e8f5e9 = ready, yellow #fff8e1 = watch/extended, pink #fce4ec = watch/early]

  <h2>Watch List</h2>
  [Bullet list: all passers that are extended, early, or low R:R — one line each with symbol + reason]

  <h2>Scan Summary</h2>
  [Bullets: total scanned / passers / ready to enter / extended / early / notable hard-filter fails / overall posture]

  <h2>All Symbols — Hard Filter Results</h2>
  [Full table of ALL symbols: SYMBOL | S&O RATING | SIGNAL | PAC STRUCTURE | NW | SCORE | NOTE]
  [NOTE column: "Pass — Ready", "Pass — Extended", "Pass — Early", "Pass — Low R:R", "Fail — CHoCH", "Fail — Bearish S&O", "Fail — ▼ signal", etc.]
</div>
```

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/momentum_stocks-decision.html

### Email 2 — momentum_etf-decision.html

Apply rules from strategy-momentum_etf.json. Same structure as Email 1.

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/momentum_etf-decision.html

### Email 3 — sp_ndx-decision.html

Apply rules from strategy-sp_ndx.json. Same structure as Email 1 (Top 10 table, not Top 20 — smaller universe).

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/sp_ndx-decision.html

### Email 4 — r2k-decision.html

Apply rules from strategy-r2k.json. Same structure as Email 3.

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/r2k-decision.html

### Email 5 — ark-decision.html

Apply rules from strategy-momentum_ark.json. Long only. Weekly timeframe.
ARK-specific: flag correlation cluster conflicts (max 1 name per cluster):
- ai_semis: NVDA, AMD, AVGO, TSM
- fintech_crypto: COIN, HOOD, SOFI, NU, XYZ
- autonomy_space: TSLA, ACHR, JOBY, EH, AVAV
- ai_software: PLTR, PATH, DDOG, NET, SNOW, MDB
- genomics: CRSP, BEAM, NTLA, ILMN, RXRX, TWST, TXG, NTRA, PACB

Same HTML structure as Email 1, with an additional CLUSTER column in the Top Setups table.
Add cluster conflict note below Top Setups if any cluster appears more than once.

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/ark-decision.html

### Email 6 — thematic_stocks-decision.html

Apply rules from strategy-thematic_stocks.json.

Structure:
```html
<div style="...">
  <h1>Thematic Stocks Weekly Decision — {DATE}</h1>
  <p>...</p>

  [Banner: green if any READY TO ENTER | orange if 0]

  <h2>Top Picks Across All Themes</h2>
  [Table of all READY TO ENTER symbols across all themes, sorted score desc]
  [Columns: RANK | SYMBOL | THEME | S&O RATING | SIGNAL | PAC | OSC DIV | NW | SCORE | ACTION]

  <h2>Theme Breakdown</h2>
  [For each theme: ### {Theme} — {B} bullish / {Br} bearish / {N} total]
  [Per-theme table: SYMBOL | SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | NW | SCORE | ACTION]
  [Row colors: green = ready, yellow = extended, pink = early, white = failed filter]

  <h2>Watch List</h2>
  [Bullet list: extended/early passers by theme]

  <h2>Scan Summary</h2>
  [Bullets: total / passers / ready / extended / early / overall cross-theme posture]
</div>
```

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/thematic_stocks-decision.html

### Email 7 — thematic_etfs-decision.html

Apply rules from strategy-thematic_etfs.json.

Structure:
```html
<div style="...">
  <h1>Thematic ETFs Weekly Decision — {DATE}</h1>

  [Banner]

  <h2>ETF Rotation Summary</h2>
  [Table: ETF Theme | Bias | Leading ETFs | Lagging ETFs | Action]

  <h2>Top ETF Picks</h2>
  [All READY TO ENTER ETFs: RANK | ETF | THEME | S&O RATING | SIGNAL | PAC | NW | R:R | SCORE | STOP | TP1]

  <h2>Watch List</h2>
  [Extended/early ETFs by theme with reason]

  <h2>Avoid</h2>
  [Bottom 10 ETFs by score with reason]

  <h2>Scan Summary + Cross-Theme Read</h2>
  [3-5 macro bullets on rotation and sector leadership]
</div>
```

Save to: reports/{YYYY-WkNN}/{YYYY-Mon-DD}/thematic_etfs-decision.html

---

## TABLE STYLE (all emails)
- Table: `border-collapse:collapse;width:100%;font-size:13px`
- TH: `border:1px solid #ccc;padding:4px 8px;background:#f5f5f5`
- TD: `border:1px solid #ccc;padding:4px 8px`
- Row colors: green `#e8f5e9` = ready to enter | yellow `#fff8e1` = watch/extended | pink `#fce4ec` = watch/early

---

## STEP 6: SEND 7 GMAIL DRAFTS

After all 7 HTML files are saved, read each back and create a Gmail draft using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__create_draft. Send IN ORDER. All to: ["bvajjala@gmail.com"].

Draft 1: subject "Momentum Stocks Weekly Decision — {DATE}" | file: momentum_stocks-decision.html
Draft 2: subject "Momentum ETF Weekly Decision — {DATE}" | file: momentum_etf-decision.html
Draft 3: subject "S&P 500 + Nasdaq 100 Weekly Decision — {DATE}" | file: sp_ndx-decision.html
Draft 4: subject "Russell 2000 Weekly Decision — {DATE}" | file: r2k-decision.html
Draft 5: subject "ARK Weekly Decision — {DATE}" | file: ark-decision.html
Draft 6: subject "Thematic Stocks Weekly Decision — {DATE}" | file: thematic_stocks-decision.html
Draft 7: subject "Thematic ETFs Weekly Decision — {DATE}" | file: thematic_etfs-decision.html

---

## DONE
Report:
- Per instrument type: symbols scanned / passers / ready to enter / watch count
- Overall cross-market posture (1-2 sentences)
- Confirm "7 HTML files saved, 7 Gmail drafts created"
- Flag any instrument type that was skipped due to missing scan file
