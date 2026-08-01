#!/usr/bin/env node
/**
 * Renders one weekly-decision-routine HTML email + {type}-signals.json from
 * a decision-classify.mjs output file. Implements the STEP 5 / STEP 5B
 * templates from the weekly-decision-routine SKILL.md — standard layout for
 * momentum_stocks/momentum_etf/sp_ndx/r2k/momentum_ark (ARK adds the
 * correlation-cluster column/check), plus dedicated layouts for
 * thematic_stocks (per-theme breakdown) and thematic_etfs (rotation table).
 *
 * Usage:
 *   node decision-render.mjs <type> <classFile> <htmlOut> <signalsOut> <dateStr> <scanDate>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , TYPE, CLASS_FILE, HTML_OUT, SIGNALS_OUT, DATE_STR, SCAN_DATE] = process.argv;

if (!TYPE || !CLASS_FILE || !HTML_OUT || !SIGNALS_OUT || !DATE_STR || !SCAN_DATE) {
  console.error('Usage: node decision-render.mjs <type> <classFile> <htmlOut> <signalsOut> <dateStr> <scanDate>');
  process.exit(1);
}

const d = JSON.parse(readFileSync(CLASS_FILE, 'utf-8'));

const TITLES = {
  momentum_stocks: 'Momentum Stocks',
  momentum_etf: 'Momentum ETF',
  sp_ndx: 'S&P 500 + Nasdaq 100',
  r2k: 'Russell 2000',
  momentum_ark: 'ARK',
  thematic_stocks: 'Thematic Stocks',
  thematic_etfs: 'Thematic ETFs',
};

const CLUSTERS = {
  ai_semis: ['NVDA', 'AMD', 'AVGO', 'TSM'],
  fintech_crypto: ['COIN', 'HOOD', 'SOFI', 'NU', 'XYZ'],
  autonomy_space: ['TSLA', 'ACHR', 'JOBY', 'EH', 'AVAV'],
  ai_software: ['PLTR', 'PATH', 'DDOG', 'NET', 'SNOW', 'MDB'],
  genomics: ['CRSP', 'BEAM', 'NTLA', 'ILMN', 'RXRX', 'TWST', 'TXG', 'NTRA', 'PACB'],
};
function clusterOf(symbol) {
  for (const [name, syms] of Object.entries(CLUSTERS)) if (syms.includes(symbol)) return name;
  return null;
}

const TD = 'border:1px solid #ccc;padding:4px 8px';
const TH = 'border:1px solid #ccc;padding:4px 8px;background:#f5f5f5';
const TABLE = 'border-collapse:collapse;width:100%;font-size:13px';

function noteFor(e, isFail) {
  if (isFail) return e.reason;
  if (e.qualification === 'ready') return 'Pass — Ready';
  if (e.qualification === 'ready_norr') return 'Pass — NW inside (confirm R:R)';
  if (e.qualification === 'extended_continuation') return 'Pass — Trend continuation (50% size)';
  if (e.qualification === 'watch_extended') return 'Pass — Extended';
  if (e.qualification === 'watch_early') return 'Pass — Early';
  if (e.qualification === 'watch_low_rr') return 'Pass — Low R:R';
  return 'Pass — Unclear NW';
}
function rowColor(e, isFail) {
  if (isFail) return '';
  if (e.qualification === 'ready') return 'background:#e8f5e9';
  if (e.qualification === 'ready_norr') return 'background:#e3f2fd';
  if (e.qualification === 'extended_continuation') return 'background:#e8eaf6';
  if (e.qualification === 'watch_extended') return 'background:#fff8e1';
  if (e.qualification === 'watch_early') return 'background:#fce4ec';
  return '';
}
function watchReasonText(e) {
  if (e.qualification === 'watch_extended') return 'NW extended — wait for pullback';
  if (e.qualification === 'watch_early') return 'NW early — base-build, wait for re-entry into band';
  if (e.qualification === 'watch_low_rr') return `low R:R (${e.rr ?? 'n/a'})`;
  return 'NW position unclear';
}
function convictionNote(e) {
  const notes = [];
  if (e.osc?.DIVERGENCES === 'Bullish') notes.push('bullish OSC divergence');
  const mf = parseFloat(e.osc?.['MONEY FLOW']);
  if (!Number.isNaN(mf) && mf > 60) notes.push(`money flow ${mf}`);
  const sq = parseFloat(e.so?.SQUEEZE);
  if (!Number.isNaN(sq) && sq > 10) notes.push(`squeeze ${e.so.SQUEEZE}`);
  if (e.pac?.['P&D ZONES'] === 'Within Discount') notes.push('within discount zone');
  return notes.length ? ` (${notes.join(', ')})` : '';
}

const allPassers = [
  ...d.buckets.ready,
  ...(d.buckets.ready_norr || []),
  ...(d.buckets.extended_continuation || []),
  ...d.buckets.watch_extended,
  ...d.buckets.watch_early,
  ...d.buckets.watch_low_rr,
  ...d.buckets.watch_unknown,
];
allPassers.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

const actionableCount = d.actionable_count ?? d.buckets.ready.length;
const bannerParts = [];
if (d.buckets.ready.length) bannerParts.push(`${d.buckets.ready.length} READY (R:R confirmed)`);
if ((d.buckets.ready_norr || []).length) bannerParts.push(`${d.buckets.ready_norr.length} READY — NW inside, confirm R:R before entry`);
if ((d.buckets.extended_continuation || []).length) bannerParts.push(`${d.buckets.extended_continuation.length} TREND CONTINUATION — extended, score ≥ 4, enter at 50% size`);
const bannerHtml = actionableCount
  ? `<div style="background:#e8f5e9;padding:10px;border-radius:4px;margin-bottom:12px"><strong>${bannerParts.join(' · ')}</strong></div>`
  : `<div style="background:#fff3e0;padding:10px;border-radius:4px;margin-bottom:12px"><strong>0 actionable setups this cycle.</strong> ${allPassers.length} hard-filter passer(s) listed in Watch below.</div>`;

function topSetupsTable(list, cols, extraCol) {
  if (!list.length) return '<p><em>No actionable setups this cycle.</em></p>';
  const header = `<tr><th style="${TH}">RANK</th><th style="${TH}">SYMBOL</th><th style="${TH}">S&O RATING</th><th style="${TH}">SIGNAL</th><th style="${TH}">PAC</th><th style="${TH}">OSC DIV</th><th style="${TH}">NW</th><th style="${TH}">R:R</th><th style="${TH}">SCORE</th><th style="${TH}">STOP</th><th style="${TH}">TP1</th>${extraCol ? `<th style="${TH}">${extraCol}</th>` : ''}<th style="${TH}">ACTION</th></tr>`;
  const rows = list.map((e, i) => {
    const action = e.qualification === 'extended_continuation' ? 'Trend cont. — 50% size' : e.qualification === 'ready_norr' ? 'Enter long — confirm R:R' : 'Enter long';
    return `<tr style="${rowColor(e, false)}"><td style="${TD}">${i + 1}</td><td style="${TD}">${e.symbol}</td><td style="${TD}">${e.so?.RATING ?? '—'}</td><td style="${TD}">${e.so?.SIGNAL ?? '—'}</td><td style="${TD}">${e.pac?.STRUCTURE ?? '—'}</td><td style="${TD}">${e.osc?.DIVERGENCES ?? '—'}</td><td style="${TD}">${e.nw_position ?? '—'}</td><td style="${TD}">${e.rr ?? '—'}</td><td style="${TD}">${e.score}</td><td style="${TD}">${e.nw_lower ?? '—'}</td><td style="${TD}">${e.nw_upper ?? '—'}</td>${extraCol ? `<td style="${TD}">${clusterOf(e.symbol) ?? '—'}</td>` : ''}<td style="${TD}">${action}</td></tr>`;
  }).join('\n');
  return `<table style="${TABLE}">${header}${rows}</table>`;
}

function watchListHtml(list) {
  if (!list.length) return '<p><em>No watch-list symbols.</em></p>';
  return '<ul>' + list.map(e => `<li><strong>${e.symbol}</strong> — score ${e.score}, ${watchReasonText(e)}${convictionNote(e)}</li>`).join('\n') + '</ul>';
}

function allSymbolsTable(passers, fails) {
  const header = `<tr><th style="${TH}">SYMBOL</th><th style="${TH}">S&O RATING</th><th style="${TH}">SIGNAL</th><th style="${TH}">PAC STRUCTURE</th><th style="${TH}">NW</th><th style="${TH}">SCORE</th><th style="${TH}">NOTE</th></tr>`;
  const passRows = passers.map(e => `<tr style="${rowColor(e, false)}"><td style="${TD}">${e.symbol}</td><td style="${TD}">${e.so?.RATING ?? '—'}</td><td style="${TD}">${e.so?.SIGNAL ?? '—'}</td><td style="${TD}">${e.pac?.STRUCTURE ?? '—'}</td><td style="${TD}">${e.nw_position ?? '—'}</td><td style="${TD}">${e.score}</td><td style="${TD}">${noteFor(e, false)}</td></tr>`);
  const failRows = fails.map(e => `<tr><td style="${TD}">${e.symbol}</td><td style="${TD}">${e.so?.RATING ?? '—'}</td><td style="${TD}">${e.so?.SIGNAL ?? '—'}</td><td style="${TD}">${e.pac?.STRUCTURE ?? '—'}</td><td style="${TD}">—</td><td style="${TD}">${e.score}</td><td style="${TD}">${noteFor(e, true)}</td></tr>`);
  return `<table style="${TABLE}">${header}${passRows.join('\n')}${failRows.join('\n')}</table>`;
}

function scanSummaryBullets(extra) {
  const actionable = d.actionable_count ?? d.buckets.ready.length;
  return `<ul>
<li>Total scanned: ${d.symbol_count}</li>
<li>Hard-filter passers: ${d.passer_count}</li>
<li>Ready to enter (R:R ≥ 2.0): ${d.buckets.ready.length}</li>
${(d.buckets.ready_norr || []).length ? `<li>Ready — NW inside, R:R unconfirmed: ${d.buckets.ready_norr.length}</li>` : ''}
${(d.buckets.extended_continuation || []).length ? `<li>Trend continuation (extended, score ≥ 4): ${d.buckets.extended_continuation.length}</li>` : ''}
<li>Watch — NW extended: ${d.buckets.watch_extended.length}</li>
<li>Watch — NW early: ${d.buckets.watch_early.length}</li>
<li>Hard-filter fails: ${d.fail_count}</li>
${extra ? `<li>${extra}</li>` : ''}
<li>Overall posture: ${actionable ? 'Actionable setups present.' : d.passer_count > 0 ? 'No immediate entries — extended/early names dominate the passer list, consistent with a market that has already run without a fresh pullback.' : 'Very few names clearing the hard filter this cycle — broad weakness or consolidation.'}</li>
</ul>`;
}

function standardEmail(withCluster) {
  const rank = withCluster ? 'CLUSTER' : null;
  const clusterCounts = {};
  if (withCluster) {
    for (const e of d.buckets.ready) {
      const c = clusterOf(e.symbol);
      if (c) clusterCounts[c] = (clusterCounts[c] || 0) + 1;
    }
  }
  const clusterNote = withCluster && Object.values(clusterCounts).some(v => v > 1)
    ? `<p><em>Cluster conflict: ${Object.entries(clusterCounts).filter(([, v]) => v > 1).map(([c, v]) => `${c} (${v} names)`).join(', ')} — keep only the single best-scoring name per cluster.</em></p>`
    : '';
  const actionableList = [
    ...d.buckets.ready,
    ...(d.buckets.ready_norr || []),
    ...(d.buckets.extended_continuation || []),
  ].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  return `<h2>Top Setups</h2>
${bannerHtml}
${topSetupsTable(actionableList, null, rank)}
${clusterNote}
<h2>Watch List</h2>
${watchListHtml(allPassers.filter(e => !['ready', 'ready_norr', 'extended_continuation'].includes(e.qualification)))}
<h2>Scan Summary</h2>
${scanSummaryBullets()}
<h2>All Symbols — Hard Filter Results</h2>
${allSymbolsTable(allPassers, d.fails)}`;
}

function thematicStocksEmail() {
  const byTheme = {};
  for (const e of [...allPassers, ...d.fails]) {
    const t = e.theme || 'Unthemed';
    (byTheme[t] = byTheme[t] || []).push(e);
  }
  const themeBlocks = Object.entries(byTheme).map(([theme, items]) => {
    const bull = items.filter(i => i.so?.RATING?.includes('Bullish')).length;
    const bear = items.filter(i => i.so?.RATING?.includes('Bearish')).length;
    const header = `<tr><th style="${TH}">SYMBOL</th><th style="${TH}">SUB-GROUP</th><th style="${TH}">S&O RATING</th><th style="${TH}">SIGNAL</th><th style="${TH}">PAC STRUCTURE</th><th style="${TH}">OSC DIV</th><th style="${TH}">NW</th><th style="${TH}">SCORE</th><th style="${TH}">ACTION</th></tr>`;
    const sorted = [...items].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    const rows = sorted.map(e => {
      const isFail = e.score <= -99;
      const action = isFail ? '—' : (e.qualification === 'ready' ? 'Enter long' : 'Watch');
      return `<tr style="${rowColor(e, isFail)}"><td style="${TD}">${e.symbol}</td><td style="${TD}">${e.sub_group ?? '—'}</td><td style="${TD}">${e.so?.RATING ?? '—'}</td><td style="${TD}">${e.so?.SIGNAL ?? '—'}</td><td style="${TD}">${e.pac?.STRUCTURE ?? '—'}</td><td style="${TD}">${e.osc?.DIVERGENCES ?? '—'}</td><td style="${TD}">${e.nw_position ?? '—'}</td><td style="${TD}">${e.score}</td><td style="${TD}">${action}</td></tr>`;
    }).join('\n');
    return `<h3>${theme} — ${bull} bullish / ${bear} bearish / ${items.length} total</h3><table style="${TABLE}">${header}${rows}</table>`;
  }).join('\n');

  return `<h2>Top Picks Across All Themes</h2>
${bannerHtml}
${topSetupsTable(d.buckets.ready.map(e => ({ ...e })), null, null).replace('<th style="' + TH + '">SYMBOL</th>', `<th style="${TH}">SYMBOL</th><th style="${TH}">THEME</th>`)}
<h2>Theme Breakdown</h2>
${themeBlocks}
<h2>Watch List</h2>
${watchListHtml(allPassers.filter(e => e.qualification !== 'ready'))}
<h2>Scan Summary</h2>
${scanSummaryBullets()}`;
}

function thematicEtfsEmail() {
  const byTheme = {};
  for (const e of [...allPassers, ...d.fails]) {
    const t = e.theme || 'Unthemed';
    (byTheme[t] = byTheme[t] || []).push(e);
  }
  const rotationRows = Object.entries(byTheme).map(([theme, items]) => {
    const sorted = [...items].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    const leading = sorted.filter(i => i.score > -99).slice(0, 3).map(i => i.symbol).join(', ') || '—';
    const fading = sorted.filter(i => i.score <= -99).slice(0, 3).map(i => i.symbol).join(', ') || '—';
    const bullCount = items.filter(i => i.so?.RATING?.includes('Bullish')).length;
    const bias = bullCount > items.length / 2 ? 'Bullish tilt' : 'Mixed/bearish tilt';
    return `<tr><td style="${TD}">${theme}</td><td style="${TD}">${bias}</td><td style="${TD}">${leading}</td><td style="${TD}">${fading}</td></tr>`;
  }).join('\n');

  const avoidList = [...d.fails].slice(0, 10);
  const avoidRows = avoidList.map(e => `<tr><td style="${TD}">${e.symbol}</td><td style="${TD}">${e.theme ?? '—'}</td><td style="${TD}">${e.reason}</td></tr>`).join('\n');

  return `<h2>ETF Rotation Summary</h2>
${bannerHtml}
<table style="${TABLE}"><tr><th style="${TH}">ETF Theme</th><th style="${TH}">Bias</th><th style="${TH}">Leading ETFs</th><th style="${TH}">Lagging ETFs</th></tr>${rotationRows}</table>
<h2>Top ETF Picks</h2>
${topSetupsTable(d.buckets.ready, null, null)}
<h2>Watch List</h2>
${watchListHtml(allPassers.filter(e => e.qualification !== 'ready'))}
<h2>Avoid</h2>
<table style="${TABLE}"><tr><th style="${TH}">SYMBOL</th><th style="${TH}">THEME</th><th style="${TH}">REASON</th></tr>${avoidRows}</table>
<h2>Scan Summary + Cross-Theme Read</h2>
${scanSummaryBullets(`Themes covered: ${Object.keys(byTheme).length}`)}`;
}

let body;
if (TYPE === 'thematic_stocks') body = thematicStocksEmail();
else if (TYPE === 'thematic_etfs') body = thematicEtfsEmail();
else body = standardEmail(TYPE === 'momentum_ark');

const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#222;max-width:960px;margin:0 auto;padding:16px">
<h1>${TITLES[TYPE]} Weekly Decision — ${DATE_STR}</h1>
<p style="font-size:12px;color:#666">LuxAlgo S&O + PAC + OSC · NW Envelope L3 · ${d.symbol_count} symbols scanned</p>
${body}
</div>`;

writeFileSync(HTML_OUT, html);

const signals = {
  instrument_type: TYPE,
  scan_date: SCAN_DATE,
  generated_at: new Date().toISOString(),
  ready_to_enter: d.buckets.ready.map(e => ({ symbol: e.symbol, score: e.score, price: e.price, nw_upper: e.nw_upper, nw_lower: e.nw_lower, rr: e.rr })),
  ready_confirm_rr: (d.buckets.ready_norr || []).map(e => ({ symbol: e.symbol, score: e.score, price: e.price, note: 'NW inside — verify R:R before entry' })),
  trend_continuation: (d.buckets.extended_continuation || []).map(e => ({ symbol: e.symbol, score: e.score, price: e.price, note: 'NW extended, high score — 50% size trend continuation' })),
  watch: allPassers.filter(e => !['ready', 'ready_norr', 'extended_continuation'].includes(e.qualification)).map(e => ({ symbol: e.symbol, nw_position: e.nw_position, score: e.score, reason: watchReasonText(e) })),
};
writeFileSync(SIGNALS_OUT, JSON.stringify(signals, null, 2));

console.log(`${TYPE}: rendered ${HTML_OUT} + ${SIGNALS_OUT}`);
