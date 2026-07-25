import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import {
  INCOME_ETF_REPORTS_DIR,
  incomeEtfMonthlyReviewDirFor,
  reportDateFromInput,
} from './report_paths.js';

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function tickerOf(row) {
  return row?.ticker || row?.symbol?.split(':').pop() || row?.symbol;
}

function isInReviewMonth(snapshot, reviewDate) {
  const generated = new Date(snapshot?.generated_at);
  return (
    !Number.isNaN(generated.getTime()) &&
    generated.getFullYear() === reviewDate.getFullYear() &&
    generated.getMonth() === reviewDate.getMonth()
  );
}

function monthlySnapshots(reviewDate, reportsDir = INCOME_ETF_REPORTS_DIR) {
  if (!existsSync(reportsDir)) return [];
  const snapshots = [];
  for (const entry of readdirSync(reportsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-Wk\d{2}$/.test(entry.name)) continue;
    const path = join(reportsDir, entry.name, 'scan-income_etf.json');
    if (!existsSync(path)) continue;
    const snapshot = loadJson(path);
    if (!snapshot || !isInReviewMonth(snapshot, reviewDate)) continue;
    snapshots.push({ week: entry.name, path, snapshot });
  }
  return snapshots.sort(
    (a, b) => Date.parse(a.snapshot.generated_at) - Date.parse(b.snapshot.generated_at)
  );
}

function maximumConsecutiveQualification(ticker, snapshots) {
  let current = 0;
  let maximum = 0;
  for (const item of snapshots) {
    const qualified = (item.snapshot.portfolio?.positions || [])
      .some(position => tickerOf(position) === ticker);
    current = qualified ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export function buildMonthlyReview({
  date,
  reportsDir = INCOME_ETF_REPORTS_DIR,
} = {}) {
  const reviewDate = reportDateFromInput(date);
  const snapshots = monthlySnapshots(reviewDate, reportsDir);
  if (!snapshots.length) {
    throw new Error('No completed income ETF weekly snapshots were found for the review month.');
  }

  const tickerStats = new Map();
  for (const item of snapshots) {
    const qualified = new Set(
      (item.snapshot.portfolio?.positions || []).map(tickerOf).filter(Boolean)
    );
    for (const row of item.snapshot.all || item.snapshot.top || []) {
      const ticker = tickerOf(row);
      if (!ticker) continue;
      const current = tickerStats.get(ticker) || {
        ticker,
        appearances: 0,
        qualified_scans: 0,
        scores: [],
      };
      current.appearances++;
      if (qualified.has(ticker)) current.qualified_scans++;
      if (Number.isFinite(row.score)) current.scores.push(row.score);
      current.latest_score = row.score ?? null;
      current.latest_tier = row.tier ?? null;
      current.latest_nav_total_return_1m_pct = row.nav_total_return_1m_pct ?? null;
      current.latest_indicated_yield_pct = row.indicated_yield_pct ?? null;
      tickerStats.set(ticker, current);
    }
  }

  const firstPositions = new Set(
    (snapshots[0].snapshot.portfolio?.positions || []).map(tickerOf).filter(Boolean)
  );
  const latestSnapshot = snapshots.at(-1).snapshot;
  const latestPositions = new Set(
    (latestSnapshot.portfolio?.positions || []).map(tickerOf).filter(Boolean)
  );
  const tickerSummary = [...tickerStats.values()].map(item => ({
    ...item,
    average_score: item.scores.length
      ? Number((item.scores.reduce((sum, value) => sum + value, 0) / item.scores.length).toFixed(1))
      : null,
    maximum_consecutive_qualified_scans: maximumConsecutiveQualification(
      item.ticker,
      snapshots
    ),
    scores: undefined,
  }));

  const result = {
    success: true,
    generated_at: new Date().toISOString(),
    review_month: `${reviewDate.getFullYear()}-${String(reviewDate.getMonth() + 1).padStart(2, '0')}`,
    score_version: latestSnapshot.methodology?.score_version ?? 1,
    weekly_snapshots: snapshots.map(item => ({
      week: item.week,
      generated_at: item.snapshot.generated_at,
      path: item.path,
      universe_size: item.snapshot.universe_size,
      qualified_count: item.snapshot.portfolio?.qualified_count ?? 0,
      invested_pct: item.snapshot.portfolio?.invested_pct ?? 0,
      cash_pct: item.snapshot.portfolio?.cash_pct ?? 100,
    })),
    latest_portfolio: latestSnapshot.portfolio,
    persistent_qualified: tickerSummary
      .filter(item => item.maximum_consecutive_qualified_scans >= 2)
      .sort((a, b) => (b.latest_score || 0) - (a.latest_score || 0)),
    pending_confirmation: tickerSummary
      .filter(item => item.maximum_consecutive_qualified_scans === 1)
      .sort((a, b) => (b.latest_score || 0) - (a.latest_score || 0)),
    entered_since_first_scan: [...latestPositions].filter(ticker => !firstPositions.has(ticker)),
    exited_since_first_scan: [...firstPositions].filter(ticker => !latestPositions.has(ticker)),
    ticker_summary: tickerSummary.sort(
      (a, b) => (b.latest_score || 0) - (a.latest_score || 0)
    ),
    instruction: [
      `Write a Markdown monthly governance review from this structured result.`,
      `Begin with "## Monthly Decision".`,
      `Include the weekly snapshot table, persistent qualifications, pending confirmations, entries and exits, latest portfolio and cash target, NAV-versus-income observations, and items requiring issuer or tax-lot review.`,
      `Do not recalculate scores, allocations, income, or persistence counts.`,
      `Do not describe a one-scan candidate as confirmed.`,
      `After rendering, call session_save with instrument_type="income_etf_monthly_review" and the same review-month date.`,
    ].join(' '),
  };

  const reportDir = reportsDir === INCOME_ETF_REPORTS_DIR
    ? incomeEtfMonthlyReviewDirFor(reviewDate)
    : join(
        reportsDir,
        'Mon-review',
        basename(incomeEtfMonthlyReviewDirFor(reviewDate))
      );
  mkdirSync(reportDir, { recursive: true });
  const path = join(reportDir, 'monthly-review.json');
  writeFileSync(path, JSON.stringify(result, null, 2), 'utf8');
  result.saved_to = path;
  return result;
}

export const incomeEtfMonthlyReviewTestHelpers = {
  monthlySnapshots,
  maximumConsecutiveQualification,
};
