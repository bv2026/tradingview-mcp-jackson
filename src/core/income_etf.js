import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateOnScreener } from '../connection.js';
import {
  archiveIncomeEtfRun,
  incomeEtfWeekDirFor,
} from './report_paths.js';
import { get as getScreener } from './screener.js';

const SCORE_VERSION = 1;
const TAB_IDS = {
  overview: 'overview',
  fund_flows: 'fundFlows',
  dividends: 'dividends',
  nav: 'navPerformance',
  holdings: 'holdings',
  risk: 'risk',
  technicals: 'technicals',
};
const EXPECTED_TAB_FIELDS = {
  overview: ['AssetsUnderManagement', 'VolumePrice|TimeResolution1D'],
  fund_flows: ['FundFlows|Interval3M'],
  dividends: ['DividendsFrequency', 'DividendsYieldForward'],
  nav: ['NavTotalReturn|Interval3M', 'NavPerformance|Interval1Y'],
  holdings: ['TotalHoldings', 'Leverage'],
  risk: ['Beta|Interval1Y', 'Volatility|Interval1M'],
  technicals: [
    'TechnicalRating|TimeResolution1D',
    'RelativeStrengthIndex|14|TimeResolution1D',
  ],
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function parseNumber(value) {
  if (value == null || value === '' || value === '—') return null;
  const text = String(value)
    .replace(/−/g, '-')
    .replace(/[+,%]/g, '')
    .replace(/\s+USD$/i, '')
    .trim();
  const match = text.match(/^(-?[\d.]+)\s*([KMBT])?$/i);
  if (!match) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(match[2] || '').toUpperCase()] || 1;
  const number = Number(match[1]) * scale;
  return Number.isFinite(number) ? number : null;
}

function percentile(values, value, invert = false) {
  if (value == null) return 0;
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return 0;
  const below = valid.filter(item => item <= value).length;
  const rank = (below / valid.length) * 100;
  return invert ? 100 - rank : rank;
}

function yieldQuality(yieldPct) {
  if (yieldPct == null || yieldPct < 5) return 0;
  if (yieldPct <= 12) return (yieldPct - 5) / 7 * 80;
  if (yieldPct <= 30) return 100;
  if (yieldPct <= 40) return 75;
  if (yieldPct <= 50) return 40;
  return 0;
}

function exposureBucket(row) {
  const ticker = (row.ticker || '').toUpperCase();
  const text = `${row.ticker || ''} ${row.name || ''}`.toLowerCase();
  if (/^(SPYI|SPYT|SPYH|XDTE|XPAY|JEPI)$/.test(ticker)) return 'us_large_cap';
  if (/^(QQQI|JEPQ|QQQH|QDTE|QQQY|QQQT)$/.test(ticker)) return 'nasdaq_100';
  if (/^(IWMI|RDTE|RDTY)$/.test(ticker)) return 'small_cap';
  if (/\b(bitcoin|ether|crypto|digital asset)\b/.test(text)) return 'crypto';
  if (/\b(mlp|midstream|oil|gas|energy)\b/.test(text)) return 'energy';
  if (/\b(russell|r2000|small[\s-]?cap)\b/.test(text)) return 'small_cap';
  if (/\b(nasdaq|qqq|innovation[\s-]?100)\b/.test(text)) return 'nasdaq_100';
  if (/\b(s&p|sp 500|spy|large[\s-]?cap)\b/.test(text)) return 'us_large_cap';
  if (/\b(ai|artificial intelligence|semiconductor|technology)\b/.test(text)) {
    return 'technology_ai';
  }
  if (/\b(treasur|bond|fixed income|credit)\b/.test(text)) return 'fixed_income';
  if ((row.holdings_count ?? Infinity) <= 10 && (row.top_10_weight_pct ?? 0) >= 95) {
    return 'single_asset_or_synthetic';
  }
  return 'unclassified';
}

