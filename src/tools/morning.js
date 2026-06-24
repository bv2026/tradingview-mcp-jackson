import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/morning.js';

export function registerMorningTools(server) {
  server.tool(
    'morning_brief',
    'Run a morning scan for a specific instrument type. Reads live symbols from the TradingView screener, ensures required LuxAlgo indicators are on the chart, scans each symbol, and returns structured data with strategy rules for Claude to generate a session bias. Requires rules.json (screener sources) and strategy-{type}.json (bias criteria).',
    {
      instrument_type: z
        .enum(['stocks', 'ark', 'etf', 'futures', 'indices', 'crypto', 'crypto_perps', 'stwits_lg', 'stwits_sm', 'all'])
        .default('stocks')
        .describe('Instrument type to scan. Use "all" to run all 8 briefs (stocks, etf, ark, crypto, crypto_perps, futures, stwits_lg, stwits_sm) sequentially and auto-save each report plus a daily-summary.md. stwits_lg / stwits_sm = StockTwits top-momentum watchlists (SPX+NDX large-cap / Russell small-cap) sourced from the static watchlist in their strategy files. Default: stocks.'),
      rules_path: z
        .string()
        .optional()
        .describe('Optional path to rules.json. Defaults to rules.json in the project root.'),
    },
    async ({ instrument_type, rules_path } = {}) => {
      try {
        return jsonResult(await core.runBrief({ instrument_type, rules_path }));
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
        .enum(['stocks', 'ark', 'crypto', 'crypto_perps', 'futures', 'etf', 'indices', 'stwits_lg', 'stwits_sm', 'daily_summary'])
        .default('stocks')
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
        .enum(['stocks', 'ark', 'crypto', 'crypto_perps', 'futures', 'etf', 'indices', 'stwits_lg', 'stwits_sm'])
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
