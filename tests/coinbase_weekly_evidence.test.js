import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ingestCoinbaseWeeklyRaw, parseCoinbaseWeeklyEmail, rebuildCoinbaseWeeklyViews, reparseCoinbaseWeeklyFiles } from '../src/core/coinbase-weekly-evidence.js';

const email = (date = '2026-07-17', extra = '') => `From: Coinbase Institutional <weekly@example.com>\nSubject: Coinbase Weekly - ${date}\nMessage-ID: <${date}@example.com>\nDate: Fri, 17 Jul 2026 12:00:00 +0000\n\nReport date: ${date}\nMarket View\nRates and liquidity context.\nTrade Scenarios\nBTC support $58-59K; resistance $62-63K. If BTC holds above $59K, upside follows.\nETH support $2,900-$3,000; resistance $3,400.\nFlows\nETF net flows +$120M trailing 7-day sum. Stablecoin supply +2%.\nDerivatives\nDVOL 55%, VRP 3.2, skew -4.\nFinancing Rates\nFunding +7.4% annualized; OI 12B.\nWeek Ahead\nCPI on 2026-07-22.\nResearch Intelligence\nState of DeFi thematic feature.\n${extra}`;
test('parses identity, sections, zones, scenario and explicit numeric evidence', () => { const x = parseCoinbaseWeeklyEmail(email()); assert.equal(x.report_date, '2026-07-17'); assert.equal(x.message_id, '<2026-07-17@example.com>'); assert.equal(x.status.completeness, 'complete'); assert.equal(x.operational_evidence.trade_scenarios.btc.support_zones[0].as_reported, '$58-59K'); assert.equal(x.operational_evidence.derivatives.btc.DVOL.value, '55%'); assert.equal(x.operational_evidence.perpetuals.btc.funding.value, '+7.4%'); assert.ok(x.operational_evidence.trade_scenarios.btc.conditional_scenarios.length); assert.equal(x.research_intelligence.operational_decision_effect, 'prohibited'); });
test('history is immutable, idempotent, links chronologically, and rebuilds views', () => { const root = join(tmpdir(), `coinbase-weekly-${Date.now()}`); mkdirSync(root, { recursive: true }); const one = ingestCoinbaseWeeklyRaw(email(), { evidenceRoot: root }); assert.equal(one.status, 'created'); assert.equal(ingestCoinbaseWeeklyRaw(email(), { evidenceRoot: root }).status, 'duplicate'); const two = ingestCoinbaseWeeklyRaw(email('2026-07-24'), { evidenceRoot: root }); assert.equal(two.issue.history.previous_issue_date, '2026-07-17'); const views = rebuildCoinbaseWeeklyViews(root); assert.equal(views.issues.length, 2); assert.equal(JSON.parse(readFileSync(join(root, 'latest.json'))).report_date, '2026-07-24'); assert.equal(JSON.parse(readFileSync(join(root, 'transitions.json'))).transitions[0].changes.etf_flows, 'NOT_COMPARABLE'); assert.throws(() => ingestCoinbaseWeeklyRaw(email('2026-07-24', 'changed'), { evidenceRoot: root }), /CONFLICTING_SOURCE_HASH/); rmSync(root, { recursive: true, force: true }); });
test('chart-only hints require review and no numeric inference', () => { const x = parseCoinbaseWeeklyEmail(email('2026-07-31', 'See chart below for gamma exposure.')); assert.equal(x.status.human_review_required, true); assert.equal(x.operational_evidence.chart_image_evidence.length > 0, true); });
test('completeness requires only recurring sections and records conditional absences', () => {
  const noConditionals = email('2026-08-14').replace('Derivatives\nDVOL 55%, VRP 3.2, skew -4.\nFinancing Rates\nFunding +7.4% annualized; OI 12B.\n', '');
  const x = parseCoinbaseWeeklyEmail(noConditionals);
  assert.equal(x.status.completeness, 'complete');
  assert.deepEqual(x.status.missing_sections, []);
  assert.equal(x.status.section_availability.Derivatives.availability, 'missing');
  assert.equal(x.status.section_availability['Financing Rates'].conditional, true);
  assert.equal(x.operational_evidence.flows.numeric_observations.ETF.value, null);
  for (const name of ['Market View', 'Trade Scenarios', 'Flows', 'Week Ahead']) {
    assert.equal(parseCoinbaseWeeklyEmail(email('2026-08-14').replace(`${name}\n`, '')).status.completeness, 'partial');
  }
});
test('optional ETF AUM absence and freshness remain non-blocking', () => {
  const x = parseCoinbaseWeeklyEmail(email('2026-08-14'));
  assert.equal(x.status.completeness, 'complete');
  assert.equal(x.operational_evidence.flows.numeric_observations.ETF.value, null);
  const root = join(tmpdir(), `coinbase-reparse-${Date.now()}`); mkdirSync(root, { recursive: true });
  const path = join(root, 'weekly.eml'); writeFileSync(path, email('2026-08-14'));
  const result = reparseCoinbaseWeeklyFiles([path], { evidenceRoot: root });
  const first = JSON.parse(readFileSync(join(root, 'issues', '2026-08-14.json')));
  const secondResult = reparseCoinbaseWeeklyFiles([path], { evidenceRoot: root });
  const issue = JSON.parse(readFileSync(join(root, 'issues', '2026-08-14.json')));
  const latest = JSON.parse(readFileSync(join(root, 'latest.json')));
  assert.equal(result[0].status, 'created'); assert.equal(secondResult[0].status, 'reparsed'); assert.equal(latest.freshness.source_received_at, issue.source.received_at);
  assert.equal(issue.issue_id, first.issue_id); assert.equal(issue.source.content_sha256, first.source.content_sha256);
  rmSync(root, { recursive: true, force: true });
});
