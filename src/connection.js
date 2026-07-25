import CDP from 'chrome-remote-interface';

let client = null;
let targetInfo = null;
let connectPromise = null;
let runtimeQueue = Promise.resolve();
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

export async function getClient() {
  if (client) {
    try {
      // Quick liveness check
      await queueRuntime(async () => client.Runtime.evaluate({ expression: '1', returnByValue: true }));
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  if (connectPromise) return connectPromise;
  connectPromise = connect().finally(() => {
    connectPromise = null;
  });
  return connectPromise;
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findChartTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  // On initial connect, pick the first /chart/ target (index 0 = stocks chart by convention).
  // Use tab_switch after connect to move to a specific chart tab — that calls switchTarget()
  // which reconnects CDP to the correct target.
  return targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url))
    || null;
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const result = await queueRuntime(async () => c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    ...opts,
  }));
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

// Screener runs in a separate CDP target (tradingview.com/screener/ URL).
// This client is cached separately from the chart client.
let screenerClient = null;

// Screener targets are cached by CDP target ID.
const screenerClients = {};

async function findScreenerTarget(screenerRef) {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const screenerName = typeof screenerRef === 'string'
    ? screenerRef
    : screenerRef?.screener_name;
  const screenerId = typeof screenerRef === 'object'
    ? screenerRef?.screener_id
    : null;
  // TradingView uses /screener/ for stocks and /crypto-coins-screener/ (etc.) for other asset classes
  const screenerTargets = targets.filter(
    t => t.type === 'page' && /tradingview\.com\/.+-screener\/|tradingview\.com\/screener\//i.test(t.url)
  );
  if (!screenerTargets.length) return null;
  // Saved screener IDs are stable across restarts and window-title changes.
  if (screenerId) {
    const byId = screenerTargets.find(target => {
      try {
        return new URL(target.url).pathname.split('/').filter(Boolean).at(-1) === screenerId;
      } catch {
        return false;
      }
    });
    if (byId) return byId;
    return null;
  }
  // If a name is given, prefer the target whose title matches
  if (screenerName) {
    const match = screenerTargets.find(t => t.title === screenerName);
    if (match) return match;
  }
  // Fallback: return the first screener target found
  return screenerTargets[0];
}

export async function getScreenerClient(screenerRef) {
  // Find the right target first so we can key the cache by target ID
  const target = await findScreenerTarget(screenerRef);
  if (!target) return null;
  if (screenerClients[target.id]) {
    try {
      await screenerClients[target.id].Runtime.evaluate({ expression: '1', returnByValue: true });
      return screenerClients[target.id];
    } catch {
      delete screenerClients[target.id];
    }
  }
  const sc = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
  await sc.Runtime.enable();
  screenerClients[target.id] = sc;
  return sc;
}

export async function evaluateOnScreener(expression, screenerRef) {
  const sc = await getScreenerClient(screenerRef);
  if (!sc) return null;
  const result = await sc.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: false });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

/**
 * Reconnect CDP to a specific target by ID.
 * Called after tab_switch so all subsequent evaluate() calls go to the correct tab.
 */
export async function switchTarget(targetId) {
  // Close existing connection
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }

  // Fetch current target list to get full metadata for this ID
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  const target = targets.find(t => t.id === targetId);
  if (!target) {
    throw new Error(`Target ${targetId} not found in CDP target list`);
  }

  targetInfo = target;
  client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });
  await client.Runtime.enable();
  await client.Page.enable();
  await client.DOM.enable();

  return { target_id: target.id, url: target.url, title: target.title };
}

async function queueRuntime(task) {
  const run = runtimeQueue.then(task);
  runtimeQueue = run.catch(() => {});
  return run;
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}
