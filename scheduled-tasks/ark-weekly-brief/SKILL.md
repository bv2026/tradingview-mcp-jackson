---
name: ark-weekly-brief
description: Run the ARK weekly equity scan (lux_screener_scan), reason through all raw data, produce an HTML decision email and Gmail draft
---

You are running the ARK weekly brief pipeline for the tradingview-mcp-jackson project at C:\work\tradingview-mcp-jackson.

Run the following steps IN ORDER without stopping or asking for confirmation.

--- STEP 0: HEALTH CHECK ---
Call tv_health_check. If it returns success:false or cdp_connected:false, STOP immediately and report:
"ARK weekly brief aborted — TradingView CDP not available. Check that TradingView is running with --remote-debugging-port=9222."

--- STEP 1: DETERMINE REPORT FOLDER ---
Determine today's date. Compute:
- ISO week folder: YYYY-WkNN (Monday-start week, year-prefixed)
- Date folder: YYYY-Mon-DD
Reports base path: C:\work\tradingview-mcp-jackson\reports\{YYYY-WkNN}\{YYYY-Mon-DD}\

--- STEP 2: RUN THE ARK SCAN (two calls, 117 symbols total) ---
Call lux_screener_scan twice in sequence — the watchlist has 117 symbols and must be split:

Call 1: lux_screener_scan instrument_type="momentum_ark" timeframe="1W" offset=0 max_symbols=60
Call 2: lux_screener_scan instrument_type="momentum_ark" timeframe="1W" offset=60

Wait for each call to complete before running the next.

After both calls return, merge the two result sets:
- Combine both `symbols_raw` arrays into one list (117 entries total)
- Re-sort all entries by score descending across both halves
- The merged list is your working dataset for Step 3

--- STEP 3: REASON THROUGH THE DATA ---

You now have raw scan output for up to 117 ARK symbols. Each symbol entry contains fields from three LuxAlgo screeners. Use the glossaries and strategy rules below to reason through each symbol and produce a decision.

### SCREENER GLOSSARY

**S&O Screener (Signals & Overlays)**
- RATING: Confluence percentage of bullish signals across all enabled S&O elements. Higher % = more bullish confluence. Values: "Strong Bullish", "Bullish", "Neutral", "Bearish", "Strong Bearish"
- SIGNAL: Most recent confirmation signal. ▲ = bullish confirmation, ▲+ = stronger bullish, ▼ = bearish, ▼+ = stronger bearish
- EXITS: Number of exit signals returned since the most recent entry signal. Higher = more signals have fired against the trade, eroding the original signal's validity
- SMART TRAIL: Current Smart Trail status — trailing stop mechanism showing whether price is holding above (bullish) or below (bearish) the trail
- CATCHER: Current Trend Catcher status — momentum-based trend filter
- TRACER: Current Trend Tracer status — trend direction indicator
- TREND STRENGTH: Numeric value showing trend momentum magnitude. Higher absolute value = stronger trend. Direction context comes from RATING/SIGNAL
- LUX VOLATILITY: Current volatility reading. High volatility = wider swings, harder entries; low = compression/coiling phase (often precedes breakout)
- SQUEEZE: Current Squeeze Index value — measures compression between Bollinger Bands and Keltner Channels. High squeeze = coiling, low squeeze = expansion in progress

**PAC Screener (Price Action Concepts)**
- RATING: Confluence percentage of bullish signals across all enabled PAC elements
- STRUCTURE: Most recent market structure event. BOS (Break of Structure) = bullish trend intact; CHoCH (Change of Character) = potential trend reversal; CHoCH+ = confirmed reversal. Only BOS passes the hard filter
- ORDER BLOCK: Price position relative to most recent detected order block area — are we above (bullish) or inside/below (support/resistance context)?
- FVG: Status of most recent Fair Value Gap (imbalance) — unmitigated FVGs act as magnets for price
- P&D ZONES: Price position relative to Premium / Equilibrium / Discount zones — Discount = buying zone, Premium = selling zone
- LIQUIDITY GRABS: Most recent detected liquidity grab event — stop hunts above highs or below lows
- EQHL: Most recent detected Equal High / Equal Low — liquidity pools sitting above or below price

**OSC Screener (Oscillators)**
- RATING: Confluence percentage of bullish signals across all enabled OSC elements
- HWO SIGNAL: Most recent HyperWave Oscillator signal — directional momentum signal
- MONEY FLOW: Most recent Money Flow oscillator value — positive = buying pressure, negative = selling pressure
- OVERFLOW: Most recent Overflow value — measures excess momentum or exhaustion
- HYPERWAVE: Most recent HyperWave value — trend wave measurement
- REVERSALS: Most recent Reversal signal detected — potential turning points
- DIVERGENCES: Divergence between price movement and HyperWave. "Bullish Divergence" = price making lower lows but HyperWave making higher lows (hidden strength). "Bearish Divergence" = opposite

**NW Envelope (added by scan Step 6)**
- nw_position: "inside" = price coiling between bands (valid entry zone); "extended" = price above upper band (move played out, do not enter); "early" = price below lower band (breakdown, avoid). Only populated for symbols that passed the hard filter.
- nw_upper: Upper NW band level (reward target)
- nw_lower: Lower NW band level (stop reference)
- rr: Risk/Reward ratio calculated as (nw_upper − price) / (price − nw_lower). Min 1:2 required for entry.
- score: Composite sort score (higher = stronger setup). Negatives (-99) = failed hard filter.

### STRATEGY RULES (strategy-momentum_ark.json)

