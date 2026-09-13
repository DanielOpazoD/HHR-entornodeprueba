/** Session-safe discharge queries across RUN and maternal RUN identifiers. */
(function (root) {
  'use strict';
  const SESSION_CHANGED = 'La sesión cambió durante la consulta. Reintenta la operación.';
  const create = dependencies => {
    const {
      resolveSession, classifyRejection, markSessionVerified,
      fetchWithTimeout, authorizeVerifiedEncounter,
    } = dependencies;
    const lookup = root.HhrGestionCamasEgresoLookup;
    const queryTarget = async (record, target) => {
      const rows = [];
      const seen = new Set();
      // Exact episodes may stop at RUN. Report-only days require BOTH populations:
      // a mother and her newborn can have distinct episodes on the same day.
      for (const identifierType of [2, 4]) {
        const url =
          `${record.apiBase}/facility/${record.facId}/encounter` +
          `?facId=0&prefferedIdentifierCode=${encodeURIComponent(target.run)}` +
          `&prefferedPeridentId=${identifierType}`;
        const response = await fetchWithTimeout(url, { headers: { Authorization: record.token } });
        if (!response.ok) {
          const rejection = await classifyRejection(response, record);
          return {
            error: rejection === 'changed' ? SESSION_CHANGED
              : rejection === 'expired' ? 'La sesión de Gestión de Camas venció. Vuelve a conectarla.'
                : rejection === 'forbidden' ? 'Gestión de Camas rechazó esta consulta por permisos.'
                  : 'HTTP ' + response.status,
            stop: rejection === 'expired' || rejection === 'changed',
          };
        }
        const payload = await response.json();
        if (!(await markSessionVerified(record))) return { error: SESSION_CHANGED, stop: true };
        if (target.encounterId) {
          const item = lookup.selectEncounter(payload, target.encounterId, target.dischargeDay);
          if (item) return { item };
        }
        // Only numeric episode identity can collapse duplicates; never collapse
        // different episodes by RUN/day or convert IDs through lossy Number().
        for (const row of Array.isArray(payload) ? payload : payload ? [payload] : []) {
          const id = lookup.encounterIdOf(row, '');
          if (/^\d+$/.test(id)) {
            const key = id.replace(/^0+(?=\d)/, '');
            if (seen.has(key)) continue;
            seen.add(key);
          }
          rows.push(row);
        }
      }
      return { item: lookup.selectEncounter(rows, target.encounterId, target.dischargeDay) };
    };
    const request = async (runs, targets, sender) => {
      const session = await resolveSession();
      if (!session.record) {
        return { error: session.error || 'Conecta Gestión de Camas para consultar egresos.' };
      }
      const record = session.record;
      if (!record.facId) return { error: 'Gestión de Camas no informó el establecimiento.' };
      const results = [];
      for (const target of lookup.normalizeTargets(runs, targets)) {
        const { run, encounterId } = target;
        try {
          const result = await queryTarget(record, target);
          if (result.error) {
            results.push({ run, error: result.error });
            if (result.stop) break;
            continue;
          }
          const selectedEncounterId = lookup.encounterIdOf(result.item, encounterId);
          if (result.item && /^\d+$/.test(selectedEncounterId)) {
            authorizeVerifiedEncounter(sender, selectedEncounterId);
          }
          results.push({
            run,
            encounterId: selectedEncounterId || encounterId,
            egreso: result.item ? lookup.pickMetadata(result.item) : null,
          });
        } catch (error) {
          results.push({ run, error: String((error && error.message) || error) });
        }
      }
      return { results };
    };
    return Object.freeze({ request });
  };
  root.HhrGestionCamasEgresoQueryRuntime = Object.freeze({ create });
})(typeof self !== 'undefined' ? self : globalThis);
