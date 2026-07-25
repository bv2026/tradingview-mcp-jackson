import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { scanIncomeEtfs } from './income_etf.js';
import {
  INCOME_ETF_REPORTS_DIR,
  incomeEtfWeekDirFor,
} from './report_paths.js';

const SNAPSHOT_NAME = 'scan-income_etf.json';

function tickerOf(row) {
  return row?.ticker || row?.symbol?.split(':').pop() || row?.symbol;
}

function indexByTicker(rows = []) {
  return new Map(rows.map(row => [tickerOf(row), row]).filter(([ticker]) => ticker));
}

function collectSnapshotPaths(directory, results) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'Mon-review') collectSnapshotPaths(path, results);
    } else if (entry.name === SNAPSHOT_NAME) {
      results.push(path);
    }
  }
}

function previousSnapshotPaths(
  currentPath,
  reportsDir = INCOME_ETF_REPORTS_DIR,
  limit = 2,
) {
  if (!existsSync(reportsDir)) return null;
  const resolvedCurrent = currentPath ? currentPath.toLowerCase() : null;
  const currentWeek = /[\\/](\d{4}-Wk\d{2})[\\/]/i.exec(currentPath || '')?.[1];
  const paths = [];
  const candidates = [];
  collectSnapshotPaths(reportsDir, paths);
  for (const snapshotPath of paths) {
    if (snapshotPath.toLowerCase() === resolvedCurrent) continue;
    const week = /[\\/](\d{4}-Wk\d{2})[\\/]/i.exec(snapshotPath)?.[1];
    if (currentWeek && week === currentWeek) continue;
    const snapshot = loadSnapshot(snapshotPath);
    candidates.push({
      path: snapshotPath,
      week,
      generated: Date.parse(snapshot?.generated_at || '') || 0,
      modified: statSync(snapshotPath).mtimeMs,
    });
  }

  candidates.sort((a, b) => b.generated - a.generated || b.modified - a.modified);
  const selected = [];
  const seenWeeks = new Set();
  for (const candidate of candidates) {
    if (candidate.week && seenWeeks.has(candidate.week)) continue;
    if (candidate.week) seenWeeks.add(candidate.week);
    selected.push(candidate.path);
    if (selected.length >= limit) break;
  }
  return selected;
}

function previousSnapshotPath(currentPath, reportsDir = INCOME_ETF_REPORTS_DIR) {
  return previousSnapshotPaths(currentPath, reportsDir, 1)?.[0] || null;
}

function loadSnapshot(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field);
      if (row.some(value => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some(value => value.trim() !== '')) rows.push(row);
  return rows;
}

