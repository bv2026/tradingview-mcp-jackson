import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/tab.js';

export function registerTabTools(server) {
  server.tool('tab_list', 'List all open TradingView chart tabs', {}, async () => {
    try { return jsonResult(await core.list()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_new', 'Open a new chart tab', {}, async () => {
    try { return jsonResult(await core.newTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_close', 'Close the current chart tab', {}, async () => {
    try { return jsonResult(await core.closeTab()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('tab_switch', 'Switch to a chart tab by chart_id (stable, survives reorder) or index (positional)', {
    index: z.coerce.number().optional().describe('Tab index (0-based, from tab_list) — fragile if tabs are reordered'),
    chart_id: z.string().optional().describe('Chart layout ID from the URL (e.g. "8UitTI02") — stable across reorders, preferred'),
    tab_id: z.string().optional().describe('CDP target ID (from tab_list) — stable within a session'),
  }, async ({ index, chart_id, tab_id }) => {
    try { return jsonResult(await core.switchTab({ index, chart_id, tab_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}
