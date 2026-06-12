import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/morning.js';

export function registerMorningTools(server) {
  server.tool(
    'morning_brief',
    'Run a morning scan for a specific instrument type. Reads live symbols from the TradingView screener, ensures required LuxAlgo indicators are on the chart, scans each symbol, and returns structured data with strategy rules for Claude to generate a session bias. Requires rules.json (screener sources) and strategy-{type}.json (bias criteria).',
    {
      instrument_type: z
        .enum(['stocks', 'ark', 'etf', 'futures', 'indices', 'crypto', 'crypto_perps', 'all'])
        .default('stocks')
        .describe('Instrument type to scan. Use "all" to run all 4 briefs (stocks, crypto, crypto_perps, futures) in one call and auto-save each report. Use "ark" for ARK Innovation watchlist scan. Default: stocks.'),
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
    'Save a morning brief as a human-readable markdown report to reports/YYYY-Mon-DD/{instrument_type}.md in the project directory.',
    {
      brief: z
        .string()
        .describe("Claude's analysis text to save — the full session bias output."),
      instrument_type: z
        .enum(['stocks', 'ark', 'crypto', 'crypto_perps', 'futures', 'etf', 'indices'])
        .default('stocks')
        .describe('Instrument type — determines the filename. Default: stocks.'),
      date: z
        .string()
        .optional()
        .describe('Date string YYYY-MM-DD. Defaults to today.'),
    },
    async ({ brief, instrument_type, date } = {}) => {
      try {
        return jsonResult(core.saveSession({ brief, instrument_type, date }));
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
        .enum(['stocks', 'ark', 'crypto', 'crypto_perps', 'futures', 'etf', 'indices'])
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
