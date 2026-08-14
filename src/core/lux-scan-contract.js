export const LUX_EQUITY_TYPES = Object.freeze(['momentum_stocks','momentum_etf','momentum_ark','sp_ndx','r2k','thematic_stocks','thematic_etfs']);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
export function validateLuxScanPayload(payload, instrumentType = payload?.instrument_type) {
  if (!LUX_EQUITY_TYPES.includes(instrumentType)) return { valid: true, errors: [] };
  const errors = [];
  if (!Array.isArray(payload?.symbols_raw)) errors.push('symbols_raw must be an array');
  for (const [i, row] of (payload?.symbols_raw || []).entries()) {
    const p = `symbols_raw[${i}]`;
    if (!row?.symbol) errors.push(`${p}.symbol is required`);
    for (const f of ['so','pac','osc']) if (!object(row?.[f])) errors.push(`${p}.${f} is missing (morning_brief or malformed capture)`);
    if (typeof row?.score !== 'number' || !Number.isFinite(row.score)) errors.push(`${p}.score must be numeric`);
    if (!['REVIEW','REJECT'].includes(row?.eligibility)) errors.push(`${p}.eligibility must be REVIEW or REJECT`);
    for (const f of ['so_status','pac_status','osc_status']) if (row?.[f] !== 'AVAILABLE') errors.push(`${p}.${f}=${row?.[f] ?? 'missing'}; Lux evidence is unavailable`);
  }
  return { valid: errors.length === 0, errors };
}
export function assertLuxScanPayload(payload, instrumentType = payload?.instrument_type) {
  const result = validateLuxScanPayload(payload, instrumentType);
  if (!result.valid) throw new Error(`Invalid Lux scan capture for ${instrumentType}: ${result.errors.slice(0, 8).join('; ')}`);
  return payload;
}