function qualification(row, minScore = 55) {
  const rejectionReasons = [];
  const limitedHistory = row.nav_total_return_1y_pct == null ||
    row.nav_performance_1y_pct == null;
  const leveraged = row.flags?.includes('LEVERAGED');

  if (row.indicated_yield_pct == null || row.indicated_yield_pct < 5) {
    rejectionReasons.push('YIELD_DATA_OR_MINIMUM_FAILED');
  }
  if ((row.indicated_yield_pct ?? 0) > 50) rejectionReasons.push('EXTREME_INDICATED_YIELD');
  if (row.nav_total_return_3m_pct == null || row.nav_total_return_3m_pct <= 0) {
    rejectionReasons.push('NONPOSITIVE_OR_MISSING_3M_TOTAL_RETURN');
  }
  if (!limitedHistory && row.nav_total_return_1y_pct <= 0) {
    rejectionReasons.push('NONPOSITIVE_1Y_TOTAL_RETURN');
  }
  if (!limitedHistory && row.nav_performance_1y_pct <= -20) {
    rejectionReasons.push('SEVERE_1Y_NAV_EROSION');
  }
  if ((row.nav_total_return_1m_pct ?? 0) <= -12) rejectionReasons.push('SEVERE_1M_DRAWDOWN');
  if ((row.aum ?? 0) < 25e6) rejectionReasons.push('AUM_BELOW_25M');
  if ((row.daily_dollar_volume ?? 0) < 500e3) rejectionReasons.push('LIQUIDITY_BELOW_500K');
  if (leveraged) rejectionReasons.push('LEVERAGED');

  if (rejectionReasons.length) {
    return { status: 'EXCLUDED', rejection_reasons: rejectionReasons };
  }
  if (limitedHistory) {
    return {
      status: 'WATCHLIST',
      rejection_reasons: ['LIMITED_HISTORY_REQUIRES_FULL_YEAR'],
    };
  }
  if (row.score < minScore) {
    return {
      status: 'EXCLUDED',
      rejection_reasons: ['SCORE_BELOW_MINIMUM'],
    };
  }
  return { status: 'QUALIFIED', rejection_reasons: [] };
}

function positionCap(row, status, maximumPct) {
  let cap = maximumPct;
  if (row.score < 65) cap = Math.min(cap, 4);
  else if (row.score < 75) cap = Math.min(cap, 6);
  else if (row.score < 85) cap = Math.min(cap, 9);
  if (row.tier === 'INCOME_SATELLITE') cap = Math.min(cap, 6);
  if (row.flags?.includes('CONCENTRATED_OR_SYNTHETIC')) cap = Math.min(cap, 2.5);
  if ((row.beta_1y ?? 0) > 1.5) cap = Math.min(cap, 4);
  return cap;
}

function allocateWithCaps(candidates, maximumPositionPct) {
  const positions = candidates.map(row => ({
    row,
    weight: 0,
    raw_weight: Math.pow(Math.max(1, row.score - 50), 1.25),
    cap: positionCap(row, row.qualification_status, maximumPositionPct),
  }));

  let remaining = 100;
  for (let pass = 0; pass < 50 && remaining > 0.001; pass++) {
    const active = positions.filter(position => position.weight + 0.001 < position.cap);
    if (!active.length) break;
    const rawTotal = active.reduce((sum, position) => sum + position.raw_weight, 0);
    let allocated = 0;
    for (const position of active) {
      const proposed = remaining * position.raw_weight / rawTotal;
      const addition = Math.min(proposed, position.cap - position.weight);
      position.weight += addition;
      allocated += addition;
    }
    if (allocated < 0.001) break;
    remaining -= allocated;
  }
  return positions;
}

function exposureCap(bucket, maximumExposurePct) {
  if (bucket === 'single_asset_or_synthetic' || bucket === 'crypto') {
    return Math.min(10, maximumExposurePct);
  }
  return maximumExposurePct;
}

function futureValue(principal, annualReturnPct, years) {
  const monthlyRate = annualReturnPct / 100 / 12;
  return principal * Math.pow(1 + monthlyRate, years * 12);
}

