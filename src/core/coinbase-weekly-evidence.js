import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

// Phase 1 is intentionally evidence-only. Nothing in this module is imported by scoring.
export const COINBASE_WEEKLY_SCHEMA_VERSION = 1;
export const SECTION_NAMES = ['Market View', 'Trade Scenarios', 'Flows', 'Derivatives', 'Financing Rates', 'Week Ahead'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
function decodeTransferEncoding(value) { return String(value).replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))); }
const field = (value, source_location, extraction_mode = 'deterministic') => ({ value, as_reported: value, source_location, availability: value == null ? 'missing' : 'present', extraction_mode, confidence: extraction_mode === 'deterministic' ? 'high' : 'unknown' });

function locate(text, needle) { const i = text.indexOf(needle); return i < 0 ? null : { offset: i, excerpt: text.slice(Math.max(0, i - 80), i + needle.length + 120) }; }
function reportDate(text, headers = {}) {
  const candidates = [text.match(/(?:week of|week ending|report date|date)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i)?.[1], text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1], headers.date ? new Date(headers.date).toISOString().slice(0, 10) : null];
  return candidates.find(Boolean) ?? null;
}
function sectionRanges(text) {
  const found = SECTION_NAMES.map(name => ({ name, at: text.search(new RegExp(`^\\s*${name === 'Week Ahead' ? '(?:The )?' : ''}${name}\\s*$`, 'im')) })).filter(x => x.at >= 0).sort((a, b) => a.at - b.at);
  return Object.fromEntries(found.map((x, i) => [x.name, text.slice(x.at, found[i + 1]?.at ?? text.length)]));
}
function zones(block, kind) {
  const re = new RegExp(`${kind}(?:\\s+zones?)?\\s*:?\\s*([^\\n]+)`, 'ig'); const out = []; let m;
  while ((m = re.exec(block))) for (const z of m[1].split(',').map(clean).map(v => v.match(/\$?([\d,.]+)\s*(?:-|–|to)\s*\$?([\d,.]+)\s*[KkMm]?|\$?([\d,.]+)\s*[KkMm]?/)).filter(Boolean)) {
    const asReported = clean(z[0]); const nums = [z[1] ?? z[3], z[2] ?? z[3]].map(v => Number(v.replace(/,/g, '')));
    out.push({ low: nums[0], high: nums[1], unit: 'USD', as_reported: asReported, ordering: out.length + 1, source_location: locate(block, asReported) });
  }
  return out;
}
function assetScenario(block) {
  return [...block.matchAll(/(?:if|when|hold|reject|lose|break|above|below)[^\n.]{5,160}(?:[.]|(?=\s*Ã¢Â€Â¢|\s*$))/gi)].map(m => ({ condition_text: clean(m[0]), trigger_zone: null, implication_text: null, implication_as_reported: clean(m[0]), source_location: locate(block, m[0]) }));
}
function numericEvidence(block, labels) { const result = {}; for (const label of labels) { const m = block.match(new RegExp(`${label}[^\\n]*?([+-]?[\\d,.]+)\\s*(%|USD|M|B)?`, 'i')); result[label] = m ? field(`${m[1]}${m[2] ?? ''}`, locate(block, m[0])) : field(null, null); } return result; }

