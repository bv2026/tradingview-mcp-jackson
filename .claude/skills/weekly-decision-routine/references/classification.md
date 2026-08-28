# Classification — screener glossary + qualification buckets

## Screener glossary (all instrument types)

Each symbol in `symbols_raw` carries fields from three LuxAlgo screeners:

**S&O (Signals & Overlays):** RATING (Strong Bullish…Strong Bearish), SIGNAL (▲+/▲/▼/▼+), EXITS
(count since last entry — higher = staler), SMART TRAIL/CATCHER/TRACER (trend filter components),
TREND STRENGTH (🔥+% = strong, ❄️ = weak), LUX VOLATILITY (High/Moderate/Low), SQUEEZE (Bollinger/
Keltner compression % — high = coiling, often precedes breakout).

**PAC (Price Action Concepts):** RATING, STRUCTURE (BOS = trend intact, CHoCH = possible reversal,
CHoCH+ = confirmed reversal), ORDER BLOCK (Outside/Entered/Inside), FVG (Unmitigated/Mitigated/
Outside), P&D ZONES (Above Equilibrium…Within Discount), LIQUIDITY GRABS (Bullish/Bearish stop
hunts), EQHL (EQH = liquidity above, EQL = liquidity below).

**OSC (Oscillators):** RATING, HWO SIGNAL (△ Up/▽ Down/▼ Overbought Down/△ Oversold Up), MONEY
FLOW (>50 = net buying), OVERFLOW (high = overextension risk), HYPERWAVE (higher = stronger trend),
REVERSALS, DIVERGENCES (Bullish = hidden strength/ADD conviction, Bearish = REDUCE conviction).

**NW Envelope (L3 — populated for hard-filter passers only):**
- `nw_position`: `inside` (valid entry zone) / `extended` (played out, don't enter) / `early`
  (breakdown / base-build candidate)
- `nw_upper` / `nw_lower`: reward/stop reference bands
- `rr`: `(nw_upper − price) / (price − nw_lower)` — minimum 2.0 required for entry
- `score`: composite sort score; `-99` = failed hard filter

## Qualification buckets (`scripts/decision-classify.mjs`, V1 evidence scoring)

Gates: `eligibility`, `setup_quality ∈ {A,B}`, `entry_quality ∈ {FAVORABLE,ACCEPTABLE}` — not a
raw `score > -99` check.

| Bucket | Condition | Meaning |
|---|---|---|
| `ready` | quality gate + `nw_position=inside` + `rr ≥ 2.0` | READY TO ENTER (green row) |
| `ready_norr` | quality gate + `nw_position=inside` + `rr` null (NW data unavailable) | Enter — confirm R:R first (light blue) |
| `extended_continuation` | `setup_quality=A` + entry LATE/EXTENDED + `nw_position=extended` + strong momentum | Trend continuation at 50% size (indigo) |
| `watch_low_rr` | quality gate passes, `rr < 2.0` | watch |
| `watch_extended` | `nw_position=extended`, not continuation-eligible | watch |
| `watch_early` | `nw_position=early` | watch |
| `watch_unknown` | NW position unclear | watch |
| fails | `eligibility=REJECT` | shown with reason, not a bucket row |

Conviction boosters to note in the report (don't gate on them): OSC divergence=Bullish, MONEY FLOW
> 60, SQUEEZE > 10%, P&D ZONES = Within Discount.

If `nw_data_warning` appears in the scan JSON, NW Envelope wasn't visible at scan time — all
`inside` symbols land in `ready_norr` instead of `ready`.

## Running it

```
node scripts/decision-classify.mjs reports/{YYYY-WkNN}/{YYYY-Mon-DD}/scan-<type>.json C:\Windows\Temp\class_<type>.json
```

Scratch output goes to `C:\Windows\Temp\`, never the reports folder. Delete temp files after
STEP 5/rendering, before sending emails.