function parseCsvNumber(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const negative = /^\(.*\)$/.test(text);
  const parsed = Number(text.replace(/[,$%()\s]/g, ''));
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

function normalizeHeader(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ');
}

function findHeader(headers, aliases) {
  const normalized = headers.map(normalizeHeader);
  const index = normalized.findIndex(header => aliases.includes(header));
  return index >= 0 ? index : null;
}

function parseBrokerPortfolioCsv(csvText, {
  cash = null,
  asOf = null,
  sourceName = null,
} = {}) {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) throw new Error('Broker portfolio CSV has no position rows.');

  const headers = rows[0];
  const tickerIndex = findHeader(headers, ['ticker', 'symbol']);
  const sharesIndex = findHeader(headers, ['sh', 'shares', 'quantity', 'qty']);
  const marketValueIndex = findHeader(headers, ['mkt value', 'market value', 'current value']);
  const costBasisIndex = findHeader(headers, ['total cost', 'cost basis', 'cost']);

  if (tickerIndex == null || marketValueIndex == null) {
    throw new Error(
      'Broker portfolio CSV requires Ticker (or Symbol) and Mkt Value (or Market Value) columns.'
    );
  }

  const grouped = new Map();
  let sourceRows = 0;
  for (const row of rows.slice(1)) {
    const ticker = String(row[tickerIndex] || '').trim().toUpperCase();
    const marketValue = parseCsvNumber(row[marketValueIndex]);
    if (!ticker || marketValue == null) continue;
    if (marketValue < 0) throw new Error(`${ticker} has a negative market value in the broker CSV.`);
    sourceRows++;

    const current = grouped.get(ticker) || {
      ticker,
      market_value: 0,
      shares: 0,
      cost_basis: 0,
      shares_complete: sharesIndex != null,
      cost_basis_complete: costBasisIndex != null,
      lots: 0,
    };
    const shares = sharesIndex == null ? null : parseCsvNumber(row[sharesIndex]);
    const costBasis = costBasisIndex == null ? null : parseCsvNumber(row[costBasisIndex]);
    current.market_value += marketValue;
    if (sharesIndex != null) {
      if (shares == null) current.shares_complete = false;
      else current.shares += shares;
    }
    if (costBasisIndex != null) {
      if (costBasis == null) current.cost_basis_complete = false;
      else current.cost_basis += costBasis;
    }
    current.lots++;
    grouped.set(ticker, current);
  }

  const positions = [...grouped.values()].map(position => ({
    ticker: position.ticker,
    market_value: Number(position.market_value.toFixed(2)),
    shares: position.shares_complete ? Number(position.shares.toFixed(6)) : undefined,
    cost_basis: position.cost_basis_complete
      ? Number(position.cost_basis.toFixed(2))
      : undefined,
  }));
  if (!positions.length) throw new Error('Broker portfolio CSV contained no usable positions.');

  return {
    as_of: asOf,
    cash,
    positions,
    source: {
      type: 'broker_csv',
      name: sourceName,
      source_rows: sourceRows,
      unique_tickers: positions.length,
      duplicate_tickers: [...grouped.values()]
        .filter(position => position.lots > 1)
        .map(position => ({ ticker: position.ticker, lots: position.lots })),
      incomplete_shares_tickers: [...grouped.values()]
        .filter(position => sharesIndex != null && !position.shares_complete)
        .map(position => position.ticker),
      incomplete_cost_basis_tickers: [...grouped.values()]
        .filter(position => costBasisIndex != null && !position.cost_basis_complete)
        .map(position => position.ticker),
      cash_source: cash == null ? 'not_reported' : 'explicit_override',
    },
  };
}

function loadBrokerPortfolioCsv(path, cash = null) {
  if (!path || !existsSync(path)) {
    throw new Error(`Broker portfolio CSV was not found: ${path}`);
  }
  const csvText = readFileSync(path, 'utf8');
  return parseBrokerPortfolioCsv(csvText, {
    cash,
    asOf: statSync(path).mtime.toISOString(),
    sourceName: path,
  });
}

function pushAlert(alerts, alert) {
  if (!alerts.some(existing => existing.id === alert.id)) alerts.push(alert);
}

function isImmediateExitReview(row) {
  return (
    row?.flags?.some(flag => [
      'EXTREME_INDICATED_YIELD',
      'NAV_EROSION',
      'SHARP_1M_DRAWDOWN',
      'LEVERAGED',
    ].includes(flag)) ||
    (row?.nav_total_return_1m_pct ?? Infinity) <= -12 ||
    (row?.nav_performance_1y_pct ?? Infinity) <= -20
  );
}

function buildConfirmationState(previous, current, olderPrevious = null) {
  const previousPositions = indexByTicker(previous?.portfolio?.positions);
  const olderPositions = indexByTicker(olderPrevious?.portfolio?.positions);
  const currentPositions = indexByTicker(current?.portfolio?.positions);
  const currentRows = indexByTicker(current?.all || current?.top);
  const entries = [];
  const exits = [];

  for (const [ticker, position] of currentPositions) {
    const confirmed = previousPositions.has(ticker);
    entries.push({
      ticker,
      status: confirmed ? 'CONFIRMED' : 'PENDING_SECOND_SCAN',
      consecutive_qualified_scans: confirmed ? 2 : 1,
      funding_eligible: confirmed,
      target_allocation_pct: position.allocation_pct,
    });
  }

  for (const [ticker, priorPosition] of previousPositions) {
    if (currentPositions.has(ticker)) continue;
    const immediate = isImmediateExitReview(currentRows.get(ticker));
    exits.push({
      ticker,
      status: immediate ? 'IMMEDIATE_REVIEW' : 'PENDING_SECOND_SCAN',
      consecutive_absent_scans: 1,
      reduction_eligible: immediate,
      prior_allocation_pct: priorPosition.allocation_pct,
    });
  }
  for (const [ticker, olderPosition] of olderPositions) {
    if (currentPositions.has(ticker) || previousPositions.has(ticker)) continue;
    exits.push({
      ticker,
      status: 'CONFIRMED',
      consecutive_absent_scans: 2,
      reduction_eligible: true,
      prior_allocation_pct: olderPosition.allocation_pct,
    });
  }

  return { entries, exits };
}

