import test from 'node:test';
import assert from 'node:assert/strict';
import { attachCoinbaseWeekly, resolveCoinbaseWeeklyRelationship } from '../src/core/external-evidence/coinbase-weekly.js';

const latest = { report_date:'2026-08-14', freshness:{source_received_at:'2026-08-14T13:05:39Z'}, completeness:{completeness:'complete',missing_sections:[],section_availability:{Derivatives:{availability:'missing',conditional:true}}}, trade_scenarios:{btc:{support_zones:[{low:58000}],resistance_zones:[{low:67000}],conditional_scenarios:[]},eth:{support_zones:[{low:1500}],resistance_zones:[{low:1930}],conditional_scenarios:[]}}, market_view:{summary_text:'broad'}, derivatives:{btc:{DVOL:null,VRP:null,skew:null}}, perpetuals:{btc:{funding:{value:'+7.4%'},OI:null}}, flows:{source_text:'context'}, week_ahead:{events:[]}, provenance:{issue_id:'i',content_sha256:'h',parser_version:'v'}};
const row = symbol => ({ symbol, score:4, rank_score:4, setup_direction:'LONG', setup_quality:'C', entry_quality:'FAVORABLE', eligibility:'REVIEW', market_context:{cannon:{x:1}}, perp_evidence_state:{session_context:{x:1}} });

test('Coinbase relationships and direct asset scoping', () => {
  assert.equal(resolveCoinbaseWeeklyRelationship('COINBASE:BTCUSD','crypto'),'DIRECT');
  assert.equal(resolveCoinbaseWeeklyRelationship('COINBASE:BTCUSDC.P','crypto_perps'),'DIRECT');
  assert.equal(resolveCoinbaseWeeklyRelationship('COINBASE:ETHUSDC.P','crypto_perps'),'DIRECT');
  assert.equal(resolveCoinbaseWeeklyRelationship('COINBASE:SOLUSD','crypto'),'REFERENCE');
  assert.equal(resolveCoinbaseWeeklyRelationship('COINBASE:PAXGUSD','crypto'),'NONE');
  assert.equal(resolveCoinbaseWeeklyRelationship('COINBASE:TEKZ2030','crypto_perps'),'NONE');
  assert.deepEqual(attachCoinbaseWeekly(row('COINBASE:ETHUSD'),{instrumentType:'crypto',latest}).asset_context.support_zones,[{low:1500}]);
});
test('reference has no BTC numerical zones and research intelligence is absent', () => {
  const x=attachCoinbaseWeekly(row('COINBASE:SOLUSD'),{instrumentType:'crypto',latest});
  assert.equal(x.relationship,'REFERENCE'); assert.equal(x.asset_context.broad_market,'broad');
  assert.equal(x.asset_context.support_zones,undefined); assert.equal(x.research_intelligence,undefined);
});
test('freshness boundaries and missing provider are safe', () => {
  for (const [d,s] of [['2026-08-14','CURRENT_ISSUE'],['2026-08-06','AGING'],['2026-07-30','STALE']]) assert.equal(attachCoinbaseWeekly(row('COINBASE:BTCUSD'),{instrumentType:'crypto',latest:{...latest,report_date:d},now:new Date('2026-08-14T12:00:00Z')}).freshness.status,s);
  assert.equal(attachCoinbaseWeekly(row('COINBASE:BTCUSD'),{instrumentType:'crypto',latest:null}).freshness.status,'UNAVAILABLE');
});
test('attachment preserves scoring fields and chart-suppressed numerics', () => {
  const before=row('COINBASE:BTCUSD'); const x={...before,market_context:{...before.market_context,coinbase_weekly:attachCoinbaseWeekly(before,{instrumentType:'crypto',latest})}};
  for (const k of ['score','rank_score','setup_direction','setup_quality','entry_quality','eligibility','perp_evidence_state']) assert.deepEqual(x[k],before[k]);
  assert.equal(x.market_context.coinbase_weekly.risk_context.dvol,null); assert.equal(x.market_context.coinbase_weekly.risk_context.vrp,null); assert.equal(x.market_context.coinbase_weekly.risk_context.skew,null);
});
test('non-crypto paths are unavailable and none', () => assert.equal(attachCoinbaseWeekly(row('COINBASE:BTCUSD'),{instrumentType:'futures',latest}).relationship,'NONE'));
