# Skill: futures-decision

Manually invoke with `/futures-decision` to produce today's Futures Decision email from the
already-saved `futures.md` brief.

> **CannonEdge / CT consumption was removed 2026-08-30** (the CannonEdge signal is being
> rebuilt; the scraper still runs, this repo just doesn't read it). This is now a TV-only
> decision — the same logic as STEP 5 of `scripts/scheduled-tasks/decision-email-routine.md`,
> which is the canonical version. Prefer running the full `decision-email-routine` unless you
> only need the futures email re-done.

---

## Step 1 — Read inputs

Compute today's report folder (`reports/{YYYY-WkNN}/{YYYY-Mon-DD}/`). Read:
- `reports/{YYYY-WkNN}/{YYYY-Mon-DD}/futures.md`  (today's brief — if missing, tell the user to run the futures brief first)
- `config/strategy-futures.json`

---

## Step 2 — Reason through the data

Each market is evaluated **independently** on its own signals — no benchmark:

- Determine the regime (`TRENDING_LONG` / `TRENDING_SHORT` / `MEAN_REVERTING`) from the brief's
  `regime` value plus `regime_detection` rules in the strategy file.
- Apply the matching `bias_criteria` block (trend_long / trend_short / mean_rev_long / mean_rev_short).
- **TWB gap sign** is the primary directional read. **NW position** (`extended` / `early` / `inside`)
  is timing: `early`/`inside` = room to run; `extended` = wait.
- Apply `macro_overlays` from `market_context` (DXY → metals/FX, ZB/ZN → equity index, VX1! → risk mode).
- Enforce sector concentration: max 1 energy, 1 metals, 1 equity-index; max 3 futures total.

**Classification:**
- **Top Setup** — regime + bias clear, NW timing ready (`early`/`inside`), gap confirms direction
- **Watch List** — direction clear but NW `extended` or gap conflicts; state what needs to change
- **Skip** — neutral TWB, no clear regime, or stale/`fresh:false` row

---

## Step 3 — Render + send

Write decisions to `/c/Windows/Temp/futures_decisions.json` using the schema in
`decision-email-routine.md` STEP 5 (`all_symbols_columns`: `Market | Bias | TWB Gap | NW | Regime | S/R | Watch`),
then:

```bash
node /c/work/tradingview-mcp-jackson/scripts/daily-decision-render.mjs /c/Windows/Temp/futures_decisions.json reports/{YYYY-WkNN}/{YYYY-Mon-DD}/futures-decision.html "{DATE}"
```

Read the generated `futures-decision.html` and send it verbatim via
`mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` — `to: ["bvajjala@gmail.com"]`,
`subject: "Futures Decision Brief — {DATE}"`, `htmlBody:` the file contents. Delete the scratch JSON.

---

## Done

Report: market count, Top Setups vs Watch List count, confirm the email was sent.