function compareSnapshots(previous, current, olderPrevious = null) {
  const alerts = [];
  if (!previous) {
    alerts.push({
      id: 'BASELINE_CREATED',
      severity: 'info',
      category: 'system',
      message: 'No earlier income ETF snapshot was available; this run establishes the comparison baseline.',
    });
  }

  const previousRows = indexByTicker(previous?.all || previous?.top);
  const currentRows = indexByTicker(current.all || current.top);
  const previousPositions = indexByTicker(previous?.portfolio?.positions);
  const currentPositions = indexByTicker(current.portfolio?.positions);

  for (const [ticker, position] of previous ? currentPositions : []) {
    if (!previousPositions.has(ticker)) {
      pushAlert(alerts, {
        id: `MODEL_ENTRY:${ticker}`,
        severity: 'info',
        category: 'qualification',
        ticker,
        message: `${ticker} newly entered the score-driven model portfolio.`,
        current_score: position.score,
        target_allocation_pct: position.allocation_pct,
      });
    }
  }

  for (const [ticker, position] of previous ? previousPositions : []) {
    if (!currentPositions.has(ticker)) {
      const currentRow = currentRows.get(ticker);
      const immediate = isImmediateExitReview(currentRow);
      pushAlert(alerts, {
        id: `${immediate ? 'MODEL_EXIT' : 'MODEL_EXIT_PENDING'}:${ticker}`,
        severity: immediate ? 'critical' : 'warning',
        category: 'qualification',
        ticker,
        message: immediate
          ? `${ticker} left the model portfolio with a critical condition and requires immediate review.`
          : `${ticker} left the model portfolio for one scan; confirm on the next weekly scan before discretionary replacement.`,
        previous_score: position.score,
        current_score: currentRow?.score ?? null,
        current_tier: currentRow?.tier ?? null,
        current_flags: currentRow?.flags || [],
      });
    }
  }
  const olderPositions = indexByTicker(olderPrevious?.portfolio?.positions);
  for (const [ticker, position] of olderPositions) {
    if (previousPositions.has(ticker) || currentPositions.has(ticker)) continue;
    pushAlert(alerts, {
      id: `MODEL_EXIT_CONFIRMED:${ticker}`,
      severity: 'critical',
      category: 'qualification',
      ticker,
      message: `${ticker} has remained outside the model portfolio for two consecutive scans and requires a confirmed exit review.`,
      previous_score: position.score,
    });
  }

  for (const [ticker, row] of previous ? currentRows : []) {
    const prior = previousRows.get(ticker);
    if (!prior) continue;

    const scoreDelta = Number(((row.score ?? 0) - (prior.score ?? 0)).toFixed(1));
    if (Math.abs(scoreDelta) >= 10) {
      pushAlert(alerts, {
        id: `SCORE_MOVE:${ticker}`,
        severity: scoreDelta < 0 ? 'warning' : 'info',
        category: 'score',
        ticker,
        message: `${ticker} score moved ${scoreDelta > 0 ? '+' : ''}${scoreDelta} points.`,
        previous_score: prior.score,
        current_score: row.score,
      });
    }

    const previousYield = prior.indicated_yield_pct;
    const currentYield = row.indicated_yield_pct;
    if (
      Number.isFinite(previousYield) &&
      previousYield > 0 &&
      Number.isFinite(currentYield)
    ) {
      const relativeChange = (currentYield - previousYield) / previousYield * 100;
      if (Math.abs(relativeChange) >= 20 && Math.abs(currentYield - previousYield) >= 2) {
        pushAlert(alerts, {
          id: `INDICATED_YIELD_MOVE:${ticker}`,
          severity: 'warning',
          category: 'distribution',
          ticker,
          message: `${ticker} indicated yield changed materially; confirm the issuer distribution before treating this as a cut or increase.`,
          previous_yield_pct: previousYield,
          current_yield_pct: currentYield,
          relative_change_pct: Number(relativeChange.toFixed(1)),
        });
      }
    }

    if (
      prior.distribution_frequency &&
      row.distribution_frequency &&
      prior.distribution_frequency !== row.distribution_frequency
    ) {
      pushAlert(alerts, {
        id: `FREQUENCY_CHANGE:${ticker}`,
        severity: 'warning',
        category: 'distribution',
        ticker,
        message: `${ticker} distribution frequency changed from ${prior.distribution_frequency} to ${row.distribution_frequency}.`,
      });
    }
  }

  for (const [ticker, row] of currentRows) {
    if ((row.nav_total_return_1m_pct ?? Infinity) <= -12) {
      pushAlert(alerts, {
        id: `SEVERE_DRAWDOWN:${ticker}`,
        severity: 'critical',
        category: 'nav',
        ticker,
        message: `${ticker} has a one-month NAV total return at or below -12%.`,
        nav_total_return_1m_pct: row.nav_total_return_1m_pct,
      });
    } else if ((row.nav_total_return_1m_pct ?? Infinity) <= -10) {
      pushAlert(alerts, {
        id: `DRAWDOWN_WATCH:${ticker}`,
        severity: 'warning',
        category: 'nav',
        ticker,
        message: `${ticker} has a one-month NAV total return at or below -10%.`,
        nav_total_return_1m_pct: row.nav_total_return_1m_pct,
      });
    }
  }

  const previousCash = previous?.portfolio?.cash_pct;
  const currentCash = current.portfolio?.cash_pct;
  if (
    Number.isFinite(previousCash) &&
    Number.isFinite(currentCash) &&
    Math.abs(currentCash - previousCash) >= 5
  ) {
    pushAlert(alerts, {
      id: 'MODEL_CASH_MOVE',
      severity: 'warning',
      category: 'allocation',
      message: `Model cash changed from ${previousCash}% to ${currentCash}%.`,
      previous_cash_pct: previousCash,
      current_cash_pct: currentCash,
    });
  }

  return alerts;
}

