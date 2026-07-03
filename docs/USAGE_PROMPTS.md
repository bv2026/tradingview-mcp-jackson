# TradingView MCP Usage Prompts

This is a quick prompt guide for using the TradingView MCP server from Claude/Codex.

## Startup

Your MCP config now auto-launches TradingView Desktop when the server starts.

After restarting Claude/Codex, use:

- `Use tv_health_check and tell me if TradingView connected successfully.`
- `Use chart_get_state and summarize what is on my chart.`

## Quick Chart Reads

- `What's on my chart right now? Use the right TradingView tools and keep it concise.`
- `Use quote_get and data_get_study_values and give me a quick read on the current setup.`
- `Use data_get_ohlcv with summary=true and summarize the recent price action.`
- `Give me the current symbol, timeframe, chart type, and visible indicators.`

## Full Analysis

- `Give me a full chart analysis with current price, indicator readings, Pine levels, labels, OHLCV summary, and a screenshot.`
- `Analyze my current chart and tell me the most actionable takeaway.`
- `Use the TradingView MCP tools to inspect my current chart, summarize symbol, timeframe, price, indicator values, Pine-drawn levels, and recent OHLCV summary, then tell me the best trade location to monitor.`

## Pine Levels And Labels

- `What levels are showing from my custom Pine indicators?`
- `Use data_get_pine_lines and tell me the important levels on my chart.`
- `Use data_get_pine_labels and summarize the text annotations on my chart.`
- `Use data_get_pine_tables and explain the dashboard/table output on my chart.`
- `Use data_get_pine_boxes and summarize the active zones.`

Use a specific study filter when you know the indicator name:

- `Use data_get_pine_lines for the study matching "Profiler".`
- `Use data_get_pine_labels for the study matching "NY Levels".`
- `Use data_get_pine_tables for the study matching "Session Dashboard".`

## Change The Chart

- `Switch the chart to ES1! on the 15 minute timeframe.`
- `Set the symbol to BTCUSD and timeframe to 4H.`
- `Change the chart type to HeikinAshi.`
- `Add Relative Strength Index to the chart.`
- `Remove the indicator with this entity ID: <paste id>.`
- `Scroll the chart to 2025-01-15.`

## Morning Workflow

### All Briefs In One Go
- `Run morning_brief instrument_type="all" and work through every standard brief plus the thematic reports, saving each one.`
- Large screeners (momentum_stocks/momentum_etf/momentum_ark, ~100 symbols each) can exceed the tool's timeout on a single call — batch with `offset`/`max_symbols` (e.g. `offset=0 max_symbols=50` then `offset=50 max_symbols=50`) if a plain call times out.

### Momentum Stocks / ETF / ARK
- `Run morning_brief instrument_type="momentum_stocks" and give me my session bias.`
- `Run morning_brief instrument_type="momentum_etf" and show me the top 20 setups by GAP.`
- `Run morning_brief instrument_type="momentum_ark" — check QQQ benchmark, flag BASE_BUILDING vs BREAKOUT_READY, and watch for cluster overlap.`
- `Run the momentum stocks brief and show me top 3 long candidates.`

### Crypto Spot
- `Run morning_brief instrument_type="crypto" — check BTC benchmark first, then give me alt bias.`
- `Run the crypto brief and tell me if BTC is above its 50-day SMA.`

### Crypto Perps (Long + Short)
- `Run morning_brief instrument_type="crypto_perps" — check BTC TWB direction and give me the top 3 candidates for that side.`
- `Run the perps brief. If BTC TWB is negative, give me top short setups. If positive, give me top long setups.`
- `Run perps brief and separately analyze SILVER using its own TWB signal.`

### Futures
- `Run morning_brief instrument_type="futures" — detect TRENDING vs MEAN_REVERTING regime per symbol and note the DXY/bond/VX1! macro overlays.`

### Weekly Momentum (Saturdays)
- `Run morning_brief instrument_type="sp_ndx" and give me the top setups from this week's S&P 500 + Nasdaq 100 list.`
- `Run morning_brief instrument_type="r2k" and flag any names with crowded/Overheated retail sentiment.`

### Thematic Scans
- `Run lux_screener_scan instrument_type="thematic_stocks" and give me the grouped-by-theme report plus a summary of top picks and avoid names.`
- `Run morning_brief instrument_type="thematic_etfs_1" then "thematic_etfs_2" and give me a combined ETF rotation summary across both halves.`

### Weekly Review
- `Run node scripts/build-weekly-review.mjs to build this week's data bundle, then read it and write the narrative into reports/weekly/YYYY-Www.md.`

### Session Management
- `Save this brief with session_save.`
- `Get yesterday's saved session using session_get.`
- `Compare today's brief with yesterday's session.`

## Pine Script Workflow

- `Create a new Pine indicator and set the source to a simple EMA crossover script.`
- `Set the current Pine source to this script and compile it.`
- `Compile the current Pine script and show me any errors.`
- `Read the Pine console and summarize the latest log output.`
- `Open my saved Pine script named "My Strategy".`
- `List my saved Pine scripts.`

## Replay Practice

- `Start replay at 2025-03-01.`
- `Step replay forward one bar.`
- `Turn autoplay on in replay mode.`
- `Buy in replay mode and show me replay_status.`
- `Close the replay position and tell me the realized P&L.`
- `Stop replay and return to realtime.`

## Screenshots

- `Capture a chart screenshot and show me the file path.`
- `Take a full screenshot before and after changing the timeframe to daily.`
- `Capture the chart region only and tell me where the file was saved.`

## Good Default Prompt

Use this when you want the assistant to decide the right tool sequence:

```text
Use the TradingView MCP tools to inspect my current chart and give me a concise trading read. Include:
- symbol and timeframe
- current price
- key indicator readings
- Pine-drawn levels or labels if present
- recent price-action summary
- the main level or condition I should watch next
```

## Good Full Prompt

```text
Use the TradingView MCP tools to perform a full analysis of my current chart. Check chart state, quote, study values, Pine lines, Pine labels, Pine tables if present, OHLCV summary, and capture a screenshot. Then summarize the setup, key levels, current bias, and the most actionable next step.
```

## Tips

- Ask for `summary=true` when you want compact OHLCV output.
- Use `study_filter` in prompts when targeting one specific custom indicator.
- Ask for a screenshot when visual confirmation matters.
- Ask for exact symbol and timeframe changes in one sentence to save tool calls.
