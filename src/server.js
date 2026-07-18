import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerHealthTools } from './tools/health.js';
import { registerChartTools } from './tools/chart.js';
import { registerPineTools } from './tools/pine.js';
import { registerDataTools } from './tools/data.js';
import { registerCaptureTools } from './tools/capture.js';
import { registerDrawingTools } from './tools/drawing.js';
import { registerAlertTools } from './tools/alerts.js';
import { registerBatchTools } from './tools/batch.js';
import { registerReplayTools } from './tools/replay.js';
import { registerIndicatorTools } from './tools/indicators.js';
import { registerWatchlistTools } from './tools/watchlist.js';
import { registerUiTools } from './tools/ui.js';
import { registerPaneTools } from './tools/pane.js';
import { registerTabTools } from './tools/tab.js';
import { registerScreenerTools } from './tools/screener.js';
import { registerMorningTools } from './tools/morning.js';
import { registerLuxScreenerTools } from './tools/lux_screener.js';
import { launch as launchTradingView } from './core/health.js';

const server = new McpServer(
  {
    name: 'tradingview',
    version: '3.0.0',
    description:
      'AI-assisted TradingView chart analysis and Pine Script development via Chrome DevTools Protocol',
  },
  {
    instructions: `TradingView MCP — tools for reading and controlling a live TradingView Desktop chart.

TOOL SELECTION GUIDE:

Morning workflow (instrument_type: stocks | etf | ark | crypto | crypto_perps | futures | all):
- screener_get        → read live symbols from TradingView MOMENTUM screener (top N ranked)
- morning_brief       → full scan: screener symbols + indicators + strategy rules → Claude generates bias
- session_save        → save today's brief to disk
- session_get         → retrieve saved brief

Reading your chart:
- chart_get_state     → symbol, timeframe, all indicator names + entity IDs (call first)
- data_get_study_values → current numeric values from all visible indicators
- quote_get           → real-time price snapshot

Reading custom Pine indicator output:
- data_get_pine_lines  → horizontal price levels
- data_get_pine_labels → text annotations with prices
- data_get_pine_tables → table data as formatted rows
- data_get_pine_boxes  → price zones as {high, low} pairs
- Always pass study_filter to target a specific indicator

Changing the chart:
- chart_set_symbol, chart_set_timeframe, chart_set_type
- chart_manage_indicator → add/remove studies (use FULL names)
- indicator_set_inputs   → change indicator settings

Pine Script: pine_set_source → pine_smart_compile → pine_get_errors → pine_save
Screenshots: capture_screenshot (regions: full, chart, strategy_tester)
Replay: replay_start → replay_step → replay_trade → replay_stop
Batch: batch_run → run action across multiple symbols/timeframes
Drawing: draw_shape, draw_list, draw_clear
Alerts: alert_create, alert_list, alert_delete

CONTEXT MANAGEMENT:
- Always use summary=true on data_get_ohlcv
- Always use study_filter on pine tools when targeting a specific indicator
- Prefer capture_screenshot for visual context over large datasets
- Call chart_get_state once at start, reuse entity IDs`,
  }
);

// Core tools
registerHealthTools(server);
registerChartTools(server);
registerPineTools(server);
registerDataTools(server);
registerCaptureTools(server);
registerDrawingTools(server);
registerAlertTools(server);
registerBatchTools(server);
registerReplayTools(server);
registerIndicatorTools(server);
registerWatchlistTools(server);
registerUiTools(server);
registerPaneTools(server);
registerTabTools(server);

// Screener-driven morning workflow
registerScreenerTools(server);
registerMorningTools(server);
registerLuxScreenerTools(server);

// Codex Desktop currently filters tools that advertise taskSupport="forbidden".
// These tools are normal immediate MCP calls, so omit the optional execution
// metadata instead of publishing a value that makes the client hide them.
for (const tool of Object.values(server._registeredTools || {})) {
  delete tool.execution;
}

process.stderr.write(
  '⚠  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n'
);
process.stderr.write(
  '   Ensure your usage complies with TradingView\'s Terms of Use.\n\n'
);

await maybeAutoLaunchTradingView();

const transport = new StdioServerTransport();
await server.connect(transport);

async function maybeAutoLaunchTradingView() {
  if (!isEnabled(process.env.TV_AUTO_LAUNCH)) return;

  const port = Number(process.env.TV_AUTO_LAUNCH_PORT || process.env.TV_CDP_PORT || 9222);
  const killExisting = process.env.TV_AUTO_LAUNCH_KILL_EXISTING == null
    ? true
    : isEnabled(process.env.TV_AUTO_LAUNCH_KILL_EXISTING);

  try {
    if (await isCdpReady(port)) {
      process.stderr.write(`tradingview-mcp  |  CDP already available on port ${port}, skipping auto-launch.\n`);
      return;
    }
    process.stderr.write(`tradingview-mcp  |  TV_AUTO_LAUNCH enabled, starting TradingView on port ${port}...\n`);
    const result = await launchTradingView({ port, kill_existing: killExisting });
    const suffix = result?.cdp_ready === false ? ' (CDP still warming up)' : '';
    process.stderr.write(`tradingview-mcp  |  TradingView launched via ${result?.binary || 'auto-detect'}${suffix}\n`);
  } catch (err) {
    process.stderr.write(`tradingview-mcp  |  Auto-launch failed: ${err.message}\n`);
  }
}

async function isCdpReady(port) {
  try {
    const response = await fetch(`http://localhost:${port}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}