function validateActualPortfolio(actualPortfolio) {
  if (!actualPortfolio) return null;
  const cash = actualPortfolio.cash == null ? null : Number(actualPortfolio.cash);
  const suppliedPositions = (actualPortfolio.positions || []).map(position => ({
    ticker: String(position.ticker || '').toUpperCase(),
    market_value: Number(position.market_value),
    shares: position.shares == null ? null : Number(position.shares),
    cost_basis: position.cost_basis == null ? null : Number(position.cost_basis),
  }));
  if (cash != null && (!Number.isFinite(cash) || cash < 0)) {
    throw new Error('actual_portfolio.cash must be a non-negative number.');
  }
  if (suppliedPositions.some(position => !position.ticker || !Number.isFinite(position.market_value) || position.market_value < 0)) {
    throw new Error('Each actual_portfolio position requires ticker and a non-negative market_value.');
  }
  if (suppliedPositions.some(position =>
    (position.shares != null && (!Number.isFinite(position.shares) || position.shares < 0)) ||
    (position.cost_basis != null && (!Number.isFinite(position.cost_basis) || position.cost_basis < 0))
  )) {
    throw new Error('Shares and cost basis must be non-negative numbers when supplied.');
  }
  const grouped = new Map();
  for (const position of suppliedPositions) {
    const current = grouped.get(position.ticker) || {
      ticker: position.ticker,
      market_value: 0,
      shares: 0,
      cost_basis: 0,
      shares_complete: true,
      cost_basis_complete: true,
      rows: 0,
    };
    current.market_value += position.market_value;
    if (position.shares == null || !Number.isFinite(position.shares)) {
      current.shares_complete = false;
    } else {
      current.shares += position.shares;
    }
    if (position.cost_basis == null || !Number.isFinite(position.cost_basis)) {
      current.cost_basis_complete = false;
    } else {
      current.cost_basis += position.cost_basis;
    }
    current.rows++;
    grouped.set(position.ticker, current);
  }
  const positions = [...grouped.values()].map(position => ({
    ticker: position.ticker,
    market_value: position.market_value,
    shares: position.shares_complete ? position.shares : null,
    cost_basis: position.cost_basis_complete ? position.cost_basis : null,
  }));
  const duplicateTickers = [...grouped.values()]
    .filter(position => position.rows > 1)
    .map(position => ({ ticker: position.ticker, rows: position.rows }));
  return {
    as_of: actualPortfolio.as_of || null,
    cash,
    positions,
    source: {
      ...(actualPortfolio.source || { type: 'direct_input' }),
      duplicate_tickers: duplicateTickers,
      incomplete_cost_basis_tickers: [...grouped.values()]
        .filter(position => !position.cost_basis_complete)
        .map(position => position.ticker),
    },
  };
}

