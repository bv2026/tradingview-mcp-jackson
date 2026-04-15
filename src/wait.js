import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let lastBarSignature = null;
  let stableCount = 0;
  const normalizedSymbol = expectedSymbol ? String(expectedSymbol).toUpperCase() : null;
  const normalizedTf = normalizeResolution(expectedTf);

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        var spinner = document.querySelector('[class*="loader"]')
          || document.querySelector('[class*="loading"]')
          || document.querySelector('[data-name="loading"]');
        var isLoading = spinner && spinner.offsetParent !== null;
        var currentSymbol = '';
        var resolution = '';
        var barCount = -1;
        var lastBarTime = null;
        var apiReady = false;
        try {
          var chart = window.TradingViewApi && window.TradingViewApi._activeChartWidgetWV && window.TradingViewApi._activeChartWidgetWV.value();
          if (chart) {
            currentSymbol = chart.symbol();
            resolution = chart.resolution();
            var bars = chart._chartWidget && chart._chartWidget.model && chart._chartWidget.model().mainSeries().bars();
            if (bars && typeof bars.lastIndex === 'function' && typeof bars.valueAt === 'function') {
              barCount = typeof bars.size === 'function' ? bars.size() : -1;
              var last = bars.valueAt(bars.lastIndex());
              if (last) lastBarTime = last[0];
            }
            apiReady = true;
          }
        } catch(e) {}

        if (!currentSymbol) {
          var symbolEl = document.querySelector('[data-name="legend-source-title"]')
            || document.querySelector('[class*="title"] [class*="apply-common-tooltip"]');
          currentSymbol = symbolEl ? symbolEl.textContent.trim() : '';
        }

        return { isLoading: !!isLoading, apiReady: apiReady, barCount: barCount, lastBarTime: lastBarTime, currentSymbol: currentSymbol, resolution: resolution };
      })()
    `);

    if (!state) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Not ready if still loading
    if (state.isLoading) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    if (normalizedSymbol && state.currentSymbol && !String(state.currentSymbol).toUpperCase().includes(normalizedSymbol)) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    const currentTf = normalizeResolution(state.resolution);
    if (normalizedTf && currentTf && currentTf !== normalizedTf) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    const signature = `${state.barCount}:${state.lastBarTime}:${currentTf || ''}:${state.currentSymbol || ''}`;
    if (signature === lastBarSignature && state.barCount > 0 && state.apiReady) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarSignature = signature;

    if (stableCount >= 2) {
      return true;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — return true anyway, caller should verify
  return false;
}

function normalizeResolution(value) {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw;
  return raw.replace(/^1(?=[DWM]$)/, '');
}
