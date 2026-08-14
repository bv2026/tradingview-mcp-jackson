import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL_DIR = 'C:\\work\\tradingview-mcp-jackson\\evidence\\latest';
const DRIVE_DIR = 'G:\\My Drive\\Trading Platform Architecture\\Jackson Platform Workspace\\evidence\\latest';
const FILENAMES = {
  momentum_stocks: 'momentum_stocks.raw.json', momentum_etf: 'momentum_etf.raw.json',
  momentum_ark: 'momentum_ark.raw.json', sp_ndx: 'sp_ndx.raw.json', r2k: 'r2k.raw.json',
  thematic_stocks: 'thematic_stocks.raw.json', thematic_etfs: 'thematic_etfs.raw.json',
  thematic_etfs_1: 'thematic_etfs_1.raw.json', thematic_etfs_2: 'thematic_etfs_2.raw.json',
  crypto: 'crypto.raw.json', crypto_perps: 'crypto_perps.raw.json', futures: 'futures.raw.json',
};

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const atomicWrite = (path, text) => {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, text, 'utf8');
  renameSync(tmp, path);
};

function mirrorTo(path, filename, driveDir = DRIVE_DIR) {
  try {
    mkdirSync(driveDir, { recursive: true });
    atomicWrite(join(driveDir, filename), readFileSync(path, 'utf8'));
    return null;
  } catch (e) { return e.message; }
}

export function persistRawEvidence(payload, { instrumentType, sourceTool, timeframe, complete = true, localDir = LOCAL_DIR, driveDir = DRIVE_DIR } = {}) {
  const filename = FILENAMES[instrumentType];
  if (!filename) return { success: false, skipped: true, error: `No canonical filename for ${instrumentType}` };
  mkdirSync(localDir, { recursive: true });
  const staging = join(localDir, `.${filename}.staging`);
  const canonical = join(localDir, filename);
  const symbols = payload.symbols_raw || payload.symbols_scanned || [];
  const now = new Date().toISOString();
  const enriched = { ...payload, captured_at: payload.captured_at || now, generated_at: payload.generated_at || now,
    instrument_type: payload.instrument_type || instrumentType, timeframe: payload.timeframe || timeframe || null,
    source_tool: sourceTool };
  try {
    let toWrite = enriched;
    if (!complete) {
      const prior = existsSync(staging) ? JSON.parse(readFileSync(staging, 'utf8')) : null;
      const merged = new Map((prior?.symbols_raw || prior?.symbols_scanned || []).map(r => [r.symbol, r]));
      for (const row of symbols) merged.set(row.symbol, row);
      toWrite = { ...enriched, symbols_raw: [...merged.values()], symbol_count: merged.size };
      atomicWrite(staging, JSON.stringify(toWrite, null, 2));
      return { success: true, staged: true, filename, local_path: staging };
    }
    if (existsSync(staging)) {
      const prior = JSON.parse(readFileSync(staging, 'utf8'));
      const merged = new Map((prior.symbols_raw || prior.symbols_scanned || []).map(r => [r.symbol, r]));
      for (const row of symbols) merged.set(row.symbol, row);
      toWrite = { ...enriched, symbols_raw: [...merged.values()], symbol_count: merged.size };
    }
    const text = JSON.stringify(toWrite, null, 2);
    atomicWrite(canonical, text);
    const buf = Buffer.from(text, 'utf8');
    const mirror_error = mirrorTo(canonical, filename, driveDir);
    const manifestPath = join(localDir, 'manifest.json');
    const entry = { filename, instrument_type: instrumentType, source_tool: sourceTool, captured_at: toWrite.captured_at,
      generated_at: toWrite.generated_at, symbol_count: toWrite.symbols_raw?.length ?? toWrite.symbols_scanned?.length ?? 0,
      file_size: buf.length, sha256: sha256(buf), status: 'success', ...(mirror_error ? { mirror_error } : {}) };
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
    manifest[instrumentType] = entry;
    atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));
    if (!mirror_error) atomicWrite(join(driveDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return { success: true, filename, local_path: canonical, drive_path: join(driveDir, filename), sha256: entry.sha256, file_size: entry.file_size, mirror_error };
  } catch (e) {
    console.error(`raw evidence persistence failed for ${instrumentType}: ${e.message}`);
    return { success: false, filename, error: e.message };
  }
}

export const rawEvidenceTestHelpers = { FILENAMES, atomicWrite };