**Hard Filter (L2 — applied by scan, score > -99 means passed):**
1. S&O RATING must be Bullish or Strong Bullish
2. PAC STRUCTURE must be BOS (not CHoCH or CHoCH+)
3. S&O SIGNAL must be ▲ or ▲+

**Entry criteria (L3 — apply these now):**
- NW position = "inside" (price between bands, room to run)
- R:R ≥ 1:2 (nw_upper − price ≥ 2 × price − nw_lower)
- Manual flags to note: no earnings within 5 trading days; RS vs QQQ positive over last 20 days (if WTD context available, use it as a proxy — stock up more or down less than market)

**Exit rules:**
- Stop: below the base low (or breakout candle low if base is wide)
- TP1: scale out 1/3 to 1/2 at nw_upper band
- TP2: trail remainder using prior day's low as trailing stop after TP1 hit
- Time stop: exit if no extension within 5 trading days

**Risk rules:**
- Max 1% account risk per trade
- Max 3 open ARK positions
- Max 1 name per correlation cluster (do not hold two names from the same cluster):
  - ai_semis: NVDA, AMD, AVGO, TSM
  - fintech_crypto: COIN, HOOD, SOFI, NU, XYZ
  - autonomy_space: TSLA, ACHR, JOBY, EH, AVAV
  - ai_software: PLTR, PATH, DDOG, NET, SNOW, MDB
  - genomics: CRSP, BEAM, NTLA, ILMN, RXRX, TWST, TXG, NTRA, PACB
- ARK names are 2–3x beta vs SPY — reduce position size 25% vs standard stocks

**ARK context:** These are narrative/catalyst-driven names. They gap 15–30% on news, base for weeks, then break out again. BOS on the weekly confirms the broader trend is intact. NW inside = price coiling with room to run. NW extended = the move has already played out. Weekly timeframe.

### REASONING STEPS

For each symbol in symbols_raw, working from highest score to lowest:

1. **Hard filter status**: score > -99 means passed BOS + Bullish S&O + ▲ signal. Score = -99 means failed — note which filter failed.
2. **NW check**: for passers, check nw_position. Only "inside" qualifies for entry. "extended" = skip. No nw_position = NW check not run (score too low or scan timed out).
3. **R:R check**: rr ≥ 2.0 required. Flag if marginal (1.5–2.0).
4. **OSC confirmation**: Bullish Divergence in DIVERGENCES = adds conviction. MONEY FLOW positive = confirms buying pressure.
5. **Cluster check**: If multiple passers from the same cluster, select only the highest-score one. Flag the others as "cluster conflict."
6. **Overall market read**: look at what proportion of 117 names passed the hard filter and how many are NW inside vs extended. High pass rate + mostly inside = broad ARK strength. Low pass rate or mostly extended = late-cycle, reduce exposure.

--- STEP 4: PRODUCE THE HTML DECISION EMAIL ---

Using your reasoning from Step 3, render a complete HTML decision email with inline styles only.

```html
<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:900px">
  <h1 style="margin-bottom:4px">ARK Weekly Brief — {DATE}</h1>
  <p style="font-size:12px;color:#666;margin-top:0">Weekly equity scan · LuxAlgo S&O + PAC + OSC · NW Envelope L3 · {N} symbols scanned</p>

  <h2>Top Setups</h2>
  <!-- Table: every cell filled. Green row #e8f5e9 for Ready to Enter, yellow #fffde7 for Watch -->
  <!-- Columns: RANK | SYMBOL | CLUSTER | S&O RATING | SIGNAL | PAC STRUCTURE | NW | R:R | SCORE | ACTION | STOP | TP1 -->
  <!-- ACTION values: "Ready to Enter", "Watch — NW extended", "Watch — low R:R", "Cluster conflict" -->

  <h2>Watch List</h2>
  <!-- Bullet list: symbols that passed hard filter but are extended, low R:R, or cluster conflicts -->
  <!-- Format: <li><b>SYMBOL</b> — reason (e.g. "NW extended", "R:R 1.4 — marginal", "Cluster: ai_semis, prefer NVDA")</li> -->

  <h2>Scan Summary</h2>
  <!-- Bullet list -->
  <!-- Total scanned / hard filter passers / NW inside / NW extended / cluster conflicts -->
  <!-- Overall ARK market posture: Broad Strength / Selective / Late-Cycle -->

  <h2>All Symbols Scanned</h2>
  <!-- Full table of all 117 symbols sorted by score descending -->
  <!-- Columns: SYMBOL | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIVERGENCE | NW | SCORE | NOTE -->
  <!-- NOTE: "Pass" / "Fail: CHoCH" / "Fail: Bearish S&O" / "Fail: ▼ signal" / "Extended" / "Low R:R" / "Cluster" -->
</div>
```

Table style: `border-collapse:collapse;width:100%;font-size:13px`
TH: `border:1px solid #ccc;padding:4px 8px;background:#f5f5f5`
TD: `border:1px solid #ccc;padding:4px 8px`

--- STEP 5: SAVE AND SEND ---

Save the complete HTML to:
  reports/{YYYY-WkNN}/{YYYY-Mon-DD}/ark-weekly-decision.html

Read that file back and create a Gmail draft using mcp__18e26973-458f-4842-a655-687dfaf0ed6e__create_draft:
  - to: ["bvajjala@gmail.com"]
  - subject: "ARK Weekly Brief — {DATE}"
  - htmlBody: exact file contents read from ark-weekly-decision.html

--- DONE ---
Report: symbols scanned, hard filter passers, NW inside count, top 3 setups, Gmail draft created.