function buildPortfolio(rows, {
  portfolioValue = 100000,
  minScore = 55,
  maximumPositionPct = 8,
  maximumExposurePct = 30,
} = {}) {
  const evaluated = rows.map(row => ({
    ...row,
    exposure_bucket: exposureBucket(row),
    ...qualification(row, minScore),
  }));
  const candidates = evaluated
    .filter(row => row.status === 'QUALIFIED')
    .map(row => ({ ...row, qualification_status: row.status }));
  const allocated = allocateWithCaps(candidates, maximumPositionPct);

  const bucketTotals = new Map();
  for (const position of allocated) {
    const bucket = position.row.exposure_bucket;
    bucketTotals.set(bucket, (bucketTotals.get(bucket) || 0) + position.weight);
  }
  for (const [bucket, total] of bucketTotals) {
    const cap = exposureCap(bucket, maximumExposurePct);
    if (total <= cap) continue;
    const scale = cap / total;
    for (const position of allocated) {
      if (position.row.exposure_bucket === bucket) position.weight *= scale;
    }
  }

  const positions = allocated
    .filter(position => position.weight >= 0.01)
    .map(position => {
      const allocationPct = Number(position.weight.toFixed(2));
      const allocation = portfolioValue * allocationPct / 100;
      const annualDistribution = allocation *
        (position.row.indicated_yield_pct || 0) / 100;
      return {
        symbol: position.row.symbol,
        ticker: position.row.ticker,
        name: position.row.name,
        score: position.row.score,
        tier: position.row.tier,
        qualification_status: position.row.qualification_status,
        exposure_bucket: position.row.exposure_bucket,
        allocation_pct: allocationPct,
        allocation: Number(allocation.toFixed(2)),
        position_cap_pct: position.cap,
        indicated_yield_pct: position.row.indicated_yield_pct,
        projected_annual_distribution: Number(annualDistribution.toFixed(2)),
        projected_average_monthly_distribution: Number((annualDistribution / 12).toFixed(2)),
        technical_rating: position.row.technical_rating,
        rsi_14: position.row.rsi_14,
        flags: position.row.flags,
      };
    })
    .sort((a, b) => b.allocation_pct - a.allocation_pct || b.score - a.score);

  const investedPct = positions.reduce((sum, position) => sum + position.allocation_pct, 0);
  const annualDistribution = positions.reduce(
    (sum, position) => sum + position.projected_annual_distribution,
    0
  );
  const investedValue = portfolioValue * investedPct / 100;
  const excluded = evaluated.filter(row => row.status === 'EXCLUDED');
  const watchlist = evaluated.filter(row => row.status === 'WATCHLIST');

  return {
    policy: 'No minimum or target fund count. Qualification and score determine membership; caps may leave cash unallocated.',
    portfolio_value: portfolioValue,
    minimum_score: minScore,
    maximum_position_pct: maximumPositionPct,
    maximum_exposure_pct: maximumExposurePct,
    qualified_count: positions.length,
    watchlist_count: watchlist.length,
    excluded_count: excluded.length,
    invested_pct: Number(investedPct.toFixed(2)),
    invested_value: Number(investedValue.toFixed(2)),
    cash_pct: Number(Math.max(0, 100 - investedPct).toFixed(2)),
    cash_value: Number(Math.max(0, portfolioValue - investedValue).toFixed(2)),
    weighted_indicated_yield_on_total_portfolio_pct: Number(
      (annualDistribution / portfolioValue * 100).toFixed(2)
    ),
    weighted_indicated_yield_on_invested_capital_pct: investedValue
      ? Number((annualDistribution / investedValue * 100).toFixed(2))
      : 0,
    projected_annual_distribution: Number(annualDistribution.toFixed(2)),
    projected_average_monthly_distribution: Number((annualDistribution / 12).toFixed(2)),
    positions,
    watchlist: watchlist.map(row => ({
      symbol: row.symbol,
      ticker: row.ticker,
      score: row.score,
      reasons: row.rejection_reasons,
    })),
    exclusion_summary: excluded.reduce((summary, row) => {
      for (const reason of row.rejection_reasons) {
        summary[reason] = (summary[reason] || 0) + 1;
      }
      return summary;
    }, {}),
    reinvestment_scenarios: [8, 10, 15].map(annualTotalReturnPct => ({
      annual_total_return_pct: annualTotalReturnPct,
      value_after_5_years: Number(
        futureValue(portfolioValue, annualTotalReturnPct, 5).toFixed(2)
      ),
      value_after_10_years: Number(
        futureValue(portfolioValue, annualTotalReturnPct, 10).toFixed(2)
      ),
    })),
    warning: 'Indicated distribution yield is not total return. Reinvestment projections use separate total-return scenarios and do not assume the indicated yield is earned.',
  };
}

