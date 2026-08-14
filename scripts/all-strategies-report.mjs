#!/usr/bin/env node
/** Build one user-facing report from the newest available scan/brief artifacts. */
import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateLuxScanPayload } from '../src/core/lux-scan-contract.js';

const root = process.env.TRADINGVIEW_ROOT || process.cwd();
const outFile = process.argv[2] || join(root, 'reports', 'all-strategies-decision.md');
const families = ['momentum_stocks','momentum_etf','momentum_ark','sp_ndx','r2k','thematic_stocks','thematic_etfs','futures','crypto','crypto_perps'];
const title = t => t.replaceAll('_',' ').replace(/\b\w/g, c => c.toUpperCase());
const esc = v => String(v ?? 'N/A').replaceAll('|','\\|').replaceAll('\n',' ');
const score = r => Number.isFinite(r.rank_score) ? r.rank_score : Number.isFinite(r.score) ? r.score : 'N/A';
const direction = r => r.setup_direction || r.direction || r.bias || r.signal || 'UNKNOWN';
const setup = r => r.setup_quality || r.setup || 'N/A';
const entry = r => r.entry_quality || r.entry || 'N/A';
const status = r => r.eligibility || r.status || 'UNKNOWN';
function recommendation(r, type) {
  const e = String(status(r)).toUpperCase();
  if (type === 'crypto' && /SHORT/.test(String(direction(r)).toUpperCase())) return 'WATCH (spot long-only)';
  if (e === 'REVIEW' || e === 'READY') return 'REVIEW';
  if (e === 'REJECT' || e === 'AVOID') return 'AVOID';
  if (e === 'WATCH') return 'WATCH';
  if (e === 'INSUFFICIENT' || e === 'UNKNOWN') return 'INSUFFICIENT';
  return e || 'INSUFFICIENT';
}
function why(r) {
  const bits = [];
  if (r.so?.RATING) bits.push(`S&O ${r.so.RATING}`);
  if (r.so?.SIGNAL) bits.push(`signal ${r.so.SIGNAL}`);
  if (r.pac?.STRUCTURE) bits.push(`PAC ${r.pac.STRUCTURE}`);
  if (r.nw_position) bits.push(`NW ${r.nw_position}`);
  if (r.evidence_state?.momentum_quality) bits.push(`momentum ${r.evidence_state.momentum_quality}`);
  return bits.join('; ') || r.analysis || r.reason || 'No structured explanation in current artifact';
}
function newestScan(type) {
  const dirs = [];
  const base = join(root, 'reports');
  for (const week of readdirSync(base, { withFileTypes:true }).filter(x=>x.isDirectory() && /^\d{4}-Wk\d+$/.test(x.name)))
    for (const day of readdirSync(join(base,week.name), {withFileTypes:true}).filter(x=>x.isDirectory())) dirs.push(join(base,week.name,day.name));
  const files = dirs.flatMap(d => { try { return readdirSync(d).filter(f=>f === `scan-${type}.json`).map(f=>join(d,f)); } catch { return []; } });
  return files.sort().at(-1);
}
function newestInvalid(type) {
  const dirs = [];
  const base = join(root, 'reports');
  for (const week of readdirSync(base, { withFileTypes:true }).filter(x=>x.isDirectory() && /^\d{4}-Wk\d+$/.test(x.name)))
    for (const day of readdirSync(join(base,week.name), {withFileTypes:true}).filter(x=>x.isDirectory())) dirs.push(join(base,week.name,day.name));
  const files = dirs.flatMap(d => { try { return readdirSync(d).filter(f => f === `scan-${type}.invalid.json`).map(f=>join(d,f)); } catch { return []; } });
  return files.sort().at(-1);
}
function signalFor(scan, type) {
  const p = scan.replace(`scan-${type}.json`, `${type}-signals.json`);
  if (!existsSync(p)) return new Map();
  const d = JSON.parse(readFileSync(p, 'utf8')); const m = new Map();
  for (const [bucket, label] of [['ready_to_enter','REVIEW'],['ready_confirm_rr','REVIEW'],['trend_continuation','WATCH'],['watch','WATCH']])
    for (const r of (d[bucket] || [])) m.set(r.symbol, { status: label, analysis: r.note || r.reason || bucket });
  return m;
}
function brief(type) {
  const base = join(root,'reports'); let hits=[];
  for (const w of readdirSync(base,{withFileTypes:true}).filter(x=>x.isDirectory() && /^\d{4}-Wk\d+$/.test(x.name))) {
    try { for (const d of readdirSync(join(base,w.name),{withFileTypes:true}).filter(x=>x.isDirectory())) { const p=join(base,w.name,d.name,`${type}.md`); if(existsSync(p)) hits.push(p); } } catch {}
  }
  return hits.sort().at(-1);
}
const sections=[]; const top=[]; const missing=[];
for (const type of families) {
  const scan = newestScan(type);
  const invalid = newestInvalid(type);
  if (scan) {
    const d=JSON.parse(readFileSync(scan,'utf8'));
    const contract = validateLuxScanPayload(d, d.instrument_type);
    if (!contract.valid) { missing.push(`${type} (INVALID)`); sections.push(`## ${title(type)} — INVALID / SKIPPED\n\nSource artifact failed the Lux scan contract and was not presented as actionable output.\n\nValidation: ${esc(contract.errors.slice(0, 3).join('; '))}`); continue; }
    const signalMap=signalFor(scan,type); const rows=[...(d.symbols_raw||[])].map(r=>({...r,...(signalMap.get(r.symbol)||{})})).sort((a,b)=>(score(b)==='N/A'?-Infinity:score(b))-(score(a)==='N/A'?-Infinity:score(a))).slice(0,10);
    sections.push(`## ${title(type)}\n\nSource: \`${scan.replace(root+'\\','')}\`\n\n| Rank | Symbol | Score | Direction | Setup | Entry | Status | Why | Recommendation |\n|---:|---|---:|---|---|---|---|---|---|\n${rows.map((r,i)=>`| ${i+1} | ${esc(r.symbol)} | ${score(r)} | ${esc(direction(r))} | ${esc(setup(r))} | ${esc(entry(r))} | ${esc(status(r))} | ${esc(why(r))} | ${recommendation(r,type)} |`).join('\n')}\n\nFull scanned rows remain available in the source JSON.`);
    top.push(...rows.filter(r=>['REVIEW','READY'].includes(String(status(r)).toUpperCase())).slice(0,2).map(r=>`${type}: ${r.symbol} (${score(r)})`));
  } else if (invalid) {
    let reason = 'Publisher validation failed; no actionable family output was published.';
    try { reason = JSON.parse(readFileSync(invalid,'utf8')).errors?.join('; ') || reason; } catch {}
    missing.push(`${type} (INVALID)`); sections.push(`## ${title(type)} — INVALID / SKIPPED\n\nSource artifact failed the Lux scan contract and was not presented as actionable output.\n\nValidation: ${esc(reason)}`);
  } else if (['crypto','crypto_perps','futures'].includes(type) && brief(type)) {
    const p=brief(type), text=readFileSync(p,'utf8'); const lines=text.split('\n').filter(x=>/^\d+\. \*\*/.test(x)).slice(0,3);
    sections.push(`## ${title(type)}\n\nSource: \`${p.replace(root+'\\','')}\`\n\nNumeric score: **N/A** — current brief artifact does not expose a row-level score. Direction and recommendation are preserved from the strategy’s accepted analysis.\n\n| Rank | Symbol | Score | Direction | Setup | Entry | Status | Analysis / location | Recommendation |\n|---:|---|---:|---|---|---|---|---|---|\n${lines.map((x,i)=>{const m=x.match(/^\d+\. \*\*([^*]+)\*\* ?[—-] ?(.*)/);return m?`| ${i+1} | ${m[1]} | N/A | SEE BRIEF | N/A | N/A | ${type==='crypto'?'WATCH':'REVIEW'} | ${esc(m[2])} | ${type==='crypto'?'WATCH (spot long-only)':'REVIEW'} |`:''}).filter(Boolean).join('\n')}\n\nManual check required: confirm current chart, location, stop, target, and live provider freshness before action.`);
  } else missing.push(type);
}
const report=`# All-Strategies Decision Report\n\nGenerated: ${new Date().toISOString()}\n\n## Executive Summary\n\n- Strongest candidates are grouped by strategy below; scores are not compared across incomparable models.\n- Cross-strategy REVIEW candidates: ${top.length?top.join('; '):'none in current structured artifacts'}.\n- Missing/insufficient outputs: ${missing.length?missing.join(', '):'none'}. Unknown evidence is not treated as bearish.\n- Research Intelligence is not used as recommendation input.\n- Every recommendation still requires manual chart/location/risk confirmation.\n\n${sections.join('\n\n')}\n`;
mkdirSync(join(outFile,'..'),{recursive:true}); writeFileSync(outFile,report); console.log(outFile);
