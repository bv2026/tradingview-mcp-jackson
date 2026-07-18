/**
 * Core indicator settings logic.
 */
import { evaluate } from '../connection.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

export async function setInputs({ entity_id, inputs: inputsRaw }) {
  const inputs = inputsRaw ? (typeof inputsRaw === 'string' ? JSON.parse(inputsRaw) : inputsRaw) : undefined;
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length === 0) {
    throw new Error('inputs must be a non-empty object, e.g. { length: 50 }');
  }

  const escapedId = entity_id.replace(/'/g, "\\'");
  const inputsJson = JSON.stringify(inputs);

  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById('${escapedId}');
      if (!study) return { error: 'Study not found: ${escapedId}' };
      var currentInputs = study.getInputValues();
      if (!currentInputs || currentInputs.length === 0) {
        return { updated_inputs: {}, skipped: true, reason: 'getInputValues returned empty — indicator may be protected or still loading' };
      }
      var overrides = ${inputsJson};
      var updatedKeys = {};
      for (var i = 0; i < currentInputs.length; i++) {
        if (overrides.hasOwnProperty(currentInputs[i].id)) {
          currentInputs[i].value = overrides[currentInputs[i].id];
          updatedKeys[currentInputs[i].id] = overrides[currentInputs[i].id];
        }
      }
      study.setInputValues(currentInputs);
      return { updated_inputs: updatedKeys };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  return { success: true, entity_id, updated_inputs: result.updated_inputs };
}

/**
 * Set inputs on a protected LuxAlgo screener (one where getInputValues() returns []).
 * Builds a full input array from getInputsInfo() defvals, then applies overrides
 * for the ticker slots. Protected Lux screeners need their hidden/encrypted
 * fields preserved on each setInputValues call.
 *
 * overrides: { in_4: "BATS:X", in_8: "BATS:Y", ... }
 */
export async function setInputsFromInfo({ entity_id, overrides }) {
  if (!entity_id) throw new Error('entity_id is required');
  if (!overrides || Object.keys(overrides).length === 0) throw new Error('overrides must be non-empty');

  const escapedId = entity_id.replace(/'/g, "\\'");
  const overridesJson = JSON.stringify(overrides);
  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById('${escapedId}');
      if (!study) return { error: 'Study not found: ${escapedId}' };

      if (study.hasError && study.hasError()) {
        return { skipped: true, reason: 'indicator is in error state — delete and re-add it in TradingView' };
      }

      // Build input array from getInputsInfo() defaults — safe for protected indicators.
      // Skip system fields that must never be overwritten (breaks encrypted Lux screeners).
      var systemIds = ['text', 'pineId', 'pineVersion', 'pineFeatures'];
      var info = study.getInputsInfo();
      var safeInputs = [];
      for (var i = 0; i < info.length; i++) {
        var entry = info[i];
        if (systemIds.indexOf(entry.id) >= 0) continue;
        if (entry.defval === undefined) continue;
        safeInputs.push({ id: entry.id, value: entry.defval });
      }

      // Apply ticker overrides
      var overrides = ${overridesJson};
      for (var j = 0; j < safeInputs.length; j++) {
        if (overrides.hasOwnProperty(safeInputs[j].id)) {
          safeInputs[j].value = overrides[safeInputs[j].id];
        }
      }

      study.setInputValues(safeInputs);
      return { updated_inputs: overrides, inputs_sent: safeInputs.length };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  return { success: true, entity_id, ...result };
}

export async function toggleVisibility({ entity_id, visible }) {
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  if (typeof visible !== 'boolean') throw new Error('visible must be a boolean (true or false)');

  const escapedId = entity_id.replace(/'/g, "\\'");
  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var study = chart.getStudyById('${escapedId}');
      if (!study) return { error: 'Study not found: ${escapedId}' };
      study.setVisible(${visible});
      var actualVisible = study.isVisible();
      return { visible: actualVisible };
    })()
  `);

  if (result && result.error) throw new Error(result.error);
  return { success: true, entity_id, visible: result.visible };
}