async function selectedTab(screenerName) {
  return evaluateOnScreener(`
    (function() {
      var selected = Array.from(document.querySelectorAll('button[role="tab"]'))
        .find(function(button) {
          return button.getAttribute('aria-selected') === 'true' ||
            /selected/.test(button.className || '');
        });
      return selected ? selected.getAttribute('data-qa-id') : null;
    })()
  `, screenerName);
}

async function selectTab(tabId, screenerName) {
  const clicked = await evaluateOnScreener(`
    (function() {
      var button = document.querySelector('button[role="tab"][data-qa-id="${tabId}"]');
      if (!button) return false;
      button.click();
      return true;
    })()
  `, screenerName);
  if (!clicked) throw new Error(`TradingView screener tab "${tabId}" was not found.`);
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await selectedTab(screenerName) === tabId) return;
    await wait(150);
  }
  throw new Error(`TradingView screener tab "${tabId}" did not become active.`);
}

async function captureTab(key, tabId, screenerName) {
  await selectTab(tabId, screenerName);
  const expectedFields = EXPECTED_TAB_FIELDS[key] || [];
  let lastFields = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const capture = await getScreener({
      screener_name: screenerName,
      include_columns: true,
    });
    lastFields = (capture.columns || []).map(column => column.field);
    if (
      capture.rows?.length &&
      expectedFields.every(field => lastFields.includes(field))
    ) {
      return capture;
    }
    await wait(250);
  }
  throw new Error(
    `TradingView screener tab "${tabId}" did not expose its expected columns. ` +
    `Expected: ${expectedFields.join(', ')}. Found: ${lastFields.join(', ')}.`
  );
}

function validateCaptureUniverses(captures) {
  const entries = Object.entries(captures);
  if (!entries.length) throw new Error('No TradingView screener tabs were captured.');
  const [baselineKey, baselineCapture] = entries[0];
  const baseline = new Set((baselineCapture.rows || []).map(row => row.symbol));
  for (const [key, capture] of entries.slice(1)) {
    const current = new Set((capture.rows || []).map(row => row.symbol));
    const missing = [...baseline].filter(symbol => !current.has(symbol));
    const added = [...current].filter(symbol => !baseline.has(symbol));
    if (missing.length || added.length) {
      throw new Error(
        `TradingView screener tab universe mismatch: ${baselineKey} has ` +
        `${baseline.size} symbols and ${key} has ${current.size}. ` +
        `Missing from ${key}: ${missing.slice(0, 10).join(', ') || 'none'}. ` +
        `Only in ${key}: ${added.slice(0, 10).join(', ') || 'none'}.`
      );
    }
  }
}

export const incomeEtfTestHelpers = {
  parseNumber,
  yieldQuality,
  exposureBucket,
  qualification,
  buildPortfolio,
  validateCaptureUniverses,
};

function value(row, field) {
  return row?.values?.[field] ?? null;
}

function mergeRows(captures) {
  const merged = new Map();
  for (const [tab, capture] of Object.entries(captures)) {
    for (const row of capture.rows || []) {
      const current = merged.get(row.symbol) || {
        symbol: row.symbol,
        ticker: row.ticker,
        name: row.name,
        tabs: {},
      };
      current.tabs[tab] = row;
      if (!current.name && row.name) current.name = row.name;
      merged.set(row.symbol, current);
    }
  }
  return [...merged.values()];
}

