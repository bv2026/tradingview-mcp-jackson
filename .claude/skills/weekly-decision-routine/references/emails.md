# Email send list

Send each as its own `mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message` call (NOT
`create_draft` — sends immediately). Never `replyThreadId` a batch of these together — each is an
independent email and threading collapses them to one subject in the inbox.

To: `["bvajjala@gmail.com"]`. `{DATE}` = today in `YYYY-Mon-DD` form (e.g. `2026-Aug-28`).

This table is the one place to edit if the type list, subjects, or filenames ever change — nothing
elsewhere in this skill depends on it beyond "look up the type here."

| # | Type | Subject | File |
|---|---|---|---|
| 1 | momentum_stocks | Momentum Stocks Weekly Decision — {DATE} | momentum_stocks-decision.html |
| 2 | momentum_etf | Momentum ETF Weekly Decision — {DATE} | momentum_etf-decision.html |
| 3 | sp_ndx | S&P 500 + Nasdaq 100 Weekly Decision — {DATE} | sp_ndx-decision.html |
| 4 | r2k | Russell 2000 Weekly Decision — {DATE} | r2k-decision.html |
| 5 | momentum_ark | ARK Weekly Decision — {DATE} | ark-decision.html |
| 6 | thematic_stocks | Thematic Stocks Weekly Decision — {DATE} | thematic_stocks-decision.html |
| 7 | thematic_etfs | Thematic ETFs Weekly Decision — {DATE} | thematic_etfs-decision.html |

Send only the rows for the type(s) actually requested/rendered this run — a partial run (e.g. just
re-sending #3 after fixing sp_ndx's scan data) is normal.
