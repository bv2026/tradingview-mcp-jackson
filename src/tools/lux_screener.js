import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/lux_screener.js';

export function registerLuxScreenerTools(server) {
  server.tool(
    'lux_screener_scan',
    'Batch-scan a StockTwits momentum watchlist through the 3 LuxAlgo screeners (S&O, PAC, OSC) on the LUXALGO_SCREENERS tab. Pushes symbols in groups of 10, reads composite signal data per symbol, and returns a ranked table with top candidates and names to avoid. Run this before morning_brief to identify which momentum names have actionable setups vs. which are overextended or diverging.',
    {
      instrument_type: z
        .enum(['sp_ndx', 'r2k'])
        .default('sp_ndx')
        .describe('sp_ndx = current week S&P 500 + Nasdaq 100 combined momentum (~40 names, rebuilt Saturdays). r2k = current week Russell 2000 momentum (~25 names, rebuilt Saturdays).'),
      timeframe: z
        .enum(['1D', '1W', '4H'])
        .default('1D')
        .describe('Timeframe to run the screeners on. 1D (daily) for entry timing — recommended. 1W (weekly) for macro bias check.'),
    },
    async ({ instrument_type, timeframe } = {}) => {
      try {
        return jsonResult(await core.runScan({ instrument_type, timeframe }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