function normalize(row) {
  const overview = row.tabs.overview;
  const flows = row.tabs.fund_flows;
  const dividends = row.tabs.dividends;
  const nav = row.tabs.nav;
  const holdings = row.tabs.holdings;
  const risk = row.tabs.risk;
  const technicals = row.tabs.technicals;

  return {
    symbol: row.symbol,
    ticker: row.ticker,
    name: row.name,
    distribution_frequency: value(dividends, 'DividendsFrequency'),
    indicated_yield_pct: parseNumber(value(dividends, 'DividendsYieldForward')),
    indicated_annual_distribution: parseNumber(value(dividends, 'IndicatedAnnualDividend')),
    price: parseNumber(value(dividends, 'Price') || value(overview, 'Price')),
    nav: parseNumber(value(nav, 'NetAssetsValue')),
    premium_discount_pct: parseNumber(value(nav, 'DiscountToPremiumToNav')),
    nav_performance_1m_pct: parseNumber(value(nav, 'NavPerformance|Interval1M')),
    nav_performance_3m_pct: parseNumber(value(nav, 'NavPerformance|Interval3M')),
    nav_performance_1y_pct: parseNumber(value(nav, 'NavPerformance|Interval1Y')),
    nav_total_return_1m_pct: parseNumber(value(nav, 'NavTotalReturn|Interval1M')),
    nav_total_return_3m_pct: parseNumber(value(nav, 'NavTotalReturn|Interval3M')),
    nav_total_return_1y_pct: parseNumber(value(nav, 'NavTotalReturn|Interval1Y')),
    aum: parseNumber(value(overview, 'AssetsUnderManagement')),
    daily_dollar_volume: parseNumber(value(overview, 'VolumePrice|TimeResolution1D')),
    expense_ratio_pct: parseNumber(value(overview, 'ExpenseRatio')),
    fund_flow_1m: parseNumber(value(flows, 'FundFlows|Interval1M')),
    fund_flow_3m: parseNumber(value(flows, 'FundFlows|Interval3M')),
    holdings_count: parseNumber(value(holdings, 'TotalHoldings')),
    top_10_weight_pct: parseNumber(value(holdings, 'PercentInTop10')),
    leverage: value(holdings, 'Leverage'),
    beta_1y: parseNumber(value(risk, 'Beta|Interval1Y')),
    volatility_1m_pct: parseNumber(value(risk, 'Volatility|Interval1M')),
    technical_rating: value(technicals, 'TechnicalRating|TimeResolution1D'),
    rsi_14: parseNumber(value(technicals, 'RelativeStrengthIndex|14|TimeResolution1D')),
  };
}

