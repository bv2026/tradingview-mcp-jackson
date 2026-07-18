# TradingView MCP Jackson

If you found this from the YouTube video — welcome. This is the improved fork. Everything you need is below.

Built on top of the original [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) by [@tradesdontlie](https://github.com/tradesdontlie). Full credit to them for the foundation. This fork adds a morning brief workflow, a rules config, and fixes the launch bug on TradingView Desktop v2.14+.

All working docs are centralized in [docs/INDEX.md](docs/INDEX.md). The root-level `AGENTS.md` and `CLAUDE.md` files stay in place for agent instructions; everything else lives under `docs/`.

> [!WARNING]
> **Not affiliated with TradingView Inc. or Anthropic.** This tool connects to your locally running TradingView Desktop app via Chrome DevTools Protocol. Review the [Disclaimer](#disclaimer) before use.

> [!IMPORTANT]
> **Requires a valid TradingView subscription.** This tool does not bypass any TradingView paywall. It reads from and controls the TradingView Desktop app already running on your machine.

> [!NOTE]
> **All data processing happens locally.** Nothing is sent anywhere. No TradingView data leaves your machine.

---

## What's New in This Fork

| Feature | What it does |
|---------|-------------|
| `morning_brief` | One command that scans your screener, reads all your indicators, and returns structured data for Claude to generate your session bias |
| **8 independent briefs + thematic scans** | Momentum stocks/ETF/ARK, crypto spot/perps, futures, weekly S&P-Nasdaq, weekly Russell 2000, plus thematic stock/ETF scans — each with its own screener, strategy, and bias logic. `instrument_type="all"` runs the whole set. |
| **Crypto perps (long + short)** | Perps brief uses BTC TWB signal direction to determine side — negative = scan for shorts, positive = scan for longs |
| `session_save` / `session_get` | Saves your daily brief to `~/.tradingview-mcp/sessions/` so you can compare today vs yesterday |
| `rules.json` | Maps instrument types to screener names. Strategy files hold all bias/entry/exit/risk rules |
| **Screener blocklists** | Auto-removes stablecoins, wrapped tokens, stock perps, meme coins from results in code |
| Launch bug fix | Fixed `tv_launch` compatibility with TradingView Desktop v2.14+ and Windows Store (MSIX) installs |
| `tv brief` CLI | Run your morning brief from the terminal in one word |

---

## One-Shot Setup

Paste this into Claude Code and it will handle everything:

```
Set up TradingView MCP Jackson for me. 
Clone https://github.com/bv2026/tradingview-mcp-jackson.git to ~/tradingview-mcp-jackson, run npm install, then add it to my MCP config at ~/.claude/.mcp.json (merge with any existing servers, don't overwrite them). 
The config block is: { "mcpServers": { "tradingview": { "command": "node", "args": ["/Users/YOUR_USERNAME/tradingview-mcp-jackson/src/server.js"] } } } — replace YOUR_USERNAME with my actual username beevee97
Then copy rules.example.json to rules.json and open it so I can fill in my trading rules.
Finally restart and verify with tv_health_check.
```

Or follow the manual steps below.

---

## Prerequisites

- **TradingView Desktop app** (paid subscription required for real-time data)
- **Node.js 18+**
- **Claude Code** (for MCP tools) or any terminal (for CLI)
- **macOS, Windows, or Linux**

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/bv2006/tradingview-mcp-jackson.git ~/tradingview-mcp-jackson
cd ~/tradingview-mcp-jackson
npm install
```

### 2. Set up your rules

```bash
cp rules.example.json rules.json
```

Open `rules.json` and fill in:
- Your **watchlist** (symbols to scan each morning)
- Your **bias criteria** (what makes something bullish/bearish/neutral for you)
- Your **risk rules** (the rules you want Claude to check before every session)

### 3. Launch TradingView with CDP

TradingView must be running with the debug port enabled.

**Windows:**
```bash
scripts\launch_tv_debug.bat
```

Or use the MCP tool after setup: `"Use tv_launch to start TradingView in debug mode"`

### 4. Add to Claude Code

Add to `~/.claude/.mcp.json` (merge with any existing servers):

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

Replace `YOUR_USERNAME` with your actual username. On Mac: `echo $USER` to check.

If you want the MCP server to launch TradingView automatically when it starts, add env vars to that server entry:

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

`TV_AUTO_LAUNCH=1` turns on startup launch. `TV_AUTO_LAUNCH_KILL_EXISTING=1` is recommended if you want this to fully replace the batch file, because it restarts TradingView when it is already open without CDP enabled.

### 5. Verify

Restart Claude Code, then ask: *"Use tv_health_check to verify TradingView is connected"*

### 6. Run your first morning brief

Ask Claude: *"Run morning_brief and give me my session bias"*

Or from the terminal:
```bash
npm link  # install tv CLI globally (one time)
tv brief
```

---

## Morning Brief Workflow

This is the feature that turns this from a toolkit into a daily habit. Eight independent daily/weekly briefs plus two thematic scans, each with its own screener and strategy — or run `instrument_type="all"` to work through every standard brief and both thematic reports in one session.

**Before every session:**

1. TradingView is open with all screener windows visible (stocks, ETF, ARK, crypto, perps, futures)
2. Run one or more briefs:

```
morning_brief instrument_type="momentum_stocks" # equity momentum
morning_brief instrument_type="momentum_etf"    # equity ETF momentum
morning_brief instrument_type="momentum_ark"    # ARK-style growth names
morning_brief instrument_type="crypto"          # crypto spot (Coinbase)
morning_brief instrument_type="crypto_perps"    # crypto perps long or short
morning_brief instrument_type="futures"         # multi-sector futures
morning_brief instrument_type="sp_ndx"          # weekly S&P/Nasdaq momentum (Saturdays)
morning_brief instrument_type="r2k"             # weekly Russell 2000 momentum (Saturdays)
```

Large screeners (~100 symbols) can exceed the tool's timeout on a plain call — batch with `offset`/`max_symbols` if needed (e.g. `offset=0 max_symbols=50` then `offset=50 max_symbols=50`).

Thematic scans (separate from the above, run via `lux_screener_scan` and `morning_brief instrument_type="thematic_etfs_1"/"thematic_etfs_2"`) cover ~121 stocks and ~90 ETFs across 8 themes — see `CLAUDE.md` for the full formatting spec.

3. Claude scans every symbol in the screener, reads TWB Oscillator + NW Envelope, applies the strategy rules, and prints one line per symbol:

```
SOL  | BIAS: SHORT | SIGNAL: TWB −17.4, NW bounce at $78 = short entry zone | WATCH: Wait for retrace to $75–78
ETH  | BIAS: SHORT | SIGNAL: TWB −598, price below last NW ▲ at $1,823     | WATCH: Dead-cat to $1,800–1,823
XRP  | BIAS: SHORT | SIGNAL: TWB −0.25, price at $1.14 near NW ▲ at $1.21  | WATCH: Closest to live short entry

Overall: BTC TWB negative — short side in play. Wait for dead-cat bounces before shorting.
```

4. Save it: *"save this brief"* (uses `session_save`)
5. Next morning, compare: *"get yesterday's session"* (uses `session_get`)

### Weekly Review Workflow

1. Run `scripts/build-weekly-review.mjs` to generate `reports/weekly/YYYY-Www-data.json`
2. Read that bundle and write the narrative weekly review into `reports/weekly/YYYY-Www.md`
3. Use the weekly markdown as the source of truth for next-week planning

### Strategy Files

Each brief loads its own strategy file:

| Brief | Command | Screener | Strategy File | Side |
|-------|---------|----------|---------------|------|
| Momentum Stocks | `instrument_type="momentum_stocks"` | `MOMENTUM` | `strategy-momentum_stocks.json` | Long only |
| Momentum ETF | `instrument_type="momentum_etf"` | `MOMENTUM-ETF` | `strategy-momentum_etf.json` | Long only |
| Momentum ARK | `instrument_type="momentum_ark"` | `MOMENTUM-ARK` | `strategy-momentum_ark.json` | Long only (base/breakout detection) |
| Crypto Spot | `instrument_type="crypto"` | `MOMENTUM-CRYPTO` | `strategy-crypto.json` | Long only |
| Crypto Perps | `instrument_type="crypto_perps"` | `MOMENTUM-PERPS` | `strategy-crypto_perps.json` | **Long + Short** |
| Futures | `instrument_type="futures"` | static watchlist | `strategy-futures.json` | Trend/mean-reversion regime, both sides |
| Weekly S&P/Nasdaq | `instrument_type="sp_ndx"` | static (weekly CSV) | `strategy-sp_ndx.json` | Long only |
| Weekly Russell 2000 | `instrument_type="r2k"` | static (weekly CSV) | `strategy-r2k.json` | Long only |

### How the Benchmark Works

| Brief | Benchmark | Logic |
|-------|-----------|-------|
| Stocks | SPY/QQQ 50-day SMA | Above = longs ok. Below = avoid longs. |
| Crypto Spot | BTC 50-day SMA | Above = alt longs ok. Below = avoid alts. |
| Crypto Perps | **BTC perp TWB Histogram** | Positive = scan for longs. Negative = scan for shorts. |

The perps brief is the only one that trades both sides — the BTC TWB signal determines which side the market favors that day.

---

## What This Tool Does

- **Morning brief** — scan watchlist, read indicators, apply your rules, print session bias
- **Pine Script development** — write, inject, compile, debug scripts with AI
- **Chart navigation** — change symbols, timeframes, zoom to dates, add/remove indicators
- **Visual analysis** — read indicator values, price levels, drawn levels from custom indicators
- **Draw on charts** — trend lines, horizontal levels, rectangles, text
- **Manage alerts** — create, list, delete price alerts
- **Replay practice** — step through historical bars, practice entries and exits with P&L tracking
- **Screenshots** — capture chart state
- **Multi-pane layouts** — 2x2, 3x1 grids with different symbols per pane
- **Stream data** — JSONL output from your live chart for monitoring scripts
- **CLI access** — every tool is also a `tv` command, pipe-friendly JSON output

---

## How Claude Knows Which Tool to Use

Claude reads `CLAUDE.md` automatically when working in this project. It contains the full decision tree.

| You say... | Claude uses... |
|------------|---------------|
| "Run my morning brief" | `morning_brief` → apply rules → `session_save` |
| "What was my bias yesterday?" | `session_get` |
| "What's on my chart?" | `chart_get_state` → `data_get_study_values` → `quote_get` |
| "Give me a full analysis" | `quote_get` → `data_get_study_values` → `data_get_pine_lines` → `data_get_pine_labels` → `capture_screenshot` |
| "Switch to BTCUSD daily" | `chart_set_symbol` → `chart_set_timeframe` |
| "Write a Pine Script for..." | `pine_set_source` → `pine_smart_compile` → `pine_get_errors` |
| "Start replay at March 1st" | `replay_start` → `replay_step` → `replay_trade` |
| "Set up a 4-chart grid" | `pane_set_layout` → `pane_set_symbol` |
| "Draw a level at 94200" | `draw_shape` (horizontal_line) |

---

## Tool Reference (84 MCP tools)

### Morning Brief (new in this fork)

| Tool | What it does |
|------|-------------|
| `morning_brief` | Scan watchlist, read indicators, return structured data for session bias. Reads `rules.json` automatically. |
| `session_save` | Save the generated brief to `~/.tradingview-mcp/sessions/YYYY-MM-DD.json` |
| `session_get` | Retrieve today's brief (or yesterday's if today not saved yet) |

### Chart Reading

| Tool | When to use | Output size |
|------|------------|-------------|
| `chart_get_state` | First call — get symbol, timeframe, all indicator names + IDs | ~500B |
| `data_get_study_values` | Read current RSI, MACD, BB, EMA values from all indicators | ~500B |
| `quote_get` | Get latest price, OHLC, volume | ~200B |
| `data_get_ohlcv` | Get price bars. **Use `summary: true`** for compact stats | 500B (summary) / 8KB (100 bars) |

### Custom Indicator Data (Pine Drawings)

Read `line.new()`, `label.new()`, `table.new()`, `box.new()` output from any visible Pine indicator.

| Tool | When to use |
|------|------------|
| `data_get_pine_lines` | Horizontal price levels (support/resistance, session levels) |
| `data_get_pine_labels` | Text annotations + prices ("PDH 24550", "Bias Long") |
| `data_get_pine_tables` | Data tables (session stats, analytics dashboards) |
| `data_get_pine_boxes` | Price zones as {high, low} pairs |

**Always use `study_filter`** to target a specific indicator: `study_filter: "MyIndicator"`.

### Chart Control

| Tool | What it does |
|------|-------------|
| `chart_set_symbol` | Change ticker (BTCUSD, AAPL, ES1!, NYMEX:CL1!) |
| `chart_set_timeframe` | Change resolution (1, 5, 15, 60, D, W, M) |
| `chart_set_type` | Change style (Candles, HeikinAshi, Line, Area, Renko) |
| `chart_manage_indicator` | Add/remove indicators. **Use full names**: "Relative Strength Index" not "RSI" |
| `chart_scroll_to_date` | Jump to a date (ISO: "2025-01-15") |
| `indicator_set_inputs` / `indicator_toggle_visibility` | Change indicator settings, show/hide |

### Pine Script Development

| Tool | Step |
|------|------|
| `pine_set_source` | 1. Inject code into editor |
| `pine_smart_compile` | 2. Compile with auto-detection + error check |
| `pine_get_errors` | 3. Read compilation errors if any |
| `pine_get_console` | 4. Read log.info() output |
| `pine_save` | 5. Save to TradingView cloud |
| `pine_analyze` | Offline static analysis (no chart needed) |
| `pine_check` | Server-side compile check (no chart needed) |

### Replay Mode

| Tool | Step |
|------|------|
| `replay_start` | Enter replay at a date |
| `replay_step` | Advance one bar |
| `replay_autoplay` | Auto-advance (set speed in ms) |
| `replay_trade` | Buy/sell/close positions |
| `replay_status` | Check position, P&L, date |
| `replay_stop` | Return to realtime |

### Multi-Pane, Alerts, Drawings, UI

| Tool | What it does |
|------|-------------|
| `pane_set_layout` | Change grid: `s`, `2h`, `2v`, `2x2`, `4`, `6`, `8` |
| `pane_set_symbol` | Set symbol on any pane |
| `draw_shape` | Draw horizontal_line, trend_line, rectangle, text |
| `alert_create` / `alert_list` / `alert_delete` | Manage price alerts |
| `batch_run` | Run action across multiple symbols/timeframes |
| `watchlist_get` / `watchlist_add` | Read/modify watchlist |
| `capture_screenshot` | Screenshot (regions: full, chart, strategy_tester) |
| `tv_launch` / `tv_health_check` | Launch TradingView and verify connection |

---

## CLI Commands

```bash
tv brief                           # run morning brief
tv session get                     # get today's saved brief
tv session save --brief "..."      # save a brief

tv status                          # check connection
tv quote                           # current price
tv symbol BTCUSD                   # change symbol
tv ohlcv --summary                 # price summary
tv screenshot -r chart             # capture chart
tv pine compile                    # compile Pine Script
tv pane layout 2x2                 # 4-chart grid
tv stream quote | jq '.close'      # monitor price ticks
```

Full command list: `tv --help`

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `cdp_connected: false` | TradingView isn't running with `--remote-debugging-port=9222`. Use the launch script. |
| `ECONNREFUSED` | TradingView isn't running or port 9222 is blocked |
| MCP server not showing in Claude Code | Check `~/.claude/.mcp.json` syntax, restart Claude Code |
| `tv` command not found | Run `npm link` from the project directory |
| `morning_brief` — "No rules.json found" | Run `cp rules.example.json rules.json` and fill it in |
| `morning_brief` — watchlist empty | Add symbols to the `watchlist` array in `rules.json` |
| Tools return stale data | TradingView still loading — wait a few seconds |
| Pine Editor tools fail | Open Pine Editor panel first: `ui_open_panel pine-editor open` |

---

## Architecture

```
Claude Code  ←→  MCP Server (stdio)  ←→  CDP (port 9222)  ←→  TradingView Desktop (Electron)
```

- **84 MCP tools** total
- **Transport**: MCP over stdio + CLI (`tv` command)
- **Connection**: Chrome DevTools Protocol on localhost:9222
- **No external network calls** — everything runs locally
- **Zero extra dependencies** beyond the original

---

## Credits

This fork is built on [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) by [@tradesdontlie](https://github.com/tradesdontlie). The original tool is the foundation — go star their repo.

---

## Disclaimer

This project is provided **for personal, educational, and research purposes only**.

This tool uses the Chrome DevTools Protocol (CDP), a standard debugging interface built into all Chromium-based applications. It does not reverse engineer any proprietary TradingView protocol, connect to TradingView's servers, or bypass any access controls. The debug port must be explicitly enabled by the user via a standard Chromium command-line flag.

By using this software you agree that:

1. You are solely responsible for ensuring your use complies with [TradingView's Terms of Use](https://www.tradingview.com/policies/) and all applicable laws.
2. This tool accesses undocumented internal TradingView APIs that may change at any time.
3. This tool must not be used to redistribute, resell, or commercially exploit TradingView's market data.
4. The authors are not responsible for any account bans, suspensions, or other consequences.

**Use at your own risk.**

## License

MIT — see [LICENSE](LICENSE). Applies to source code only, not to TradingView's software, data, or trademarks.
