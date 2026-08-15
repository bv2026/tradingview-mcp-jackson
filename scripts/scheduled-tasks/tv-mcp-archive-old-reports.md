---
name: tv-mcp-archive-old-reports
description: Weekly archival of TradingView MCP report folders older than 8 weeks — zips and moves to reports/archive/
---

Run the report-archival script for the TradingView MCP project.

1. Run: `node C:\work\tradingview-mcp-jackson\scripts\archive-old-reports.mjs`
2. This zips any `reports/YYYY-WkNN/` week-folder older than 8 weeks (via PowerShell `Compress-Archive`), moves the `.zip` into `reports/archive/`, and deletes the original folder. Week folders within the 8-week retention window are left untouched.
3. Report back: how many week folders were archived, how many were kept, and list the archived week names. If the script errors, report the exact error output — do not retry silently.

This is a maintenance task with no market-hours dependency — no TradingView/CDP connection needed.