function scoreRows(rows, frequencyScope = 'all') {
  const distributing = rows.filter(row => {
    const frequency = (row.distribution_frequency || '').toLowerCase();
    if (!frequency) return false;
    return frequencyScope === 'all' || frequency === frequencyScope;
  });
  const series = field => distributing.map(row => row[field]).filter(Number.isFinite);
  const total1y = series('nav_total_return_1y_pct');
  const total3m = series('nav_total_return_3m_pct');
  const nav1y = series('nav_performance_1y_pct');
  const aum = series('aum');
  const liquidity = series('daily_dollar_volume');
  const beta = series('beta_1y');
  const volatility = series('volatility_1m_pct');
  const expense = series('expense_ratio_pct');
  const flows = series('fund_flow_3m');

  return distributing.map(row => {
    const leveraged = /leveraged/i.test(row.leverage || '') &&
      !/^non-leveraged$/i.test(row.leverage || '');
    const broadIndexLike = /(s&p|nasdaq|russell|r2000|innovation-100|dow|index)/i
      .test(row.name || '');
    const concentratedSingleTheme = (
      (row.holdings_count ?? Infinity) <= 10 &&
      (row.top_10_weight_pct ?? 0) >= 95 &&
      !broadIndexLike
    );
    const historyComplete = row.nav_total_return_1y_pct != null && row.nav_performance_1y_pct != null;
    const liquidityScore = (
      percentile(aum, row.aum) +
      percentile(liquidity, row.daily_dollar_volume)
    ) / 2;
    const riskScore = (
      percentile(beta, row.beta_1y, true) +
      percentile(volatility, row.volatility_1m_pct, true)
    ) / 2;

    let score =
      0.28 * percentile(total1y, row.nav_total_return_1y_pct) +
      0.16 * percentile(total3m, row.nav_total_return_3m_pct) +
      0.16 * percentile(nav1y, row.nav_performance_1y_pct) +
      0.12 * yieldQuality(row.indicated_yield_pct) +
      0.10 * liquidityScore +
      0.10 * riskScore +
      0.04 * percentile(expense, row.expense_ratio_pct, true) +
      0.04 * percentile(flows, row.fund_flow_3m);

    const flags = [];
    if (!historyComplete) flags.push('LIMITED_HISTORY');
    if ((row.indicated_yield_pct ?? 0) > 50) {
      score -= 12;
      flags.push('EXTREME_INDICATED_YIELD');
    }
    if ((row.nav_performance_1y_pct ?? 0) < -20) {
      score -= 12;
      flags.push('NAV_EROSION');
    }
    if ((row.nav_total_return_1m_pct ?? 0) < -10) {
      score -= 8;
      flags.push('SHARP_1M_DRAWDOWN');
    }
    if ((row.aum ?? Infinity) < 25e6) {
      score -= 8;
      flags.push('LOW_AUM');
    }
    if ((row.daily_dollar_volume ?? Infinity) < 500e3) {
      score -= 8;
      flags.push('LOW_LIQUIDITY');
    }
    if (leveraged) {
      score -= 12;
      flags.push('LEVERAGED');
    }
    if ((row.holdings_count ?? Infinity) <= 10 && (row.top_10_weight_pct ?? 0) >= 95) {
      score -= 8;
      flags.push('CONCENTRATED_OR_SYNTHETIC');
    }

    const coreEligible =
      historyComplete &&
      row.indicated_yield_pct >= 8 &&
      row.indicated_yield_pct <= 40 &&
      row.nav_total_return_3m_pct > 0 &&
      row.nav_total_return_1y_pct > 0 &&
      row.nav_performance_1y_pct > -10 &&
      row.aum >= 100e6 &&
      row.daily_dollar_volume >= 1e6 &&
      (row.beta_1y == null || row.beta_1y <= 1.5) &&
      !leveraged &&
      !concentratedSingleTheme;

    let tier = 'SPECULATIVE';
    if (coreEligible && score >= 55) tier = 'CORE_CANDIDATE';
    else if (!historyComplete && (row.nav_total_return_3m_pct ?? -Infinity) > 0) tier = 'LIMITED_HISTORY_WATCH';
    else if (
      (row.nav_total_return_1y_pct ?? 0) <= 0 ||
      (row.nav_performance_1y_pct ?? 0) <= -30
    ) tier = 'AVOID_NAV_EROSION';
    else if (score >= 35) tier = 'INCOME_SATELLITE';

    return {
      ...row,
      score: Math.max(0, Math.min(100, Number(score.toFixed(1)))),
      tier,
      flags,
    };
  }).sort((a, b) => b.score - a.score);
}