export function parseCoinbaseWeeklyEmail(raw, { source_locator = null, extraction_run_id = randomUUID(), parser_version = 'coinbase-weekly-v1' } = {}) {
  const sourceHash = sha256(raw); const headerText = raw.split(/\r?\n\r?\n/, 1)[0];
  const getHeader = name => headerText.match(new RegExp(`^${name}:\\s*(.+)$`, 'im'))?.[1]?.trim() ?? null;
  const subject = getHeader('Subject'); const sender = getHeader('From'); const messageId = getHeader('Message-ID'); const received = getHeader('Date');
  const text = decodeTransferEncoding(raw).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'); const date = reportDate(text, { date: received }); if (!date) throw new Error('Coinbase Weekly report_date not found');
  const sections = sectionRanges(text); const missing = SECTION_NAMES.filter(name => !sections[name]);
  const trade = sections['Trade Scenarios'] ?? ''; const btc = trade.match(/BTC[\s\S]*?(?=ETH|$)/i)?.[0] ?? ''; const eth = trade.match(/ETH[\s\S]*/i)?.[0] ?? '';
  const issue_id = `coinbase_weekly:${date}:${sha256(`${subject ?? ''}|${messageId ?? ''}|${sender ?? ''}`).slice(0, 16)}`;
  const chartOnly = [...text.matchAll(/(?:chart|graph|below)[^\n]{0,100}/gi)].map(m => ({ as_reported: clean(m[0]), source_location: locate(text, m[0]), extraction_mode: 'chart_reference', availability: 'present' }));
  return { provider: 'coinbase_weekly', schema_version: COINBASE_WEEKLY_SCHEMA_VERSION, issue_id, subject, sender, message_id: messageId, received_at: received, report_date: date,
    source: { source_type: 'email', sender, subject, message_id: messageId, received_at: received, report_date: date, source_locator, raw_content_preserved: true, content_sha256: sourceHash, attachments: [], extraction_run_id, extracted_at: new Date().toISOString(), parser_or_review_version: parser_version },
    status: { completeness: missing.length ? 'partial' : 'complete', missing_sections: missing, uncertainty_notes: chartOnly.length ? ['Chart/image-only values were not numerically inferred.'] : [], human_review_required: chartOnly.length > 0 },
    operational_evidence: { market_view: { summary_text: clean(sections['Market View'] ?? '') || null, source_location: locate(text, 'Market View') }, trade_scenarios: { btc: { support_zones: zones(btc, 'support'), resistance_zones: zones(btc, 'resistance'), conditional_scenarios: assetScenario(btc) }, eth: { support_zones: zones(eth, 'support'), resistance_zones: zones(eth, 'resistance'), conditional_scenarios: assetScenario(eth) } }, flows: { source_text: clean(sections.Flows ?? '') || null, numeric_observations: numericEvidence(sections.Flows ?? '', ['ETF', 'AUM', 'stablecoin']) }, derivatives: { source_text: clean(sections.Derivatives ?? '') || null, btc: numericEvidence(sections.Derivatives ?? '', ['DVOL', 'VRP', 'skew']) }, perpetuals: { source_text: clean(`${sections.Derivatives ?? ''}\n${sections['Financing Rates'] ?? ''}`) || null, btc: numericEvidence(`${sections.Derivatives ?? ''}\n${sections['Financing Rates'] ?? ''}`, ['funding', 'OI']) }, financing_rates: { narrative_text: clean(sections['Financing Rates'] ?? '') || null }, week_ahead: { narrative_text: clean(sections['Week Ahead'] ?? '') || null }, chart_image_evidence: chartOnly },
    research_intelligence: { title: clean((text.match(/(?:Research Intelligence|Lessons from building[^\n]*)/i) ?? [])[0]) || null, summary_text: null, topics: [], assets_protocols: [], hypotheses: [], systematic_ideas: [], reported_methodology: null, reported_results: null, candidates_for_testing: [], operational_decision_effect: 'prohibited' },
    history: { previous_issue_id: null, previous_issue_date: null, week_over_week_changes: [] } };
}

function atomic(path, value) { const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, path); }
export function ingestCoinbaseWeeklyFile(path, { evidenceRoot, source_locator = path } = {}) { const raw = readFileSync(path, 'utf8'); return ingestCoinbaseWeeklyRaw(raw, { evidenceRoot, source_locator }); }
export function ingestCoinbaseWeeklyRaw(raw, { evidenceRoot, source_locator = null } = {}) {
  if (!evidenceRoot) throw new Error('evidenceRoot is required'); const issue = parseCoinbaseWeeklyEmail(raw, { source_locator }); const dir = join(evidenceRoot, 'issues'); mkdirSync(dir, { recursive: true }); const target = join(dir, `${issue.report_date}.json`);
  if (existsSync(target)) { const old = JSON.parse(readFileSync(target)); if (old.source?.content_sha256 !== issue.source.content_sha256) throw new Error(`CONFLICTING_SOURCE_HASH:${issue.report_date}`); return { issue, status: 'duplicate', path: target }; }
  const prior = readdirSync(dir).filter(f => f.endsWith('.json')).sort().at(-1); if (prior) { const p = JSON.parse(readFileSync(join(dir, prior))); issue.history.previous_issue_id = p.issue_id; issue.history.previous_issue_date = p.report_date; }
  atomic(target, issue); rebuildCoinbaseWeeklyViews(evidenceRoot); return { issue, status: 'created', path: target };
}
export function rebuildCoinbaseWeeklyViews(evidenceRoot) { const dir = join(evidenceRoot, 'issues'); const issues = readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => JSON.parse(readFileSync(join(dir, f)))); const latest = issues.at(-1) ?? null; atomic(join(evidenceRoot, 'latest.json'), latest ? { provider: latest.provider, schema_version: latest.schema_version, report_date: latest.report_date, freshness: { report_date: latest.report_date, source_received_at: latest.received_at }, completeness: latest.status, market_view: latest.operational_evidence.market_view, trade_scenarios: latest.operational_evidence.trade_scenarios, flows: latest.operational_evidence.flows, derivatives: latest.operational_evidence.derivatives, perpetuals: latest.operational_evidence.perpetuals, financing_rates: latest.operational_evidence.financing_rates, week_ahead: latest.operational_evidence.week_ahead, research_intelligence_reference: latest.research_intelligence.title ? { title: latest.research_intelligence.title } : null } : { provider: 'coinbase_weekly', issues: 0 }); const transitions = issues.slice(1).map((current, i) => ({ from_report_date: issues[i].report_date, to_report_date: current.report_date, changes: { support_resistance: 'UNKNOWN', etf_flows: 'NOT_COMPARABLE', stablecoin_liquidity: 'NOT_COMPARABLE', funding_oi_dvol_vrp_skew: 'NOT_COMPARABLE', positioning_interpretation: 'UNKNOWN' } })); atomic(join(evidenceRoot, 'transitions.json'), { provider: 'coinbase_weekly', schema_version: 1, transitions }); return { issues, latest, transitions }; }
export const coinbaseWeeklyTestHelpers = { sectionRanges, zones, reportDate };