function buildRebalanceComparison(modelPortfolio, suppliedPortfolio, {
  allowAdditionalFunding = false,
  taxableAccount = false,
  gradualReconciliation = false,
  rankedRows = [],
  confirmationState = { entries: [], exits: [] },
} = {}) {
  const actualPortfolio = validateActualPortfolio(suppliedPortfolio);
  if (!actualPortfolio) {
    return {
      available: false,
      note: 'No actual portfolio was supplied. Model targets are available, but real drift and rebalance amounts cannot be calculated.',
    };
  }

  const investedValue = actualPortfolio.positions.reduce(
    (sum, position) => sum + position.market_value,
    0
  );
  const totalValue = (actualPortfolio.cash ?? 0) +
    investedValue;
  if (totalValue <= 0) throw new Error('actual_portfolio total value must be greater than zero.');

  const targets = indexByTicker(modelPortfolio.positions);
  const actuals = new Map(actualPortfolio.positions.map(position => [position.ticker, position]));
  const ranked = indexByTicker(rankedRows);
  const entryConfirmation = new Map(
    (confirmationState.entries || []).map(entry => [entry.ticker, entry])
  );
  const exitConfirmation = new Map(
    (confirmationState.exits || []).map(exit => [exit.ticker, exit])
  );
  const tickers = new Set([...targets.keys(), ...actuals.keys()]);
  const rows = [];
  const alerts = [];

  for (const ticker of tickers) {
    const target = targets.get(ticker);
    const actual = actuals.get(ticker);
    const targetPct = target?.allocation_pct || 0;
    const actualValue = actual?.market_value || 0;
    const actualPct = actualValue / totalValue * 100;
    const targetValue = totalValue * targetPct / 100;
    const delta = targetValue - actualValue;
    const costBasis = actual?.cost_basis ?? null;
    const estimatedGainLoss = costBasis == null ? null : actualValue - costBasis;
    const relativeDrift = targetPct > 0
      ? Math.abs(actualPct - targetPct) / targetPct * 100
      : null;
    let action = 'HOLD';
    if (!target && actualValue > 0) action = 'REVIEW_EXIT';
    else if (target && actualValue === 0) action = 'BUY_CANDIDATE';
    else if (relativeDrift >= 20 && Math.abs(actualPct - targetPct) >= 0.5) {
      action = delta > 0 ? 'ADD' : 'TRIM';
    }
    let transitionAction = action;
    let taxNote = null;
    const entryState = entryConfirmation.get(ticker);
    const exitState = exitConfirmation.get(ticker);
    if (
      (action === 'BUY_CANDIDATE' || action === 'ADD') &&
      entryState?.status === 'PENDING_SECOND_SCAN'
    ) {
      transitionAction = 'WAIT_SECOND_SCAN';
      taxNote = 'Do not fund significantly until the candidate qualifies on a second consecutive weekly scan.';
    } else if (
      action === 'REVIEW_EXIT' &&
      exitState?.status === 'PENDING_SECOND_SCAN'
    ) {
      transitionAction = 'MONITOR_SECOND_SCAN';
      taxNote = 'Do not make a discretionary replacement until absence is confirmed on the next weekly scan.';
    } else if (taxableAccount && gradualReconciliation) {
      if (
        (action === 'REVIEW_EXIT' || action === 'TRIM') &&
        estimatedGainLoss == null
      ) {
        transitionAction = 'TAX_LOT_DATA_REQUIRED';
        taxNote = 'Cost basis is missing or incomplete; obtain broker tax-lot data before classifying this reduction.';
      } else if (action === 'REVIEW_EXIT' && estimatedGainLoss < 0) {
        transitionAction = 'HARVEST_LOSS_REVIEW';
        taxNote = 'Review specific lots and wash-sale exposure before a staged reduction.';
      } else if (action === 'TRIM' && estimatedGainLoss < 0) {
        transitionAction = 'LOSS_AWARE_TRIM';
        taxNote = 'Use specific-lot identification when available and check wash-sale exposure.';
      } else if (action === 'REVIEW_EXIT' && estimatedGainLoss >= 0) {
        transitionAction = 'DEFER_OR_OFFSET_GAIN';
        taxNote = 'Prefer long-term lots or pair realized gain with harvested losses, subject to tax review.';
      } else if (action === 'BUY_CANDIDATE' || action === 'ADD') {
        taxNote = 'Fund gradually from staged reductions or new capital; avoid substantially identical replacement purchases around loss sales.';
      }
    }

    rows.push({
      ticker,
      action,
      transition_action: transitionAction,
      tax_note: taxNote,
      model_score: target?.score ?? null,
      target_pct: Number(targetPct.toFixed(2)),
      actual_pct: Number(actualPct.toFixed(2)),
      drift_pct_points: Number((actualPct - targetPct).toFixed(2)),
      actual_value: Number(actualValue.toFixed(2)),
      cost_basis: costBasis == null ? null : Number(costBasis.toFixed(2)),
      estimated_unrealized_gain_loss: estimatedGainLoss == null
        ? null
        : Number(estimatedGainLoss.toFixed(2)),
      target_value: Number(targetValue.toFixed(2)),
      suggested_value_change: Number(delta.toFixed(2)),
      confirmation_status: entryState?.status || exitState?.status || null,
    });

    if (action === 'REVIEW_EXIT') {
      const pendingExit = exitState?.status === 'PENDING_SECOND_SCAN';
      alerts.push({
        id: `ACTUAL_NOT_QUALIFIED:${ticker}`,
        severity: pendingExit ? 'warning' : 'critical',
        category: 'actual_portfolio',
        ticker,
        message: pendingExit
          ? `${ticker} is held but has been absent from the model target for only one scan; monitor for confirmation.`
          : `${ticker} is held in the supplied portfolio but is absent from the confirmed current model target.`,
      });
    } else if (action === 'ADD' || action === 'TRIM') {
      alerts.push({
        id: `POSITION_DRIFT:${ticker}`,
        severity: 'warning',
        category: 'actual_portfolio',
        ticker,
        message: `${ticker} actual weight differs materially from its model target.`,
        action,
        target_pct: Number(targetPct.toFixed(2)),
        actual_pct: Number(actualPct.toFixed(2)),
      });
    }
    const applicablePositionCap = target?.position_cap_pct ??
      modelPortfolio.maximum_position_pct;
    if (actualPct > applicablePositionCap) {
      alerts.push({
        id: `POSITION_CAP_BREACH:${ticker}`,
        severity: 'warning',
        category: 'actual_portfolio',
        ticker,
        message: `${ticker} exceeds its ${applicablePositionCap}% model position cap.`,
        actual_pct: Number(actualPct.toFixed(2)),
        position_cap_pct: applicablePositionCap,
      });
    }
  }

  rows.sort((a, b) => {
    const priority = { REVIEW_EXIT: 0, TRIM: 1, ADD: 2, BUY_CANDIDATE: 3, HOLD: 4 };
    return priority[a.action] - priority[b.action] ||
      Math.abs(b.suggested_value_change) - Math.abs(a.suggested_value_change);
  });

  const grossSuggestedBuys = rows.reduce(
    (sum, row) => sum + Math.max(0, row.suggested_value_change),
    0
  );
  const grossSuggestedSales = rows.reduce(
    (sum, row) => sum + Math.max(0, -row.suggested_value_change),
    0
  );
  const knownCash = actualPortfolio.cash ?? 0;
  const externalFundingIfNoCash = Math.max(
    0,
    grossSuggestedBuys - grossSuggestedSales - knownCash
  );
  const estimatedExternalFundingRequired = actualPortfolio.cash == null
    ? null
    : externalFundingIfNoCash;
  let actualAnnualDistribution = 0;
  const missingYieldTickers = [];
  for (const position of actualPortfolio.positions) {
    const indicatedYield = ranked.get(position.ticker)?.indicated_yield_pct;
    if (!Number.isFinite(indicatedYield)) {
      missingYieldTickers.push(position.ticker);
      continue;
    }
    actualAnnualDistribution += position.market_value * indicatedYield / 100;
  }
  const targetAnnualDistributionAtActualValue = totalValue *
    (modelPortfolio.weighted_indicated_yield_on_total_portfolio_pct || 0) / 100;

  return {
    available: true,
    as_of: actualPortfolio.as_of,
    source: actualPortfolio.source,
    total_value: Number(totalValue.toFixed(2)),
    invested_value: Number(investedValue.toFixed(2)),
    actual_cash: actualPortfolio.cash == null
      ? null
      : Number(actualPortfolio.cash.toFixed(2)),
    actual_cash_pct: actualPortfolio.cash == null
      ? null
      : Number((actualPortfolio.cash / totalValue * 100).toFixed(2)),
    cash_status: actualPortfolio.cash == null ? 'not_reported' : 'reported',
    target_cash_pct: modelPortfolio.cash_pct,
    allow_additional_funding: allowAdditionalFunding,
    taxable_account: taxableAccount,
    gradual_reconciliation: gradualReconciliation,
    transition_policy: taxableAccount && gradualReconciliation
      ? 'Stage reductions by tax lot. Loss candidates are reviewed first; gain positions are deferred, offset, or trimmed over time. REVIEW_EXIT is not an instruction to liquidate immediately.'
      : 'Model drift comparison only. Confirm tax impact before acting.',
    tax_data_limitations: taxableAccount
      ? [
          'CSV cost basis is aggregated by ticker.',
          ...(actualPortfolio.source?.incomplete_cost_basis_tickers?.length
            ? [`Cost basis is missing or incomplete for: ${actualPortfolio.source.incomplete_cost_basis_tickers.join(', ')}.`]
            : []),
          'Acquisition dates and short-term versus long-term holding periods are unavailable.',
          'Adjusted basis and wash-sale history must be confirmed with broker tax-lot records.',
        ]
      : [],
    gross_suggested_buys: Number(grossSuggestedBuys.toFixed(2)),
    gross_suggested_sales: Number(grossSuggestedSales.toFixed(2)),
    estimated_external_funding_required: estimatedExternalFundingRequired == null
      ? null
      : Number(estimatedExternalFundingRequired.toFixed(2)),
    external_funding_if_no_cash_available: Number(
      externalFundingIfNoCash.toFixed(2)
    ),
    funding_estimate_status: actualPortfolio.cash == null
      ? 'cash_unknown'
      : 'cash_reported',
    actual_income_estimate: {
      coverage_count: actualPortfolio.positions.length - missingYieldTickers.length,
      position_count: actualPortfolio.positions.length,
      missing_yield_tickers: missingYieldTickers,
      projected_annual_distribution: Number(actualAnnualDistribution.toFixed(2)),
      projected_average_monthly_distribution: Number(
        (actualAnnualDistribution / 12).toFixed(2)
      ),
      target_projected_annual_distribution_at_actual_value: Number(
        targetAnnualDistributionAtActualValue.toFixed(2)
      ),
      target_projected_average_monthly_distribution_at_actual_value: Number(
        (targetAnnualDistributionAtActualValue / 12).toFixed(2)
      ),
      warning: 'Uses TradingView indicated yield for covered tickers. It is not guaranteed income, SEC yield, or total return.',
    },
    buying_power_policy: allowAdditionalFunding
      ? 'Flexible external funding or margin. Buy recommendations are not capped by reported cash.'
      : 'Confirm available cash or buying power before acting on buy recommendations.',
    rows,
    alerts,
    execution_policy: 'Recommendations only. No orders are created or submitted.',
  };
}