export async function scanIncomeEtfs({
  screener_name = 'WKLY-DIV-ETF',
  top_n = 20,
  include_all = false,
  frequency = 'all',
  portfolio_value = 100000,
  min_score = 55,
  maximum_position_pct = 8,
  maximum_exposure_pct = 30,
} = {}) {
  const generatedAt = new Date().toISOString();
  const originalTab = await selectedTab(screener_name);
  const captures = {};

  try {
    for (const [key, tabId] of Object.entries(TAB_IDS)) {
      captures[key] = await captureTab(key, tabId, screener_name);
    }
    validateCaptureUniverses(captures);
  } finally {
    if (originalTab && Object.values(TAB_IDS).includes(originalTab)) {
      try { await selectTab(originalTab, screener_name); } catch {}
    }
  }

  const normalized = mergeRows(captures).map(normalize);
  const ranked = scoreRows(normalized, frequency);
  const portfolio = buildPortfolio(ranked, {
    portfolioValue: portfolio_value,
    minScore: min_score,
    maximumPositionPct: maximum_position_pct,
    maximumExposurePct: maximum_exposure_pct,
  });
  const frequencyCounts = normalized.reduce((counts, row) => {
    const key = row.distribution_frequency || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const tierCounts = ranked.reduce((counts, row) => {
    counts[row.tier] = (counts[row.tier] || 0) + 1;
    return counts;
  }, {});

  const result = {
    success: true,
    screener_name,
    generated_at: generatedAt,
    universe_size: normalized.length,
    frequency_scope: frequency,
    funds_ranked: ranked.length,
    frequency_counts: frequencyCounts,
    funds_excluded_by_frequency: normalized.length - ranked.length,
    tier_counts: tierCounts,
    methodology: {
      score_version: SCORE_VERSION,
      primary: 'NAV total return and NAV preservation regardless of payment frequency',
      secondary: 'indicated yield quality, liquidity, risk, expenses, and fund flows',
      score_components: {
        nav_total_return_1y: 0.28,
        nav_total_return_3m: 0.16,
        nav_performance_1y: 0.16,
        indicated_yield_quality: 0.12,
        liquidity: 0.10,
        risk: 0.10,
        expense_ratio: 0.04,
        fund_flows_3m: 0.04,
      },
      missing_data_policy: 'Missing values receive zero contribution; weights are not renormalized. Funds missing either required one-year NAV field remain watchlist-only.',
      frequency_policy: 'Payment frequency is reported for cash-flow scheduling, not used as a quality score.',
      indicated_yield_warning: 'TradingView indicated yield is not SEC yield or guaranteed total return.',
      external_due_diligence_required: [
        'issuer distribution history',
        '19a-1 return-of-capital estimates',
        '30-day SEC yield',
        'strategy/prospectus review',
        'tax-account fit',
      ],
    },
    portfolio,
    instruction: [
      `Write the final Markdown report from this structured scan. The report body must begin with "## Portfolio Decision" because session_save adds the H1 title and date.`,
      `State that this is an accumulation strategy and all distributions are reinvested; do not describe indicated distributions as guaranteed total return.`,
      `Include an Executive Snapshot table with portfolio value, universe size, qualified count, invested percentage, cash percentage, weighted indicated yield on the total portfolio, and projected average monthly distribution.`,
      `Include a "## Selected Portfolio" table using every row in portfolio.positions, not just top. Columns: Rank | Symbol | Score | Tier | Allocation | Yield | Est. Monthly | Exposure | Flags.`,
      `Include "## Why Cash Is Retained", explaining material exclusion reasons from portfolio.exclusion_summary. Never force the cash balance into lower-scored funds.`,
      `Include "## Exposure Review", aggregating allocation by exposure_bucket and comparing recognized buckets with the configured exposure cap.`,
      `Include "## Watchlist" when portfolio.watchlist is non-empty; otherwise state that no limited-history watchlist names passed the current preliminary gates.`,
      `Include "## Reinvestment Projection" using portfolio.reinvestment_scenarios. Clearly label these as separate total-return assumptions rather than projections based on indicated distribution yield.`,
      `End with "## Portfolio Actions": reinvest distributions, review qualification monthly, rebalance quarterly, remove hard-gate failures, and deploy retained cash only when candidates qualify.`,
      `After writing the complete report, call session_save with instrument_type="income_etf". Do not wait for the user to ask.`,
    ].join(' '),
    top: ranked.slice(0, top_n),
  };
  if (include_all) result.all = ranked;

  const reportDir = incomeEtfWeekDirFor();
  mkdirSync(reportDir, { recursive: true });
  const rawPath = join(reportDir, 'scan-income_etf.json');
  result.previous_run_archived_to = archiveIncomeEtfRun(reportDir);
  writeFileSync(rawPath, JSON.stringify({ ...result, all: ranked }, null, 2), 'utf8');
  result.saved_to = rawPath;

  return result;
}
