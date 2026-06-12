@echo off
:: Morning Brief — runs all 4 TradingView briefs via Claude Code CLI
:: Scheduled: 8:30 AM ET, Mon-Fri via Windows Task Scheduler

cd /d "C:\work\tradingview-mcp-jackson"

"C:\Program Files (x86)\Nodist\bin\claude.cmd" ^
  --project "C:\work\tradingview-mcp-jackson" ^
  -p "Run morning_brief instrument_type=all. For each instrument type (stocks, crypto, crypto_perps, futures): call morning_brief, apply bias_criteria to generate analysis, then call session_save. Complete all 4 briefs sequentially."

exit /b %ERRORLEVEL%
