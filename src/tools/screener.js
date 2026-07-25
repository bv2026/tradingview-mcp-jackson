import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/screener.js';
import { scanIncomeEtfs } from '../core/income_etf.js';
import { monitorIncomeEtfs } from '../core/income_etf_monitor.js';
import { buildMonthlyReview } from '../core/income_etf_monthly_review.js';

export function registerScreenerTools(server) {
  server.tool(
    'screener_get',
    'Read results from the active TradingView Screener panel. Returns symbols in ranked order from the named saved screen. Set include_columns=true to also return the visible column definitions and per-row values (for example NAV performance or dividend yield). Pass max_symbols to limit results (default: all) and offset to skip the first N.',
    {
      screener_name: z
        .string()
        .optional()
        .describe('Name of the saved screen to read (e.g. "MOMENTUM"). If omitted, reads the currently active screen.'),
      screener_id: z
        .string()
        .optional()
        .describe('Stable saved-screener ID from the TradingView screener URL. When provided, target selection uses this ID before the window title.'),
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
      include_columns: z
        .boolean()
        .optional()
        .default(false)
        .describe('Return visible screener columns and their per-row values in addition to symbols. Default: false.'),
    },
    async ({ screener_name, screener_id, max_symbols, offset, include_columns } = {}) => {
      try {
        return jsonResult(await core.get({
          screener_name,
          screener_id,
          max_symbols,
          offset,
          include_columns,
        }));
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

  server.tool(
    'income_etf_scan',
    'Scan an income-ETF TradingView screener across Dividends, NAV performance, Overview, Fund flows, Holdings, Risk, and Technicals tabs. Produces a NAV-first ranking and a score-driven model portfolio with no minimum or target symbol count. Hard qualification gates, position caps, exposure caps, and limited-history rules may leave cash unallocated. Payment frequency is reported but is not a quality requirement. This is a discovery and due-diligence tool, not a buy recommendation.',
    {
      screener_name: z
        .string()
        .optional()
        .default('WKLY-DIV-ETF')
        .describe('Saved TradingView ETF screener name. Default: WKLY-DIV-ETF.'),
      screener_id: z
        .string()
        .optional()
        .describe('Stable TradingView saved-screener ID. Defaults to config/rules.json for WKLY-DIV-ETF.'),
      top_n: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .default(20)
        .describe('Number of ranked rows to display in top. This does not limit portfolio membership. Default: 20.'),
      include_all: z
        .boolean()
        .optional()
        .default(false)
        .describe('Include every ranked distributing fund in addition to the top list. Default: false.'),
      frequency: z
        .enum(['all', 'weekly', 'monthly'])
        .optional()
        .default('all')
        .describe('Optional payment-frequency view. Default "all" ranks every distributing ETF; use "weekly" or "monthly" only for a comparison slice.'),
      portfolio_value: z
        .number()
        .positive()
        .optional()
        .default(100000)
        .describe('Model portfolio value used for allocation and distribution projections. Default: 100000.'),
      min_score: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(55)
        .describe('Minimum composite score before a fund can qualify. Other hard gates still apply. Default: 55.'),
      maximum_position_pct: z
        .number()
        .positive()
        .max(25)
        .optional()
        .default(8)
        .describe('Absolute maximum allocation to one fund; lower score/risk caps may reduce it. Default: 8%.'),
      maximum_exposure_pct: z
        .number()
        .positive()
        .max(50)
        .optional()
        .default(30)
        .describe('Maximum allocation to a recognized exposure bucket. Single-asset/synthetic and crypto buckets are capped at 10%. Default: 30%.'),
    },
    async ({
      screener_name,
      screener_id,
      top_n,
      include_all,
      frequency,
      portfolio_value,
      min_score,
      maximum_position_pct,
      maximum_exposure_pct,
    } = {}) => {
      try {
        return jsonResult(await scanIncomeEtfs({
          screener_name,
          screener_id,
          top_n,
          include_all,
          frequency,
          portfolio_value,
          min_score,
          maximum_position_pct,
          maximum_exposure_pct,
        }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );

  server.tool(
    'income_etf_monitor',
    'Persist the complete income ETF market scan before processing external holdings, compare it with archived prior runs, generate qualification/NAV/yield/allocation alerts and two-scan confirmation state, and optionally compare the model target with an externally supplied actual portfolio object or broker-exported CSV. Duplicate tickers are aggregated and partial cost basis remains unknown. Holdings-derived details are transient and are not persisted or traded. Returns deterministic report inputs compatible with session_save instrument_type="income_etf".',
    {
      screener_name: z
        .string()
        .optional()
        .default('WKLY-DIV-ETF')
        .describe('Saved TradingView ETF screener name. Default: WKLY-DIV-ETF.'),
      screener_id: z
        .string()
        .optional()
        .describe('Stable TradingView saved-screener ID. Defaults to config/rules.json for WKLY-DIV-ETF.'),
      top_n: z
        .number()
        .int()
        .positive()
        .max(100)
        .optional()
        .default(20)
        .describe('Number of ranked rows to display. This does not limit model portfolio membership.'),
      frequency: z
        .enum(['all', 'weekly', 'monthly'])
        .optional()
        .default('all')
        .describe('Optional comparison slice. Default "all" is recommended for portfolio monitoring.'),
      portfolio_value: z
        .number()
        .positive()
        .optional()
        .default(100000)
        .describe('Model portfolio value. Ignored for real drift calculations when actual_portfolio is supplied.'),
      min_score: z
        .number()
        .min(0)
        .max(100)
        .optional()
        .default(55)
        .describe('Minimum composite score before a fund can qualify. Default: 55.'),
      maximum_position_pct: z
        .number()
        .positive()
        .max(25)
        .optional()
        .default(8)
        .describe('Absolute maximum allocation to one model position. Default: 8%.'),
      maximum_exposure_pct: z
        .number()
        .positive()
        .max(50)
        .optional()
        .default(30)
        .describe('Maximum model allocation to a recognized exposure bucket. Default: 30%.'),
      actual_portfolio: z
        .object({
          as_of: z.string().optional(),
          cash: z.number().nonnegative().optional(),
          positions: z.array(z.object({
            ticker: z.string().min(1),
            market_value: z.number().nonnegative(),
            shares: z.number().nonnegative().optional(),
            cost_basis: z.number().nonnegative().optional(),
          })).default([]),
        })
        .optional()
        .describe('Optional external holdings snapshot. Duplicate tickers are aggregated. Omitted cash remains unknown. Used transiently for drift/rebalance recommendations; never persisted or traded.'),
      actual_portfolio_csv_path: z
        .string()
        .optional()
        .describe('Optional broker-exported CSV path. Requires Ticker/Symbol and Mkt Value/Market Value columns; duplicate tickers are aggregated. Mutually exclusive with actual_portfolio.'),
      actual_portfolio_cash: z
        .number()
        .nonnegative()
        .optional()
        .describe('Optional known cash balance to add when actual_portfolio_csv_path is used. If omitted, cash is reported as unknown rather than zero.'),
      allow_additional_funding: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true, recommendations may assume external funding or margin buying power and are not capped by reported cash. No borrowing or trade is executed.'),
      taxable_account: z
        .boolean()
        .optional()
        .default(false)
        .describe('Marks the supplied portfolio as a taxable brokerage account so aggregate cost basis can inform recommendation sequencing. This is not tax advice.'),
      gradual_reconciliation: z
        .boolean()
        .optional()
        .default(false)
        .describe('When true with taxable_account, converts immediate exit language into staged loss-review, loss-aware trim, and defer-or-offset-gain actions.'),
    },
    async ({
      screener_name,
      screener_id,
      top_n,
      frequency,
      portfolio_value,
      min_score,
      maximum_position_pct,
      maximum_exposure_pct,
      actual_portfolio,
      actual_portfolio_csv_path,
      actual_portfolio_cash,
      allow_additional_funding,
      taxable_account,
      gradual_reconciliation,
    } = {}) => {
      try {
        return jsonResult(await monitorIncomeEtfs({
          screener_name,
          screener_id,
          top_n,
          frequency,
          portfolio_value,
          min_score,
          maximum_position_pct,
          maximum_exposure_pct,
          actual_portfolio,
          actual_portfolio_csv_path,
          actual_portfolio_cash,
          allow_additional_funding,
          taxable_account,
          gradual_reconciliation,
        }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );

  server.tool(
    'income_etf_monthly_review',
    'Aggregate the completed weekly income ETF snapshots for a month into deterministic persistence, entry/exit, NAV, income, and latest-target data. Saves monthly-review.json under reports/inc-etf/Mon-review/<YYYY-Mon>/ and returns instructions for session_save instrument_type="income_etf_monthly_review".',
    {
      date: z
        .string()
        .optional()
        .describe('Any date within the review month, preferably YYYY-MM-DD. Defaults to the current month.'),
    },
    async ({ date } = {}) => {
      try {
        return jsonResult(buildMonthlyReview({ date }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    }
  );
}
