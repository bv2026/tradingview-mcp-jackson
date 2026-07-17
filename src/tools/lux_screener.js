import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/lux_screener.js';

export function registerLuxScreenerTools(server) {
  server.tool(
    'lux_screener_scan',
    'Batch-scan a StockTwits momentum watchlist through the 3 LuxAlgo screeners (S&O, PAC, OSC) on the LUXALGO_SCREENERS tab. Pushes symbols in groups of 10, reads composite signal data per symbol, and returns a ranked table with top candidates and names to avoid. Run this before morning_brief to identify which momentum names have actionable setups vs. which are overextended or diverging.',
    {
      instrument_type: z
        .enum(['sp_ndx', 'r2k', 'thematic_stocks', 'thematic_etfs', 'momentum_stocks', 'momentum_etf', 'momentum_ark'])
        .default('sp_ndx')
        .describe('sp_ndx = current week S&P 500 + Nasdaq 100 combined momentum (~40 names, rebuilt Saturdays). r2k = current week Russell 2000 momentum (~25 names, rebuilt Saturdays). thematic_stocks = full thematic watchlist (~121 stocks across 8 themes, grouped output by theme). thematic_etfs = thematic ETF watchlist. momentum_stocks = full MOMENTUM screener list (~81 US equities). momentum_etf = MOMENTUM-ETF screener list. momentum_ark = ARK innovation watchlist (~110 names, base-building/breakout on 1W).'),
      timeframe: z
        .enum(['1D', '1W', '4H'])
        .default('1W')
        .describe('Timeframe to run the screeners on. 1W (weekly) for position/swing — default for all equity types including momentum_ark. 1D for entry timing. 4H for short-term.'),
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
