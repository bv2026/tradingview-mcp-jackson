#!/usr/bin/env node
/* Provider-neutral boundary: validate one external response against one request. */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';

const root=process.env.TRADINGVIEW_ROOT||process.cwd();
const responseFile=process.argv[2];
if(!responseFile) throw new Error('Usage: node scripts/ingest-llm-decision.mjs <response.json> [manifest.json]');
const response=JSON.parse(readFileSync(responseFile,'utf8'));
const requestFile=response.request_artifact||process.argv[3];
if(!requestFile) throw new Error('Response must include request_artifact or a request/manifest path');
const reqPath=existsSync(requestFile)?requestFile:join(root,requestFile);
const req=JSON.parse(readFileSync(reqPath,'utf8'));
const manifestPath=process.argv[3]?.endsWith('manifest.json')?process.argv[3]:join(dirname(reqPath),'manifest.json');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const pkgPath=join(root,'evidence/latest/all-strategies-llm-input.json');
const packageHash=createHash('sha256').update(readFileSync(pkgPath)).digest('hex');
const errors=[]; const forbidden=/(best_overall|global_score|global ranking|cross[-_ ]strategy|global bullish|global bearish)/i;
const envelope=Array.isArray(response)?{decisions:response}:response;
const decisions=envelope.decisions||[envelope.decision?envelope.decision:envelope];
if(!Array.isArray(decisions)||!decisions.length) errors.push('response must contain at least one decision');
if(envelope.strategy!==undefined&&envelope.strategy!==req.strategy) errors.push('strategy does not match originating request');
if(envelope.strategy_context_version!==undefined&&envelope.strategy_context_version!==req.strategy_context_version) errors.push('strategy_context_version does not match originating request');
if(envelope.input_package_hash!==undefined&&envelope.input_package_hash!==packageHash) errors.push('input_package_hash does not match current canonical package');
const allowed=new Set((req.candidates||[]).flatMap(c=>[c.symbol,c.full_symbol].filter(Boolean)));
const schemaFields=new Set(['strategy','symbol','decision','direction','confidence','rationale','supporting_evidence','conflicting_evidence','missing_or_unknown','manual_checks','invalidation_conditions','final_comment']);
for(const [i,d] of decisions.entries()){
  if(!d||typeof d!=='object'){errors.push(`decision ${i+1} is not an object`);continue;}
  if(d.strategy!==req.strategy) errors.push(`decision ${i+1} strategy mismatch`);
  if(!allowed.has(d.symbol)) errors.push(`decision ${i+1} symbol is not an allowed candidate`);
  if(typeof d.symbol!=='string'||typeof d.direction!=='string'&&d.direction!==null) errors.push(`decision ${i+1} has invalid identity/direction`);
  if(!['ACTIONABLE_REVIEW','WATCH','AVOID','INSUFFICIENT'].includes(d.decision)) errors.push(`decision ${i+1} has invalid decision`);
  if(typeof d.confidence!=='number'||d.confidence<0||d.confidence>1) errors.push(`decision ${i+1} confidence must be 0..1`);
  for(const k of ['rationale','supporting_evidence','conflicting_evidence','missing_or_unknown','manual_checks']) if(!Array.isArray(d[k])) errors.push(`decision ${i+1} ${k} must be an array`);
  if('invalidation_conditions' in d&&!Array.isArray(d.invalidation_conditions)) errors.push(`decision ${i+1} invalidation_conditions must be an array`);
  if(typeof d.final_comment!=='string') errors.push(`decision ${i+1} final_comment must be a string`);
  if(Object.keys(d).some(k=>!schemaFields.has(k))) errors.push(`decision ${i+1} contains prohibited/non-schema fields`);
  if(JSON.stringify(d).match(forbidden)) errors.push(`decision ${i+1} contains forbidden global/cross-strategy language`);
  if(['score','rank_score','eligibility','status','evidence_state','strategy_context','strategy_context_version'].some(k=>k in d)) errors.push(`decision ${i+1} attempts to mutate deterministic input state`);
}
const entry=manifest.decisions.find(x=>x.strategy===req.strategy);
if(!entry) errors.push('strategy is absent from manifest');
else if(entry.input_package_hash!==packageHash) errors.push('manifest package hash is stale');
const outDir=dirname(manifestPath), strategy=req.strategy;
if(errors.length){
  const rejected=join(outDir,'rejected'); mkdirSync(rejected,{recursive:true});
  writeFileSync(join(rejected,`${strategy}.json`),JSON.stringify({status:'REJECTED',strategy,errors,source:basename(responseFile)},null,2)+'\n');
  if(entry){entry.status='REJECTED';entry.validation={status:'REJECTED',errors};entry.decision_artifact=null;}
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.error(JSON.stringify({status:'REJECTED',strategy,errors},null,2)); process.exitCode=2;
} else {
  const artifact=join(outDir,`${strategy}.json`);
  writeFileSync(artifact,JSON.stringify({status:'VALIDATED',strategy,strategy_context_version:req.strategy_context_version,input_package_hash:packageHash,decisions},null,2)+'\n');
  entry.status='VALIDATED';entry.decision_artifact=artifact.replace(root+'\\','').replaceAll('\\','/');entry.validation={status:'VALIDATED'};
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({status:'VALIDATED',strategy,artifact},null,2));
}
