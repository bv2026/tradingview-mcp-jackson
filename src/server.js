import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerHealthTools } from "./tools/health.js";
import { registerChartTools } from "./tools/chart.js";
import { registerPineTools } from "./tools/pine.js";
import { registerDataTools } from "./tools/data.js";
import { registerCaptureTools } from "./tools/capture.js";
import { registerDrawingTools } from "./tools/drawing.js";
import { registerAlertTools } from "./tools/alerts.js";
import { registerBatchTools } from "./tools/batch.js";
import { registerReplayTools } from "./tools/replay.js";
import { registerIndicatorTools } from "./tools/indicators.js";
import { registerWatchlistTools } from "./tools/watchlist.js";
import { registerUiTools } from "./tools/ui.js";
import { registerPaneTools } from "./tools/pane.js";
import { registerTabTools } from "./tools/tab.js";
import { registerMorningTools } from "./tools/morning.js";
import { launch as launchTradingView } from "./core/health.js";

const server = new McpServer(
  {
    name: "tradingview",
    version: "2.0.0",
    description:
      "AI-assisted TradingView chart analysis and Pine Script development via Chrome DevTools Protocol",
  },
  {
    instructions: `TradingView MCP — 78 tools for reading and controlling a live TradingView Desktop chart.

TOOL SELECTION GUIDE — use this to pick the right tool:

Reading your chart:
- chart_get_state → get symbol, timeframe, all indicator names + entity IDs (call first)
- data_get_study_values → get current numeric values from ALL visible indicators (RSI, MACD, BB, EMA, etc.)
- quote_get → get real-time price snapshot (last, OHLC, volume)
- data_get_ohlcv → get price bars. ALWAYS pass summary=true unless you need individual bars

Reading custom Pine indicator output (line.new/label.new/table.new/box.new drawings):
- data_get_pine_lines → horizontal price levels from custom indicators (deduplicated, sorted)
- data_get_pine_labels → text annotations with prices ("PDH 24550", "Bias Long", etc.)
- data_get_pine_tables → table data as formatted rows (session stats, analytics dashboards)
- data_get_pine_boxes → price zones as {high, low} pairs
- ALWAYS pass study_filter to target a specific indicator by name (e.g., study_filter="Profiler")
- Indicators must be VISIBLE on chart for these to work

Changing the chart:
- chart_set_symbol, chart_set_timeframe, chart_set_type → change ticker/resolution/style
- chart_manage_indicator → add/remove studies. USE FULL NAMES: "Relative Strength Index" not "RSI"
- chart_scroll_to_date → jump to a date (ISO format)
- indicator_set_inputs → change indicator settings (length, source, etc.)

Pine Script development:
- pine_set_source → inject code, pine_smart_compile → compile + check errors
- pine_get_errors → read errors, pine_get_console → read log output
- WARNING: pine_get_source can return 200KB+ for complex scripts — avoid unless editing

Screenshots: capture_screenshot → regions: "full", "chart", "strategy_tester"
Replay: replay_start → replay_step → replay_trade → replay_status → replay_stop
Batch: batch_run → run action across multiple symbols/timeframes
Drawing: draw_shape → horizontal_line, trend_line, rectangle, text
Alerts: alert_create, alert_list, alert_delete
Launch: tv_launch → auto-detect and start TradingView with CDP on any platform
Panes: pane_list, pane_set_layout (s, 2h, 2v, 4, 6, 8), pane_focus, pane_set_symbol
Tabs: tab_list, tab_new, tab_close, tab_switch

CONTEXT MANAGEMENT:
- ALWAYS use summary=true on data_get_ohlcv
- ALWAYS use study_filter on pine tools when you know which indicator you want
- NEVER use verbose=true unless user specifically asks for raw data
- Prefer capture_screenshot for visual context over pulling large datasets
- Call chart_get_state ONCE at start, reuse entity IDs`,
  },
);

// Register all tool groups
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
registerMorningTools(server);

// Startup notice (stderr so it doesn't interfere with MCP stdio protocol)
process.stderr.write(
  "⚠  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n",
);
process.stderr.write(
  "   Ensure your usage complies with TradingView's Terms of Use.\n\n",
);

await maybeAutoLaunchTradingView();

// Start stdio transport
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
    const suffix = result?.cdp_ready === false ? " (CDP still warming up)" : "";
    process.stderr.write(`tradingview-mcp  |  TradingView launch requested via ${result?.binary || "auto-detect"}${suffix}\n`);
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
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}
