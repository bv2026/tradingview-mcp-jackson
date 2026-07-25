# WKLY-DIV-ETF

TradingView ETF Screener used by `income_etf_scan` to identify distributing ETFs that may support a monthly cash-flow plan. Despite the saved screen's name, weekly payment frequency is not a requirement.

## Purpose

This screen is a discovery universe, not a buy list. Weekly and monthly payers are ranked together by economic quality:

1. NAV total return
2. NAV preservation
3. Indicated distribution yield
4. Liquidity and AUM
5. Volatility and beta
6. Expense ratio and fund flows
7. Concentration and leverage flags

Headline yield is deliberately not the primary sort. A large distribution accompanied by falling NAV can represent capital being returned rather than wealth being created.

## Score-driven portfolio policy

The scanner does not target a fixed number of symbols. Its `portfolio` result uses every fund that passes the configured score and hard gates, subject to these controls:

- Default minimum score: 55
- Positive 3-month NAV total return
- Positive 1-year NAV total return when a full year is available
- No severe 1-year NAV erosion or 1-month drawdown
- AUM of at least $25 million and daily dollar volume of at least $500,000
- No leveraged funds or indicated yields above 50%
- Default maximum position: 8%, reduced automatically for lower scores, higher beta, concentration, and limited history
- Default recognized-exposure cap: 30%; crypto and single-asset/synthetic exposure are capped at 10%

Funds missing either required one-year NAV field remain on the watchlist until a
full-year comparison is available. They are not funded from a provisional or
renormalized score. If the qualifying set cannot absorb the full portfolio within
the caps, the remainder is reported as cash rather than forcing weaker funds into
the portfolio.

`top_n` controls only how many ranked rows are displayed. It never limits portfolio membership.

## Score calculation reference

The established-fund composite is `score_version: 1`. The formula is preserved as
implemented; report rendering must never recalculate or alter it.

| Component | Weight | Direction |
|---|---:|---|
| One-year NAV total return percentile | 28% | Higher is better |
| Three-month NAV total return percentile | 16% | Higher is better |
| One-year NAV performance percentile | 16% | Higher is better |
| Indicated-yield quality | 12% | Nonlinear quality band |
| Liquidity composite | 10% | Average of AUM and daily-dollar-volume percentiles |
| Risk composite | 10% | Average of inverse beta and inverse one-month-volatility percentiles |
| Expense ratio percentile | 4% | Lower is better |
| Three-month fund-flow percentile | 4% | Higher is better |

Percentiles are calculated against the distributing funds in the current
frequency scope. The rank is the percentage of valid values less than or equal to
the fund's value. Inverted components subtract that rank from 100. Missing values
receive zero contribution; the score is not renormalized.

### Indicated-yield quality

| Indicated yield | Yield-quality score |
|---|---:|
| Missing or below 5% | 0 |
| 5% through 12% | Linear from 0 to 80 |
| Above 12% through 30% | 100 |
| Above 30% through 40% | 75 |
| Above 40% through 50% | 40 |
| Above 50% | 0 |

### Score penalties

| Condition | Penalty |
|---|---:|
| Indicated yield above 50% | -12 |
| One-year NAV performance below -20% | -12 |
| One-month NAV total return below -10% | -8 |
| AUM below $25 million | -8 |
| Daily dollar volume below $500,000 | -8 |
| Leveraged fund | -12 |
| At most 10 holdings and at least 95% in the top 10 | -8 |

The final score is rounded to one decimal place and clamped to 0–100. Hard
qualification gates are applied after scoring. A score above the minimum does not
override a failed gate.

### Allocation calculation

Qualified funds receive a raw allocation weight of
`max(1, score - 50) ^ 1.25`. The allocator repeatedly distributes remaining
capital in proportion to those raw weights, subject to fund-level and
exposure-level caps. Exposure-cap reductions are not redistributed; they remain
cash.

Fund-level caps are the lowest applicable value:

