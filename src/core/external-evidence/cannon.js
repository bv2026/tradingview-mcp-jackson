import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../report_paths.js';

const DB = process.env.CANNONEDGE_DB || 'C:\\work\\canontrading-scrape\\data\\cannonedge.db';
const MAP = JSON.parse(readFileSync(join(PROJECT_ROOT, 'config', 'cannon-futures-map.json'), 'utf8'));
const LEVELS = ['R3', 'R2', 'R1', 'Pivot', 'S1', 'S2', 'S3'];
const PY = String.raw`import json, sqlite3, sys
from datetime import date, datetime
req=json.load(sys.stdin); db=req['db']; market=req.get('market_code'); requested=req.get('capture_date')
out={'market_code':market}
try:
  con=sqlite3.connect('file:'+db+'?mode=ro', uri=True); con.row_factory=sqlite3.Row
  snap=con.execute("SELECT * FROM snapshot_rows WHERE market_code=? AND post_date<=? ORDER BY post_date DESC,row_order DESC LIMIT 1",(market,requested)).fetchone()
  if not snap: out['reason']='SNAPSHOT_UNAVAILABLE'; print(json.dumps(out)); raise SystemExit
  sd=snap['post_date']; out.update({'snapshot_date':sd,'description':snap['description'],'close':snap['close'],'change_pct':snap['today_change_pct'],'short_down':snap['short_down'],'short_up':snap['short_up'],'long_down':snap['long_down'],'long_up':snap['long_up']})
  inst={'EP':'ES','ENQ':'NQ','USA':'ZB','BTC':'BRTI','CLE':'CL','GCE':'GC','SIE':'SI','NGE':'NG','KCE':'KC','SBE':'SB','CCE':'CC','EU6':'EURO','ZCE':'ZC','ZSE':'ZS','ZWA':'ZW','GLE':'LE','HE':'HE'}.get(market)
  if inst:
    lr=con.execute("SELECT MAX(dlt.levels_date) ld FROM daily_level_tables dlt JOIN daily_level_rows dlr ON dlr.daily_level_table_id=dlt.id WHERE dlt.levels_date<=? AND dlr.instrument=?",(sd,inst)).fetchone()
    if lr and lr['ld']:
      out['levels_date']=lr['ld']; aliases={'Resistance 1':'R1','Resistance 2':'R2','Resistance 3':'R3','Support 1':'S1','Support 2':'S2','Support 3':'S3'}
      out['levels']={aliases.get(r['level_name'],r['level_name']):r['value'] for r in con.execute("SELECT level_name,value FROM daily_level_tables dlt JOIN daily_level_rows dlr ON dlr.daily_level_table_id=dlt.id WHERE dlt.levels_date=? AND dlr.instrument=?",(lr['ld'],inst)).fetchall() if r['value'] is not None}
  cr=con.execute("SELECT cin.body_text FROM commentary_instrument_notes cin JOIN post_commentary pc ON pc.id=cin.post_commentary_id WHERE pc.post_date=? AND cin.market_code=? AND cin.note_type='pricecount' LIMIT 1",(sd,market)).fetchone()
  out['commentary']=cr['body_text'] if cr else None; con.close()
except Exception as e: out={'reason':'DATABASE_QUERY_ERROR','error':str(e), 'market_code':market}
print(json.dumps(out, ensure_ascii=False))`;

function unavailable(tv, reason, captureDate) {
  return { provider: 'CannonTrading', available: false, status: 'UNAVAILABLE', reason, market_code: null,
    tv_symbol: tv, capture_date: captureDate, snapshot_date: null, levels_date: null, timeframe: '1D',
    timeframe_relation: tv && captureDate ? 'same_daily_context' : null, close: null, change_pct: null,
    short: { down: null, up: null, derived: null }, long: { down: null, up: null, derived: null }, bias: null,
    levels: Object.fromEntries(LEVELS.map(k => [k, null])), commentary: null, freshness: { age_days: null, status: 'UNAVAILABLE' },
    source: { database: DB, provider: 'CannonTrading', attribution: 'CannonEdge SQLite authoritative source' } };
}

function tradingAge(a, b) { const d = new Date(`${a}T00:00:00Z`), e = new Date(`${b}T00:00:00Z`); let n=0; for (let x=new Date(d); x<e; x.setUTCDate(x.getUTCDate()+1)) if (x.getUTCDay()!==0 && x.getUTCDay()!==6) n++; return n; }
export function cannonEvidence(tvSymbol, { captureDate = new Date().toISOString().slice(0,10), timeframe = 'D', dbPath = DB } = {}) {
  const market = MAP[tvSymbol]; if (!market) return unavailable(tvSymbol, 'NO_MARKET_MAPPING', captureDate);
  if (!existsSync(dbPath)) return unavailable(tvSymbol, 'DATABASE_UNAVAILABLE', captureDate);
  const p = spawnSync(process.env.PYTHON || 'python', ['-c', PY], { input: JSON.stringify({db: dbPath, market_code: market, capture_date: captureDate}), encoding: 'utf8' });
  if (p.status !== 0 || !p.stdout) return unavailable(tvSymbol, 'DATABASE_QUERY_ERROR', captureDate);
  let raw; try { raw=JSON.parse(p.stdout); } catch { return unavailable(tvSymbol, 'DATABASE_QUERY_ERROR', captureDate); }
  if (raw.reason) return unavailable(tvSymbol, raw.reason, captureDate);
  const age=tradingAge(raw.snapshot_date, captureDate); const short=raw.short_up==='UP'?'UP':raw.short_down==='DOWN'?'DOWN':''; const long=raw.long_up==='UP'?'UP':raw.long_down==='DOWN'?'DOWN':'';
  const bias=short===long&&short?short:long||short||'NEUTRAL'; const status=age===0?'FRESH':age===1?'AGING':'STALE';
  return { provider:'CannonTrading', available:true, status:'AVAILABLE', reason:null, market_code:market, tv_symbol:tvSymbol, capture_date:captureDate, snapshot_date:raw.snapshot_date, levels_date:raw.levels_date||null, timeframe:'1D', timeframe_relation:timeframe==='D'||timeframe==='1D'?'same_daily_context':'higher_timeframe_context', close:raw.close, change_pct:raw.change_pct, short:{down:raw.short_down,up:raw.short_up,derived:short}, long:{down:raw.long_down,up:raw.long_up,derived:long}, bias, levels:Object.fromEntries(LEVELS.map(k=>[k,raw.levels?.[k]??null])), commentary:raw.commentary??null, freshness:{age_days:age,status}, source:{database:dbPath,provider:'CannonTrading',attribution:'CannonEdge SQLite authoritative source'} };
}
export const cannonMapping = MAP;
