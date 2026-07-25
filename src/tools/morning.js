import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/morning.js';

export function registerMorningTools(server) {
  server.tool(
    'morning_brief',
    'Run a morning scan for a specific instrument type. Reads live symbols from the TradingView screener, ensures required LuxAlgo indicators are on the chart, scans each symbol, and returns structured data with strategy rules for Claude to generate a session bias. Requires rules.json (screener sources) and strategy-{type}.json (bias criteria).',
    {
      instrument_type: z
        .enum(['momentum_stocks', 'momentum_ark', 'momentum_etf', 'futures', 'indices', 'crypto', 'crypto_perps', 'sp_ndx', 'r2k', 'thematic_etfs', 'thematic_etfs_1', 'thematic_etfs_2', 'all'])
        .default('momentum_stocks')
        .describe('Instrument type to scan. Use "all" to run all standard briefs (momentum_stocks, momentum_etf, momentum_ark, crypto, crypto_perps, futures, sp_ndx, r2k) plus thematic reports (thematic_stocks 121-symbol LuxAlgo scan + summary, thematic_etfs_1 + thematic_etfs_2 + combined ETF summary) sequentially, auto-saving each report and a final daily-summary.md. sp_ndx = weekly S&P 500 + Nasdaq 100 momentum (~40 names, Saturdays). r2k = weekly Russell 2000 (~25 names, Saturdays). thematic_etfs_1/_2 = 90 ETFs across 8 themes. thematic_stocks runs via lux_screener_scan (not morning_brief). Default: momentum_stocks.'),
      rules_path: z
        .string()
        .optional()
        .describe('Optional path to rules.json. Defaults to rules.json in the project root.'),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Number of top-ranked screener symbols to skip before scanning. Use with max_symbols to batch a large screener into chunks across multiple calls to stay under the tool timeout — e.g. offset=0 max_symbols=50 for symbols 1-50, then offset=50 max_symbols=50 for symbols 51-100.'),
      max_symbols: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Override the strategy config\'s max_symbols for this call only (0 = uncapped, take everything from offset to the end of the list). Use together with offset to size a batch chunk.'),
    },
    async ({ instrument_type, rules_path, offset, max_symbols } = {}) => {
      try {
        return jsonResult(await core.runBrief({ instrument_type, rules_path, offset, max_symbols }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );

  server.tool(
    'session_save',
    'Save a morning brief report. Full brief → {type}.md. Summary → {type}-summary.md (set is_summary=true). Daily combined summary → daily-summary.md (set instrument_type="daily_summary").',
    {
      brief: z
        .string()
        .describe("The text to save. Full analysis for normal saves; 4-line summary block for is_summary=true; all 6 summaries stacked for instrument_type='daily_summary'."),
      instrument_type: z
        .enum(['momentum_stocks', 'momentum_ark', 'crypto', 'crypto_perps', 'futures', 'momentum_etf', 'income_etf', 'indices', 'sp_ndx', 'r2k', 'thematic_stocks', 'thematic_etfs', 'thematic_etfs_1', 'thematic_etfs_2', 'daily_summary'])
        .default('momentum_stocks')
        .describe('Instrument type. Use "daily_summary" to save the combined all-briefs summary to daily-summary.md.'),
      is_summary: z
        .boolean()
        .optional()
        .default(false)
        .describe('Set true to save a 4-line summary to {type}-summary.md instead of the full brief.'),
      date: z
        .string()
        .optional()
        .describe('Date string YYYY-MM-DD. Defaults to today.'),
    },
    async ({ brief, instrument_type, is_summary, date } = {}) => {
      try {
        return jsonResult(core.saveSession({ brief, instrument_type, is_summary, date }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );

  server.tool(
    'session_get',
    'Retrieve a saved morning brief. Without instrument_type, lists all briefs saved today. With instrument_type, returns that specific brief.',
    {
      date: z
        .string()
        .optional()
        .describe('Date string YYYY-MM-DD. Defaults to today.'),
      instrument_type: z
        .enum(['momentum_stocks', 'momentum_ark', 'crypto', 'crypto_perps', 'futures', 'momentum_etf', 'income_etf', 'indices', 'sp_ndx', 'r2k', 'thematic_stocks', 'thematic_etfs', 'thematic_etfs_1', 'thematic_etfs_2'])
        .optional()
        .describe('Retrieve a specific instrument brief. Omit to list all briefs saved today.'),
    },
    async ({ date, instrument_type } = {}) => {
      try {
        return jsonResult(core.getSession({ date, instrument_type }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