| Condition | Cap |
|---|---:|
| Configured default | 8% |
| Score below 65 | 4% |
| Score 65 through below 75 | 6% |
| Score 75 through below 85 | 9%, still limited by configured default |
| `INCOME_SATELLITE` | 6% |
| Concentrated or synthetic flag | 2.5% |
| One-year beta above 1.5 | 4% |

Recognized exposure buckets use the configured 30% default. Crypto and
single-asset/synthetic buckets are capped at 10%. Unrecognized funds share one
conservative `unclassified` bucket subject to the configured exposure cap; they
do not receive an uncapped ticker-specific bucket.

## Report path

The workflow matches the standard strategy-report pipeline:

1. `income_etf_scan` returns structured scan, score, qualification, allocation, and reinvestment data.
2. The complete raw result is saved to `reports/inc-etf/<YYYY-WkNN>/scan-income_etf.json`.
3. The caller follows the returned formatting instruction to render the Markdown accumulation report.
4. `income_etf_monitor` writes `reports/inc-etf/<YYYY-WkNN>/income_etf-alerts.json`.
5. `session_save instrument_type="income_etf"` writes `reports/inc-etf/<YYYY-WkNN>/income_etf.md`.

When a canonical weekly scan already exists, the prior scan, alert artifact, and
Markdown report are copied together into the same week's `runs/<timestamp>/`
folder before the new scan replaces the canonical latest snapshot.

The Markdown narrative is model-rendered from deterministic structured values, just like the other strategy briefs. Scores, gates, allocations, cash, and projections come from code and must not be recalculated or changed during rendering.

For the complete monitoring cadence, alert thresholds, external holdings contract, and failure behavior, see `docs/INCOME_ETF_OPERATIONS.md`.

## TradingView tabs read automatically

| Tab | Fields used |
|---|---|
| Dividends | Indicated yield, indicated annual distribution, payment frequency |
| NAV performance | NAV, premium/discount, NAV performance and NAV total return |
| Overview | AUM, daily dollar volume, expense ratio, holdings count |
| Fund flows | 1-month and 3-month net flows |
| Holdings | Top-10 concentration, leverage, management structure |
| Risk | 1-year beta and 1-month volatility |
| Technicals | Daily technical rating and RSI, carried into selected-position output for entry-timing review but not included in the score |

The tool switches among these tabs, merges rows by TradingView symbol, and restores the originally selected tab.

## Recommended universe filters

- Distribution treatment: Distributes
- AUM: at least $25 million for discovery; $100 million preferred for core candidates
- Daily price × volume: at least $500,000; $1 million preferred
- Indicated yield: use 8%–40% as the normal research range
- Expense ratio: no more than 1.5%

Do not automatically exclude yields above 40%; retain them as speculative research candidates with an extreme-yield warning.

Payment frequency should remain visible but should not be used as an eligibility or quality filter. Use it only when arranging the cash-flow calendar after selecting funds.

## Ranking tiers

- `CORE_CANDIDATE`: positive 3-month and 1-year NAV total return, limited NAV erosion, adequate liquidity/AUM, moderate beta, non-leveraged, and a non-extreme indicated yield
- `INCOME_SATELLITE`: economically positive but carries concentration, volatility, liquidity, or NAV-quality tradeoffs
- `LIMITED_HISTORY_WATCH`: positive early results without a reliable one-year record
- `SPECULATIVE`: does not meet core quality requirements
- `AVOID_NAV_EROSION`: non-positive total return or severe NAV decline

## Required external checks

TradingView cannot establish distribution sustainability by itself. Before purchase, review:

- issuer distribution history, preferably 13 and 52 weeks
- latest Section 19(a) notice and estimated return of capital
- 30-day SEC yield
- prospectus strategy and upside cap
- inception date and standardized NAV total return
- tax treatment and account type

`Div yield % (indicated)` is not the same as SEC yield, guaranteed income, or total return.
