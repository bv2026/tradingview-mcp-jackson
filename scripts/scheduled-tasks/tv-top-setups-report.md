---
name: tv-top-setups-report
description: Daily Top Setups Summary — generates HTML report from all instrument reports and sends it directly via Gmail to bvajjala@gmail.com
---

You are running the daily Top Setups Summary routine for the TradingView MCP project.

## Steps

**1. Generate the HTML report**

Run:
```
python /c/work/tradingview-mcp-jackson/scripts/extract_top_setups.py --weeks 2 --html
```

The script scans the last 2 weeks of reports (futures/crypto/stocks/ETFs), deduplicates symbols across days within each week, and saves a self-contained HTML file to the reports folder. It prints the full path of the saved file to stdout — capture that path.

**2. Read the HTML file**

Read the file at the path printed in step 1.

**3. Get today's date**

Run: `date "+%b %d, %Y"`

**4. Send the Gmail email directly**

Call mcp__18e26973-458f-4842-a655-687dfaf0ed6e__send_message (NOT create_draft — this sends immediately, no draft/review step) with:
- to: ["bvajjala@gmail.com"]
- subject: "Top Setups Summary – {date from step 3}"
- body: the full HTML content read in step 2
- mimeType: "text/html"

**5. Report completion**

Confirm: "Email sent — Top Setups Summary for {date}, HTML saved to {path}."

## Notes
- If the script prints an error or produces no output, stop and report the error.
- Do not edit any source files. Read-only except for writing the HTML report to reports/.
- The HTML file is already fully styled and self-contained — pass it as-is as the email body.