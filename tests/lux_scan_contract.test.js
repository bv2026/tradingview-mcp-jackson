import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLuxScanPayload } from '../src/core/lux-scan-contract.js';
const row = (x = {}) => ({ symbol:'NASDAQ:TEST', so:{RATING:'Bullish'}, pac:{STRUCTURE:'BOS'}, osc:{}, score:5, eligibility:'REVIEW', so_status:'AVAILABLE', pac_status:'AVAILABLE', osc_status:'AVAILABLE', ...x });
test('rejects morning_brief-shaped Lux captures', () => { const r = validateLuxScanPayload({instrument_type:'sp_ndx',symbols_raw:[{symbol:'TEST',indicators:{},quote:{}}]}); assert.equal(r.valid,false); assert.match(r.errors.join(' '),/so is missing/); });
test('rejects missing symbols_raw and undefined Lux output', () => { assert.equal(validateLuxScanPayload({instrument_type:'momentum_etf'}).valid,false); assert.equal(validateLuxScanPayload({instrument_type:'r2k',symbols_raw:[row({score:undefined})]}).valid,false); });
test('accepts a complete Lux evidence-state capture', () => { assert.equal(validateLuxScanPayload({instrument_type:'sp_ndx',symbols_raw:[row()]}).valid,true); });
