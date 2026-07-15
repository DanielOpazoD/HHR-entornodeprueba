/**
 * inject-fichamedico.js  (MAIN world, document_start)
 *
 * Runs inside the Rayen Ficha Médico page. Wraps fetch/XHR to capture the opaque
 * `Authorization: HSP <token>` header (which lives only in the app's memory), then,
 * on request, reads the full census + discharges + per-patient demographics and
 * normalizes them to a `RayenCensusSnapshot` (the shape the HHR bridge validates).
 *
 * It talks to the isolated content script only via window.postMessage; the token
 * itself NEVER leaves this world — only the resulting snapshot does.
 */
(() => {
  'use strict';
  if (window.__rayenBridgeInjected) return;
  window.__rayenBridgeInjected = true;

  const BACKEND_HINT = 'rayensalud.cl';
  const LIST_PATH = '/encounter/list/filter';
  const DEFAULT_LIST_URL =
    'https://fichamedicoback.rayensalud.cl/api/encounter/list/filter' +
    '?facilityId=1342&healthCarePractitionerId=7941&healthCarePractitionerRoleId=1' +
    '&encounterEventTypeId=1&filterType=3&healthCarePractitionerTid=0';

  let capturedAuth = null;
  let capturedListUrl = null;
  const normalization = globalThis.HhrFichaMedicoNormalization;

  const rememberFromRequest = (url, authHeader) => {
    try {
      if (authHeader && String(url).includes(BACKEND_HINT)) capturedAuth = authHeader;
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
    return {
      encounterId: String(item.id),
      run: h.preferredIdentifierCode || p.identifier || '',
      firstGivenName: h.firstGivenName || '',
      nextGivenNames: h.nextGivenNames || '',
      firstFamilyName: h.firstFamilyName || '',
      secondFamilyName: h.secondFamilyName || '',
      birthDate: h.birthDate || p.birthDate || '',
      administrativeSex: h.adseName || '',
      gender: h.gendName || p.genero || '',
      service: item.hospitalDepartmentShortName || '',
      room: item.roomShortName || '',
      bed: item.bedShortName || '',
      admissionDatetime: h.encStartPeriod || item.startDatetime || '',
      diagnosis: principalDiagnosis.name,
      diagnosisCode: principalDiagnosis.code || undefined,
      diagnosisDescription: principalDiagnosis.code ? principalDiagnosis.name : undefined,
      hasMedicalDischarge: discharged || !!item.hasMedicalDischarge,
      hasNurseDischarge: !!item.hasNurseDischarge,
      dischargeDatetime: realDate(h.encEndPeriod) || realDate(item.medicalDischargeDateTime),
      isDead: !!item.isDead,
      isIsolated: !!item.isIsolated,
      isGes: !!item.isGes,
    };
  };

  const readCensus = async () => {
    if (!capturedAuth) {
      throw new Error(
        'No se capturó el token de Rayen. Abre o recarga la lista de pacientes en Ficha Médico y reintenta.'
      );
    }
    const base = new URL(capturedListUrl || DEFAULT_LIST_URL);
    const withFilter = ft => {
      const u = new URL(base);
      u.searchParams.set('filterType', ft);
      return u.toString();
    };

    // filterType=3 (sin médico + Servicio Todos) = full active census; filterType=2 = egresos.
    const [active, discharged] = await Promise.all([
      apiGet(withFilter('3'), capturedAuth),
      apiGet(withFilter('2'), capturedAuth).catch(() => []),
    ]);

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
      facilityId: Number(base.searchParams.get('facilityId')) || 1342,
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
      const base = new URL(capturedListUrl || DEFAULT_LIST_URL);
      window.postMessage(
        {
          type: 'RAYEN_FM_FETCHINFO_RESULT',
          reqId: data.reqId,
          info: capturedAuth
            ? {
                token: capturedAuth,
                apiOrigin: base.origin,
                facId: base.searchParams.get('facilityId') || '1342',
                practitionerId: base.searchParams.get('healthCarePractitionerId') || '7941',
              }
            : null,
          error: capturedAuth
            ? null
            : 'Sin token de Ficha Médico. Abre o recarga la lista de pacientes e inténtalo.',
        },
        window.location.origin
      );
      return;
    }
  });
})();
