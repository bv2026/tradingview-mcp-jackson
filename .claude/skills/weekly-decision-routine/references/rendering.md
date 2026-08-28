# Rendering — per-type templates + Gmail-safe style

`scripts/decision-render.mjs` implements every template below directly from a
`decision-classify.mjs` output file:

```
node scripts/decision-render.mjs <type> C:\Windows\Temp\class_<type>.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/<htmlname>-decision.html reports/{YYYY-WkNN}/{YYYY-Mon-DD}/<type>-signals.json <YYYY-Mon-DD> <YYYY-Mon-DD>
```

`<type>` = instrument_type (`momentum_stocks`, `momentum_etf`, `sp_ndx`, `r2k`, `momentum_ark`,
`thematic_stocks`, `thematic_etfs`). `<htmlname>` = `<type>` for every type **except**
`momentum_ark`, whose HTML file is `ark-decision.html` (signals file stays
`momentum_ark-signals.json`).

## Per-type sections

- **momentum_stocks / momentum_etf / sp_ndx / r2k** (strategy-`<type>`.json, long-only, weekly):
  Top Setups table (RANK | SYMBOL | S&O RATING | SIGNAL | PAC | OSC DIV | NW | R:R | SCORE | STOP
  | TP1 | ACTION, row-colored green/yellow/pink), Watch List (bullets + conviction notes), Scan
  Summary (counts + posture), All Symbols — every symbol pass or fail with a NOTE reason.
- **momentum_ark** (file `ark-decision.html`): same structure plus a CLUSTER column in Top Setups
  and an automatic correlation-conflict check (max 1 ready symbol per cluster):
  `ai_semis` (NVDA,AMD,AVGO,TSM) · `fintech_crypto` (COIN,HOOD,SOFI,NU,XYZ) · `autonomy_space`
  (TSLA,ACHR,JOBY,EH,AVAV) · `ai_software` (PLTR,PATH,DDOG,NET,SNOW,MDB) · `genomics`
  (CRSP,BEAM,NTLA,ILMN,RXRX,TWST,TXG,NTRA,PACB).
- **thematic_stocks**: Top Picks Across All Themes, Theme Breakdown (one table per theme: SYMBOL |
  SUB-GROUP | S&O RATING | SIGNAL | PAC STRUCTURE | OSC DIV | NW | SCORE | ACTION), Watch List,
  Scan Summary.
- **thematic_etfs**: ETF Rotation Summary (Theme | Bias | Leading ETFs | Lagging ETFs), Top ETF
  Picks, Watch List, Avoid (bottom 10 by score), Scan Summary + Cross-Theme Read.

## signals JSON schema (per type — read by `rh_signals_mcp` for order intents)

```json
{
  "instrument_type": "<type>",
  "scan_date": "<YYYY-Mon-DD>",
  "generated_at": "<ISO timestamp>",
  "ready_to_enter": [{"symbol": "ADI", "score": 5, "price": 386.73, "nw_upper": 430.0, "nw_lower": 350.0, "rr": 2.5}],
  "watch": [{"symbol": "MU", "nw_position": "extended", "score": 3, "reason": "NW extended — wait for pullback"}]
}
```
`ready_to_enter`: score > -99 AND `nw_position=inside` AND `rr ≥ 2.0`, sorted score descending.
`watch`: all other passers. Fails (`score=-99`) omitted.

After rendering all requested types, `grep -c undefined <file>` should be 0, and each rendered
type's `symbol_count` should match its `scan-<type>.json`.

## Table style (Gmail-safe — required, do not deviate)

Gmail's send pipeline strips `<style>` blocks, `class` attributes, and any inline
`style="...background..."` (confirmed via live send+fetch testing 2026-08-15).
`decision-render.mjs` already uses plain legacy attributes; if you ever hand-edit HTML for this
routine, match this:

- Table: `<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px">`
  (`bordercolor` is stripped by Gmail too — harmless, `border="1"` still renders a grid)
- Header row: `<tr bgcolor="#f5f5f5">`
- Row colors via `bgcolor` on `<tr>`: green `#e8f5e9` = ready to enter · yellow `#fff8e1` = watch/
  extended · pink `#fce4ec` = watch/early
- Never use `style="background:...` anywhere — it's silently stripped on send even though it
  renders locally, so the saved report and the delivered email visually diverge.
