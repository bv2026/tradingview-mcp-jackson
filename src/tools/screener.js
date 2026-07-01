import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/screener.js';

export function registerScreenerTools(server) {
  server.tool(
    'screener_get',
    'Read symbols from the active TradingView Screener panel. Returns symbols in ranked order (strongest first) from the named saved screen. Pass max_symbols to limit results (default: all). Pass offset to skip the first N (for batching a large screener into chunks, e.g. offset=50 max_symbols=50 for symbols 51-100). Symbols include exchange prefix (e.g. NYSE:DELL).',
    {
      screener_name: z
        .string()
        .optional()
        .describe('Name of the saved screen to read (e.g. "MOMENTUM"). If omitted, reads the currently active screen.'),
      max_symbols: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Maximum number of symbols to return (top N by screener rank, after offset is applied). Default: all symbols.'),
      offset: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Number of top-ranked symbols to skip before returning results. Default: 0. Use for batching (e.g. scan symbols 51-100 with offset=50).'),
    },
    async ({ screener_name, max_symbols, offset } = {}) => {
      try {
        return jsonResult(await core.get({ screener_name, max_symbols, offset }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );

  server.tool(
    'screener_list',
    'List recently used saved screens in the TradingView Screener panel.',
    {},
    async () => {
      try {
        return jsonResult(await core.list());
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
