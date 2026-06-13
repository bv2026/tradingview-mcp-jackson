/**
 * Core tab management logic.
 * Controls TradingView Desktop tabs via CDP and Electron keyboard shortcuts.
 */
import { getClient, evaluate, switchTarget } from '../connection.js';

const CDP_HOST = 'localhost';
const CDP_PORT = 9222;

/**
 * List all open chart tabs (CDP page targets).
 */
export async function list() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();

  const tabs = targets
    .filter(t => t.type === 'page' && /tradingview\.com/i.test(t.url))
    .map((t, i) => ({
      index: i,
      id: t.id,
      title: t.title.replace(/^Live stock.*charts on /, ''),
      url: t.url,
      chart_id: t.url.match(/\/chart\/([^/?]+)/)?.[1] || null,
      tab_type: /\/chart\//.test(t.url) ? 'chart'
        : /screener/.test(t.url) ? 'screener'
        : 'other',
    }));

  return { success: true, tab_count: tabs.length, tabs };
}

/**
 * Open a new chart tab via keyboard shortcut (Ctrl+T / Cmd+T).
 */
export async function newTab() {
  const c = await getClient();

  // Electron/TradingView Desktop uses Ctrl+T for new tab on macOS too
  // But some versions use Cmd+T
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2; // 4 = meta (Cmd), 2 = ctrl

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 't',
    code: 'KeyT',
    windowsVirtualKeyCode: 84,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 't', code: 'KeyT' });

  await new Promise(r => setTimeout(r, 2000));

  // Verify a new tab appeared
  const state = await list();
  return { success: true, action: 'new_tab_opened', ...state };
}

/**
 * Close the current tab via keyboard shortcut (Ctrl+W / Cmd+W).
 */
export async function closeTab() {
  const before = await list();
  if (before.tab_count <= 1) {
    throw new Error('Cannot close the last tab. Use tv_launch to restart TradingView instead.');
  }

  const c = await getClient();
  const isMac = process.platform === 'darwin';
  const mod = isMac ? 4 : 2;

  await c.Input.dispatchKeyEvent({
    type: 'keyDown',
    modifiers: mod,
    key: 'w',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
  });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'w', code: 'KeyW' });

  await new Promise(r => setTimeout(r, 1000));

  const after = await list();
  return { success: true, action: 'tab_closed', tabs_before: before.tab_count, tabs_after: after.tab_count };
}

/**
 * Switch to a tab by index. Reconnects CDP to the new target.
 */
export async function switchTab({ index, chart_id, tab_id }) {
  const tabs = await list();

  let target;
  if (chart_id) {
    target = tabs.tabs.find(t => t.chart_id === chart_id);
    if (!target) throw new Error(`No tab found with chart_id "${chart_id}"`);
  } else if (tab_id) {
    target = tabs.tabs.find(t => t.id === tab_id);
    if (!target) throw new Error(`No tab found with tab_id "${tab_id}"`);
  } else {
    const idx = Number(index);
    if (idx >= tabs.tab_count) throw new Error(`Tab index ${idx} out of range (have ${tabs.tab_count} tabs)`);
    target = tabs.tabs[idx];
  }

  // Activate the tab visually in TradingView
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/activate/${target.id}`);
  if (!resp.ok) {
    throw new Error(`Failed to activate tab: HTTP ${resp.status}`);
  }

  // Reconnect CDP client to the new target so all subsequent tool calls run there
  await switchTarget(target.id);

  return {
    success: true,
    action: 'switched',
    index: target.index,
    tab_id: target.id,
    chart_id: target.chart_id,
    tab_type: target.tab_type,
    url: target.url,
  };
}
