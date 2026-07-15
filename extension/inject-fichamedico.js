/**
 * inject-fichamedico.js  (MAIN world, document_start)
 *
 * Runs inside the Rayen Ficha Médico page. Wraps fetch/XHR to capture the opaque
 * `Authorization: HSP <token>` header (which lives only in the app's memory), then,
 * on request, reads the full census + discharges + per-patient demographics and
 * normalizes them to a `RayenCensusSnapshot` (the shape the HHR bridge validates).
 *
 * It talks to the isolated content script only via window.postMessage. The captured token is
 * released only after session/identity verification, into the extension context on this device.
 */
(() => {
  'use strict';
  if (window.__rayenBridgeInjected) return;
  window.__rayenBridgeInjected = true;

  // React routing normally uses pushState/replaceState, which do not emit popstate. Surface a
  // DOM event so the isolated UI can invalidate any patient-bound modal before another action.
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function () {
      const result = original.apply(this, arguments);
      window.dispatchEvent(new CustomEvent('hhr:fichamedico-locationchange'));
      return result;
    };
  });

  const BACKEND_HINT = 'rayensalud.cl';
  const LIST_PATH = '/encounter/list/filter';
  let capturedAuth = null;
  let capturedListUrl = null;
  const normalization = globalThis.HhrFichaMedicoNormalization;
  let capturedApiOrigin = null;

  const rememberFromRequest = (url, authHeader) => {
    try {
      if (authHeader && String(url).includes(BACKEND_HINT)) {
        capturedAuth = authHeader;
        const parsed = new URL(String(url), window.location.origin);
        if (parsed.hostname === 'fichamedicoback.rayensalud.cl') capturedApiOrigin = parsed.origin;
      }
      if (url && String(url).includes(LIST_PATH)) capturedListUrl = String(url);
    } catch (_) {}
  };

  // --- Wrap fetch (the app uses fetch for backend calls) ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const headers = (init && init.headers) || (input && input.headers);
      let auth;
      if (headers instanceof Headers) auth = headers.get('Authorization');
      else if (headers) auth = headers['Authorization'] || headers['authorization'];
      rememberFromRequest(url, auth);
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  // --- Wrap XHR too, for robustness ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__rayenUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    try {
      if (String(key).toLowerCase() === 'authorization') rememberFromRequest(this.__rayenUrl, value);
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };

  // --- Helpers ---
  const apiGet = async (url, auth) => {
    // Auth is 100% via the HSP header; credentials:'omit' avoids the CORS credential trap.
    const res = await origFetch(url, { headers: { Authorization: auth }, credentials: 'omit' });
    if (!res.ok) throw new Error(res.status + ' en ' + url.replace(/\?.*/, ''));
    return res.json();
  };

  // Read only the non-secret clinical identity fields required to authorize writes. The full
  // session object can contain credentials and identifiers that the extension does not need, so
  // it is deliberately reduced here before crossing out of MAIN world.
  const readSafeSessionIdentity = async () => {
    try {
      const response = await origFetch('/api/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const payload = await response.json();
      const session = payload && payload.ok !== false ? payload.session : null;
      if (!session) return null;
      const facilityId = String(session.facilityId || '');
      const practitionerId = String(session.healthCarePractitionerId || '');
      const practitionerRoleId = String(session.healthCarePractitionerRoleId || '');
      if (!/^\d+$/.test(facilityId) || !/^\d+$/.test(practitionerId) || !/^\d+$/.test(practitionerRoleId)) {
        return null;
      }
      return {
        facilityId,
        practitionerId,
        practitionerRoleId,
        role: String(session.role || '').replace(/\s+/g, ' ').trim(),
        fullName: String(session.fullName || '').replace(/\s+/g, ' ').trim(),
        tokenMatchesCapturedAuth: Boolean(session.token) && String(session.token) === String(capturedAuth || ''),
      };
    } catch (_) {
      return null;
    }
  };

  const getVerifiedClinicalContext = async () => {
    if (!capturedAuth || !capturedApiOrigin) {
      throw new Error('Recarga Eloísa para vincular la sesión clínica actual.');
    }
    const identity = await readSafeSessionIdentity();
    if (!identity || !identity.tokenMatchesCapturedAuth) {
      throw new Error('La sesión clínica cambió o no pudo verificarse. Recarga Eloísa antes de continuar.');
    }
    const isNurse = /enfermer/i.test(identity.role);
    let base = null;
    if (capturedListUrl) {
      const candidate = new URL(capturedListUrl);
      if (!candidate.hostname.endsWith('.rayensalud.cl') || !candidate.pathname.includes(LIST_PATH)) {
        throw new Error('La lista clínica capturada no pertenece a Eloísa.');
      }
      const capturedFacility = String(candidate.searchParams.get('facilityId') || '');
      const capturedPractitioner = String(candidate.searchParams.get('healthCarePractitionerId') || '');
      const capturedRole = String(candidate.searchParams.get('healthCarePractitionerRoleId') || '');
      if (capturedFacility === identity.facilityId && capturedPractitioner === identity.practitionerId &&
          capturedRole === identity.practitionerRoleId) {
        base = candidate;
      } else if (!isNurse) {
        throw new Error('La lista abierta no corresponde a la identidad clínica actual. Recarga Eloísa.');
      }
    }
    if (!base && !isNurse) {
      throw new Error('Abre o recarga la lista de pacientes para vincular la sesión clínica actual.');
    }
    if (base) {
      base.searchParams.set('facilityId', identity.facilityId);
      base.searchParams.set('healthCarePractitionerId', identity.practitionerId);
      base.searchParams.set('healthCarePractitionerRoleId', identity.practitionerRoleId);
    }
    return { base, identity, apiOrigin: capturedApiOrigin, listSource: base ? 'medical' : 'nursing' };
  };

  const realDate = iso => {
    if (!iso) return undefined;
    const year = Number(String(iso).slice(0, 4));
    return year > 1 ? iso : undefined;
  };

  const headerUrl = (base, encId) =>
    `${base.origin}/api/encounter/patientHeaderData/${encId}/false`;

  const diagnosisUrl = (base, encId) =>
    `${base.origin}/api/encounter/entrySummary/diagnosisEntry/` +
    `${encId}/0/2/${base.searchParams.get('healthCarePractitionerId') || '7941'}`;

  const normalizeEncounter = (item, header, principalDiagnosis, discharged) => {
    const p = item.patient || {};
    const h = header || {};
    const fullName = String(item.patientName || p.patientName || '').replace(/\s+/g, ' ').trim();
    return {
      encounterId: String(item.id),
      run: h.preferredIdentifierCode || p.identifier || item.patientIdentifier || '',
      firstGivenName: h.firstGivenName || fullName || '',
      nextGivenNames: h.nextGivenNames || '',
      firstFamilyName: h.firstFamilyName || '',
      secondFamilyName: h.secondFamilyName || '',
      birthDate: h.birthDate || p.birthDate || item.birthDate || '',
      administrativeSexId: h.adseId || item.patientAdministrativeSexId || '',
      administrativeSex: h.adseName || '',
      gender: h.gendName || p.genero || '',
      service: item.hospitalDepartmentShortName || item.hospitalDepartmentName || item.serviceName || '',
      room: item.roomShortName || item.roomName || '',
      bed: item.bedShortName || item.bedName || '',
      hospitalDepartmentId: item.hospitalDepartmentId || h.hospitalDepartmentId || '',
      nurseStationId: item.nurseStationId || '',
      patientId: h.patID || item.patientId || p.id || '',
      admissionDatetime: h.encStartPeriod || item.startDatetime || '',
      diagnosis: principalDiagnosis.name,
      diagnosisCode: principalDiagnosis.code || undefined,
      diagnosisDescription: principalDiagnosis.code ? principalDiagnosis.name : undefined,
      hasMedicalDischarge: discharged || !!item.hasMedicalDischarge || !!item.medicalDischarge,
      hasNurseDischarge: !!item.hasNurseDischarge,
      dischargeDatetime: realDate(h.encEndPeriod) || realDate(item.medicalDischargeDateTime),
      isDead: !!item.isDead,
      isIsolated: !!item.isIsolated,
      isGes: !!item.isGes,
    };
  };

  const readCensus = async () => {
    const context = await getVerifiedClinicalContext();
    const base = context.base || new URL(context.apiOrigin);
    const withFilter = ft => {
      const u = new URL(base);
      u.searchParams.set('filterType', ft);
      return u.toString();
    };

    // filterType=3 (sin médico + Servicio Todos) = full active census; filterType=2 = egresos.
    let active;
    let discharged;
    if (context.listSource === 'nursing') {
      const lists = await Promise.all(
        ['noveltyNurseList', 'uneventfulNurseList', 'incomeNurseList'].map(list =>
          apiGet(
            `${context.apiOrigin}/api/encounter/${list}/${encodeURIComponent(context.identity.facilityId)}`,
            capturedAuth
          )
        )
      );
      const byEncounter = new Map();
      lists.flat().forEach(item => {
        if (item && item.id != null) byEncounter.set(String(item.id), item);
      });
      active = [...byEncounter.values()];
      discharged = [];
    } else {
      [active, discharged] = await Promise.all([
        apiGet(withFilter('3'), capturedAuth),
        apiGet(withFilter('2'), capturedAuth).catch(() => []),
      ]);
    }

    const rows = [
      ...(Array.isArray(active) ? active : []).map(item => ({ item, discharged: false })),
      ...(Array.isArray(discharged) ? discharged : []).map(item => ({ item, discharged: true })),
    ];

    // Keep a small concurrency ceiling: headers and diagnoses are independent, but the bridge
    // should not burst dozens of requests against Ficha Medico at once.
    const encounters = new Array(rows.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        const { item, discharged: isDischarged } = rows[index];
        const [headerResult, diagnosisResult] = await Promise.allSettled([
          apiGet(headerUrl(base, item.id), capturedAuth),
          apiGet(diagnosisUrl(base, item.id), capturedAuth),
        ]);
        const header = headerResult.status === 'fulfilled' ? headerResult.value : null;
        const diagnosisRows = diagnosisResult.status === 'fulfilled' ? diagnosisResult.value : [];
        const principalDiagnosis = normalization.selectPrincipalDiagnosis(
          diagnosisRows,
          header,
          item
        );
        encounters[index] = normalizeEncounter(item, header, principalDiagnosis, isDischarged);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, rows.length) }, () => worker()));

    return {
      capturedAt: new Date().toISOString(),
      facilityId: Number(context.identity.facilityId),
      isComplete: true, // filterType=3 + Servicio Todos covers the whole active census
      encounters,
    };
  };

  // --- Bridge with the isolated content script ---
  window.addEventListener('message', async event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;

    if (data.type === 'RAYEN_EXT_READ_REQUEST') {
      const reqId = data.reqId;
      try {
        const snapshot = await readCensus();
        window.postMessage({ type: 'RAYEN_EXT_READ_RESULT', reqId, snapshot }, window.location.origin);
      } catch (error) {
        window.postMessage(
          { type: 'RAYEN_EXT_READ_RESULT', reqId, error: String((error && error.message) || error) },
          window.location.origin
        );
      }
      return;
    }

    // Hand the captured token + backend origin + facility to the background so IT can download
    // the per-patient "Resumen diario paciente" PDF (which carries the invasive-devices table)
    // bypassing CORS. Token crosses into the extension's own context, never leaves the machine.
    if (data.type === 'RAYEN_FM_FETCHINFO_REQUEST') {
      let context = null;
      let contextError = '';
      try {
        context = await getVerifiedClinicalContext();
      } catch (error) {
        contextError = String((error && error.message) || error);
      }
      const base = context && context.base;
      const safeIdentity = context && context.identity;
      window.postMessage(
        {
          type: 'RAYEN_FM_FETCHINFO_RESULT',
          reqId: data.reqId,
          info: context
            ? {
                token: capturedAuth,
                apiOrigin: context.apiOrigin,
                listUrl: base ? base.toString() : '',
                listSource: context.listSource,
                facId: safeIdentity.facilityId,
                practitionerId: safeIdentity.practitionerId,
                practitionerRoleId: safeIdentity.practitionerRoleId,
                role: safeIdentity.role,
                fullName: safeIdentity.fullName,
                identityVerified: true,
              }
            : null,
          error: context ? null : contextError || 'No se pudo verificar la sesión de Ficha Médico.',
        },
        window.location.origin
      );
      return;
    }
  });
})();