function alertSummary(alerts) {
  const counts = alerts.reduce((result, alert) => {
    result[alert.severity] = (result[alert.severity] || 0) + 1;
    return result;
  }, { critical: 0, warning: 0, info: 0 });
  return {
    counts,
    highest_severity: counts.critical ? 'critical' : counts.warning ? 'warning' : 'info',
    should_notify: counts.critical > 0 || counts.warning > 0,
  };
}

export const incomeEtfMonitorTestHelpers = {
  previousSnapshotPath,
  previousSnapshotPaths,
  parseBrokerPortfolioCsv,
  compareSnapshots,
  buildConfirmationState,
  buildRebalanceComparison,
  alertSummary,
};

export async function monitorIncomeEtfs({
  actual_portfolio,
  actual_portfolio_csv_path,
  actual_portfolio_cash,
  allow_additional_funding = false,
  taxable_account = false,
  gradual_reconciliation = false,
  ...scanOptions
} = {}) {
  if (actual_portfolio && actual_portfolio_csv_path) {
    throw new Error('Provide actual_portfolio or actual_portfolio_csv_path, not both.');
  }
  const scan = await scanIncomeEtfs(scanOptions);
  let resolvedActualPortfolio = null;
  let portfolioInputError = null;
  try {
    resolvedActualPortfolio = actual_portfolio_csv_path
      ? loadBrokerPortfolioCsv(actual_portfolio_csv_path, actual_portfolio_cash)
      : actual_portfolio;
  } catch (error) {
    portfolioInputError = error.message;
  }
  const priorPaths = previousSnapshotPaths(scan.saved_to) || [];
  const priorPath = priorPaths[0] || null;
  const olderPriorPath = priorPaths[1] || null;
  const previous = loadSnapshot(priorPath);
  const olderPrevious = loadSnapshot(olderPriorPath);
  const currentRaw = loadSnapshot(scan.saved_to) || { ...scan, all: scan.all || scan.top };
  const scanAlerts = compareSnapshots(previous, currentRaw, olderPrevious);
  const confirmation = buildConfirmationState(previous, currentRaw, olderPrevious);
  const rebalance = buildRebalanceComparison(scan.portfolio, resolvedActualPortfolio, {
    allowAdditionalFunding: allow_additional_funding,
    taxableAccount: taxable_account,
    gradualReconciliation: gradual_reconciliation,
    rankedRows: currentRaw.all || currentRaw.top,
    confirmationState: confirmation,
  });
  if (portfolioInputError) {
    rebalance.input_error = portfolioInputError;
    rebalance.note = 'The TradingView scan completed, but the external holdings comparison was rejected.';
  }
  const portfolioErrorAlert = portfolioInputError
    ? {
        id: 'PORTFOLIO_INPUT_ERROR',
        severity: 'warning',
        category: 'system',
        message: `The market scan completed, but the external portfolio could not be processed: ${portfolioInputError}`,
      }
    : null;
  const persistentAlerts = [
    ...scanAlerts,
    ...(portfolioErrorAlert ? [portfolioErrorAlert] : []),
  ];
  const alerts = [...persistentAlerts, ...(rebalance.alerts || [])];
  const notification = alertSummary(alerts);

  const result = {
    success: true,
    generated_at: new Date().toISOString(),
    comparison: {
      previous_snapshot: priorPath,
      older_previous_snapshot: olderPriorPath,
      current_snapshot: scan.saved_to,
    },
    notification,
    alerts,
    confirmation,
    rebalance,
    scan,
    instruction: [
      scan.instruction,
      `Insert a "## Change Alerts" section immediately after the Executive Snapshot. Use every item in alerts, grouped by critical, warning, and info. State the comparison snapshot date.`,
      rebalance.available
        ? gradual_reconciliation && taxable_account
          ? `Include a "## Tax-Aware Gradual Reconciliation" section. Use transition_action rather than treating REVIEW_EXIT as immediate liquidation. Stage loss-lot reviews first, defer or offset gain realization, identify wash-sale/DRIP checks, and state that acquisition dates and adjusted lot-level basis are missing. Include a table using rebalance.rows with Symbol | Transition Action | Target % | Actual % | Est. Gain/Loss | Suggested Full-Target Change. Do not invent phase assignments, totals, or tax calculations that are absent from the structured result. These are recommendations only; never claim that orders were placed or exact taxes were calculated.`
          : `Include a "## Rebalance Recommendations" table using rebalance.rows with Symbol | Action | Target % | Actual % | Drift | Suggested Value Change. These are recommendations only; never claim that orders were placed.`
        : `Include a one-sentence note that no actual portfolio was supplied, so the report contains model targets rather than real rebalance amounts.`,
      `Use confirmation.entries and confirmation.exits to identify pending versus confirmed changes. Do not recommend significant funding for PENDING_SECOND_SCAN entries or discretionary replacement for PENDING_SECOND_SCAN exits.`,
      rebalance.available
        ? `Use rebalance.actual_income_estimate for actual-versus-target indicated-income figures. Do not recalculate these values in the renderer. When cash is unknown, show estimated_external_funding_required as unknown and label external_funding_if_no_cash_available as a no-cash assumption.`
        : '',
      `In the final user notification, lead with critical and warning alerts. If notification.should_notify is false, report only that the scheduled scan completed with no actionable changes.`,
    ].join(' '),
  };

  const reportDir = incomeEtfWeekDirFor();
  mkdirSync(reportDir, { recursive: true });
  const alertPath = join(reportDir, 'income_etf-alerts.json');
  const persisted = {
    success: result.success,
    generated_at: result.generated_at,
    comparison: result.comparison,
    notification: alertSummary(persistentAlerts),
    alerts: persistentAlerts,
    confirmation: result.confirmation,
    rebalance_available: result.rebalance.available,
    portfolio_input_error: portfolioInputError,
    actual_portfolio_alert_summary: alertSummary(result.rebalance.alerts || []),
    note: 'Actual holdings, values, weights, and holdings-derived alert details are not persisted in this alert artifact.',
  };
  writeFileSync(alertPath, JSON.stringify(persisted, null, 2), 'utf8');
  result.alerts_saved_to = alertPath;

  return result;
}
