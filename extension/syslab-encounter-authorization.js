/** Authorizes HHR-selected encounters before Syslab data is exposed. */
(function (root) {
  'use strict';

  const CENSUS_ALLOWLIST_TTL_MS = 5 * 60_000;
  const TRUSTED_HHR_ORIGINS = new Set([
    'http://localhost:3000',
    'http://localhost:3001',
    'https://testinghhr.netlify.app',
  ]);

  const create = dependencies => {
    const {
      getFichaFetchInfo,
      fichaSessionCacheKey,
      fetchActiveEncounterRows,
      resolveFichaEncounterId,
      normalizePatientRutBody,
      now = Date.now,
    } = dependencies || {};
    const censusAllowlistCache = new Map();

    const senderUrl = sender => String(sender?.tab?.url || sender?.url || '');
    const senderHasTrustedHhrOrigin = sender => {
      try {
        return TRUSTED_HHR_ORIGINS.has(new URL(senderUrl(sender)).origin);
      } catch (_error) {
        return false;
      }
    };

    const encounterInActiveCensus = async (encId, sender) => {
      const infoResult = await getFichaFetchInfo(sender);
      if (infoResult.error) return false;
      const sessionKey = await fichaSessionCacheKey(infoResult.info, sender);
      const cached = censusAllowlistCache.get(sessionKey);
      if (cached && now() - cached.at < CENSUS_ALLOWLIST_TTL_MS && cached.ids.has(encId)) {
        return true;
      }
      const rowResult = await fetchActiveEncounterRows(infoResult.info);
      if (rowResult.error) return false;
      const ids = new Set((rowResult.rows || []).map(row => String(row?.id || '')));
      censusAllowlistCache.set(sessionKey, { at: now(), ids });
      if (censusAllowlistCache.size > 12) {
        censusAllowlistCache.delete(censusAllowlistCache.keys().next().value);
      }
      return ids.has(encId);
    };

    const authorizeActive = async ({ encId, sender }) => {
      const id = String(encId || '');
      if (!/^\d+$/.test(id)) return { error: 'El episodio clínico no es válido.' };
      if (resolveFichaEncounterId(senderUrl(sender)) === id) return { ok: true };
      if (await encounterInActiveCensus(id, sender)) return { ok: true };
      return { error: 'El episodio solicitado no está en el censo de hospitalizados activo.' };
    };

    const preflight = async ({ encId, patientRut, sender }) => {
      if (!/^\d+$/.test(String(encId || ''))) {
        return { error: 'El episodio clínico no es válido.' };
      }
      const activeAuthorization = await authorizeActive({ encId, sender });
      if (!activeAuthorization.error) return activeAuthorization;

      const requestedRut = normalizePatientRutBody(patientRut);
      if (senderHasTrustedHhrOrigin(sender) && /^\d{5,9}$/.test(requestedRut)) {
        return { ok: true, requiresPatientIdentity: true, requestedRut };
      }
      return {
        error:
          'El episodio solicitado no está en el censo activo o no coincide con el RUN seleccionado.',
      };
    };

    const confirmPatientIdentity = ({ requestedRut, resolvedPatientRut }) =>
      requestedRut === normalizePatientRutBody(resolvedPatientRut)
        ? { ok: true, verifiedBy: 'patient-identity' }
        : {
            error:
              'El episodio solicitado no está en el censo activo o no coincide con el RUN seleccionado.',
          };

    const authorize = async request => {
      const eligibility = await preflight(request);
      if (eligibility.error || !eligibility.requiresPatientIdentity) return eligibility;
      return confirmPatientIdentity({
        requestedRut: eligibility.requestedRut,
        resolvedPatientRut: request.resolvedPatientRut,
      });
    };

    return Object.freeze({ authorize, authorizeActive, confirmPatientIdentity, preflight });
  };

  root.HhrSyslabEncounterAuthorization = Object.freeze({ create });
})(typeof globalThis !== 'undefined' ? globalThis : self);
