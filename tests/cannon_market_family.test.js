import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCannonMarketFamily, portableCannonContext } from '../src/core/external-evidence/cannon-market-family.js';

const r = (s, t = 'futures') => resolveCannonMarketFamily(s, { instrumentType: t });
test('futures families and audited direct mappings resolve consistently', () => {
  for (const [a, b] of [['ES','MES'],['NQ','MNQ'],['CL','MCL'],['NG','MNG'],['GC','MGC'],['GC','1OZ'],['SI','SIL'],['SI','SIC'],['HG','MHG'],['6E','M6E']]) {
    assert.equal(r(a).family, r(b).family); assert.equal(r(a).relationship, 'DIRECT'); assert.equal(r(b).levels_portable, true);
  }
  for (const s of ['YM','MYM','RTY','M2K','RB','6C','MCD','6A','M6A','6J','6B','M6B','6N','6S','MSF']) assert.equal(r(s).relationship, 'NONE', s);
});
test('current Cannon futures map is represented by registry', () => {
  for (const s of ['CME_MINI:ES1!','CME_MINI:NQ1!','CBOT:ZB1!','COMEX:GC1!','COMEX:SI1!','COMEX:HG1!','NYMEX:CL1!','NYMEX:NG1!','CME:6E1!','CME:BTC1!','CBOT:ZS1!','CBOT:ZW1!','CBOT:ZC1!','ICEUS:KC1!','ICEUS:SB1!','ICEUS:CC1!','CME:LE1!','CME:HE1!']) assert.equal(r(s).relationship, 'DIRECT', s);
});
test('crypto and product references preserve relationship semantics', () => {
  assert.equal(r('COINBASE:BTCUSD','crypto').relationship, 'DIRECT');
  assert.equal(r('COINBASE:BTCUSDC.P','crypto_perps').relationship, 'DIRECT');
  for (const s of ['ETHUSDC.P','AIUSDC.P']) { const x = r(s, 'crypto_perps'); assert.equal(x.family, 'bitcoin'); assert.equal(x.relationship, 'REFERENCE'); assert.equal(x.levels_portable, false); }
  for (const s of ['COINBASE:PAXGUSD','COINBASE:PAXGUSDC.P','COINBASE:TEKZ2030','COINBASE:DEFZ2030','OIL','SLVR','GLD','PAXG-USD','COPR','EURC-USDC']) assert.equal(r(s, 'crypto').relationship, 'REFERENCE', s);
  for (const s of ['CHN','COINBASE:CHNZ2030','PLAT','AUDD-USDC','TGBP-USDC','XSGD-USDC']) assert.equal(r(s, 'crypto').relationship, 'NONE', s);
});
test('reference context cannot expose numerical Cannon levels', () => {
  const out = portableCannonContext({ provider:'CannonTrading', available:true, status:'AVAILABLE', bias:'UP', short:{}, long:{}, freshness:{status:'FRESH'}, levels:{Pivot:1}, reaction_zones:{high_30d:2} }, r('COINBASE:PAXGUSD','crypto'));
  assert.equal(out.levels, undefined); assert.equal(out.reaction_zones, undefined); assert.equal(out.levels_portable, false); assert.equal(out.relationship, 'REFERENCE');
});
