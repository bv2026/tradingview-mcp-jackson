# Setup Guide for Claude Code

This file is a step-by-step guide for Claude Code (or any LLM agent) to install and configure the TradingView MCP server. If a user asks you to install or set up this project, follow these steps exactly.

## Step 1: Clone and Install

```bash
git clone https://github.com/LewisWJackson/tradingview-mcp-jackson.git ~/tradingview-mcp-jackson
cd ~/tradingview-mcp-jackson
npm install
```

If the user specifies a different install path, use that instead of `~/tradingview-mcp-jackson`.

## Step 2: Set Up Rules and Strategy Files

Copy the example rules file:

```bash
cp ~/tradingview-mcp-jackson/rules.example.json ~/tradingview-mcp-jackson/rules.json
```

`rules.json` maps instrument types to live TradingView screeners or static watchlists. The strategy files contain bias criteria, entry/exit rules, risk rules, and generated watchlists.

Tell the user: "Open `rules.json` and verify that the live screener names match the saved screens in your TradingView account. Static-watchlist briefs read their symbols from the generated strategy files and do not need separate screener windows."

### Required TradingView Screeners

| Screener Name | Type | Filters |
|--------------|------|---------|
| `MOMENTUM` | Stock Screener | Your momentum watchlist |
| `MOMENTUM-ETF` | ETF Screener | Your momentum ETF universe |

Keep the live screeners available during their briefs. Crypto, crypto perps, futures, ARK, S&P/Nasdaq, and Russell workflows use static CSV-derived watchlists.

To rebuild static watchlists after editing their CSV files:

```bash
node scripts/build-watchlist-configs.mjs
```

The builder preserves every crypto/perps/futures CSV row and sets `max_symbols: 0`, so those briefs scan their complete watchlists by default.

## Step 3: Add to MCP Config

Add the server to the user's Claude Code MCP configuration. The config file is at `~/.claude/.mcp.json` (global) or `.mcp.json` (project-level).

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/tradingview-mcp-jackson/src/server.js"]
    }
  }
}
```

Replace `YOUR_USERNAME` with the user's actual system username. Run `echo $USER` (Mac/Linux) or `echo %USERNAME%` (Windows) to find it.

If the config file already exists and has other servers, merge the `tradingview` entry into the existing `mcpServers` object. Do not overwrite other servers.

## Step 4: Launch TradingView Desktop

TradingView Desktop must be running with Chrome DevTools Protocol enabled.

**Auto-detect and launch (recommended):**
After the MCP server is connected, use the `tv_launch` tool — it auto-detects TradingView on Mac, Windows, and Linux.

**Optional auto-launch on MCP startup:**
If you want TradingView to start automatically whenever the MCP server starts, add env vars to your MCP config:

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["C:/work/tradingview-mcp-jackson/src/server.js"],
      "env": {
        "TV_AUTO_LAUNCH": "1",
        "TV_AUTO_LAUNCH_KILL_EXISTING": "1",
        "TV_AUTO_LAUNCH_PORT": "9222"
      }
    }
  }
}
```

This replaces the need to run `scripts\\launch_tv_debug.bat` manually on Windows. The server checks whether CDP is already live and only launches TradingView if it is missing.

If you need to launch manually for troubleshooting, use your platform's standard TradingView Desktop app with `--remote-debugging-port=9222`.

## Step 5: Restart Claude Code

The MCP server only loads when Claude Code starts. After adding the config:

1. Exit Claude Code (Ctrl+C)
2. Relaunch Claude Code
3. The tradingview MCP server should connect automatically

## Step 6: Verify Connection

Use the `tv_health_check` tool. Expected response:

```json
{
  "success": true,
  "cdp_connected": true,
  "chart_symbol": "...",
  "api_available": true
}
```

If `cdp_connected: false`, TradingView is not running with `--remote-debugging-port=9222`.

## Step 7: Run Your First Morning Brief

Several briefs are available. Only momentum stocks and momentum ETF require live screener windows; the others use static watchlists. Use `instrument_type="all"` to run every standard brief plus the thematic reports:

```
morning_brief instrument_type="momentum_stocks" # equity momentum, long only
morning_brief instrument_type="momentum_etf"    # equity ETF momentum, long only
morning_brief instrument_type="momentum_ark"    # ARK-style growth names, base/breakout detection
morning_brief instrument_type="crypto"          # static Coinbase spot list, per-symbol TWB/NW/S/R, long only
morning_brief instrument_type="crypto_perps"    # perps, BTC TWB signal = long or short
morning_brief instrument_type="futures"         # multi-sector futures, trend/mean-reversion regime detection
morning_brief instrument_type="sp_ndx"          # weekly S&P 500 + Nasdaq 100 momentum (Saturdays)
morning_brief instrument_type="r2k"             # weekly Russell 2000 momentum (Saturdays)
```

Ask Claude: *"Run morning_brief instrument_type='momentum_stocks' and give me my session bias"*

Claude scans the selected live screener or complete static watchlist and applies the matching strategy. Crypto/perps/futures use TWB + NW; equity workflows use Lux structure filters plus NW extension checks.

To save it: *"Save this brief using session_save"*
To retrieve: *"Get yesterday's session using session_get"*

### Understanding the Perps Brief

The perps brief (`crypto_perps`) is the only one that trades both sides:
- BTC perp TWB Histogram **positive** → outputs top 3 **LONG** candidates
- BTC perp TWB Histogram **negative** → outputs top 3 **SHORT** candidates
- For shorts: never chase the initial drop — wait for a dead-cat bounce to the lower NW band
- Commodity perps, when present in `CSV/PERPS.csv`, use their own TWB signal independent of BTC

## Step 8: Install CLI (Optional)

To use the `tv` CLI command globally:

```bash
cd ~/tradingview-mcp-jackson
npm link
```

Then `tv status`, `tv quote`, `tv pine compile`, etc. work from anywhere.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | Launch TradingView with `--remote-debugging-port=9222` |
| `ECONNREFUSED` | TradingView isn't running or port 9222 is blocked |
| MCP server not showing in Claude Code | Check `~/.claude/.mcp.json` syntax, restart Claude Code |
| `tv` command not found | Run `npm link` from the project directory |
| Tools return stale data | TradingView may still be loading — wait a few seconds |
| Pine Editor tools fail | Open the Pine Editor panel first (`ui_open_panel pine-editor open`) |

## What to Read Next

- `rules.json` — Screener name mappings per instrument type
- `strategy-momentum_stocks.json` — Momentum stocks bias/entry/exit/risk rules
- `strategy-crypto.json` — Crypto spot bias/entry/exit/risk rules (long only, BTC 50d SMA benchmark)
- `strategy-crypto_perps.json` — Crypto perps rules (long + short, BTC TWB signal benchmark)
- `CLAUDE.md` — Full decision tree + strategy reference (auto-loaded by Claude Code)
- `README.md` — Full tool reference including morning brief workflow
- `RESEARCH.md` — Research context and open questions
