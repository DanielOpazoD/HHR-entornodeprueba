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
  const DEFAULT_API_ORIGIN = 'https://fichamedicoback.rayensalud.cl';
  const LIST_PATH = '/encounter/list/filter';
  const NURSING_ROUTE_RE = /^\/dashboard\/encounter-list-nurse(?:\/|$)/;
  const MEDICAL_LIST_ROUTE_RE = /^\/dashboard\/encounter-list\/?$/;
  const NURSING_CONTEXT_KEY = 'hhr:fichamedico:nursing-context';
  let capturedAuth = null;
  let capturedListUrl = null;
  const normalization = globalThis.HhrFichaMedicoNormalization;
  let capturedApiOrigin = null;
  let sessionBindingRevision = 0;
  let epicrisisCapture = null;
  const epicrisisPdfCandidates = new Map();

  const originalCreateObjectURL = typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL.bind(URL)
    : null;
  const originalWindowOpen = typeof window.open === 'function'
    ? window.open.bind(window)
    : null;
  const anchorPrototype = typeof HTMLAnchorElement !== 'undefined'
    ? HTMLAnchorElement.prototype
    : null;
  const originalAnchorClick = anchorPrototype && typeof anchorPrototype.click === 'function'
    ? anchorPrototype.click
    : null;
  const MAX_EPICRISIS_BASE64_LENGTH = 20 * 1024 * 1024;
  const publishEpicrisisCapture = (capture, value) => {
    if (!capture || !value) return;
    if (Math.ceil(Number(value.size || 0) / 3) * 4 > MAX_EPICRISIS_BASE64_LENGTH) {
      window.postMessage({
        type: 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT',
        reqId: capture.reqId,
        error: 'El PDF de alta es demasiado grande para corregirlo en la extensión.',
      }, window.location.origin);
      return;
    }
    value.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
      }
      window.postMessage({
        type: 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT',
        reqId: capture.reqId,
        pdfBase64: btoa(binary),
      }, window.location.origin);
    }).catch(error => {
      window.postMessage({
        type: 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT',
        reqId: capture.reqId,
        error: 'No se pudo leer el PDF oficial: ' + String((error && error.message) || error),
      }, window.location.origin);
    });
  };
  const consumeEpicrisisCandidate = url => {
    const key = String(url || '');
    const candidate = epicrisisPdfCandidates.get(key);
    if (!candidate || Date.now() >= candidate.expiresAt ||
        !epicrisisCapture || epicrisisCapture.reqId !== candidate.capture.reqId) return false;
    epicrisisPdfCandidates.delete(key);
    epicrisisCapture = null;
    try { URL.revokeObjectURL(key); } catch (_) {}
    publishEpicrisisCapture(candidate.capture, candidate.value);
    return true;
  };
  URL.createObjectURL = function (value) {
    if (!originalCreateObjectURL) {
      throw new TypeError('URL.createObjectURL no está disponible en este entorno.');
    }
    if (epicrisisCapture && Date.now() < epicrisisCapture.expiresAt &&
        value instanceof Blob && /application\/pdf/i.test(String(value.type || ''))) {
      const url = originalCreateObjectURL(value);
      epicrisisPdfCandidates.set(url, {
        capture: epicrisisCapture,
        value,
        expiresAt: Math.min(epicrisisCapture.expiresAt, Date.now() + 10_000),
      });
      window.setTimeout(() => {
        const candidate = epicrisisPdfCandidates.get(url);
        if (candidate && Date.now() >= candidate.expiresAt) epicrisisPdfCandidates.delete(url);
      }, 10_100);
      return url;
    }
    return originalCreateObjectURL(value);
  };
  window.open = function (url) {
    if (consumeEpicrisisCandidate(url)) return null;
    return originalWindowOpen ? originalWindowOpen.apply(window, arguments) : null;
  };
  if (anchorPrototype) {
    anchorPrototype.click = function () {
      if (consumeEpicrisisCandidate(this.href)) return;
      if (originalAnchorClick) return originalAnchorClick.apply(this, arguments);
    };
  }

  const rememberFromRequest = (url, authHeader) => {
    try {
      if (authHeader && String(url).includes(BACKEND_HINT)) {
        const nextAuth = String(authHeader);
        if (capturedAuth && capturedAuth !== nextAuth) {
          sessionBindingRevision += 1;
          capturedListUrl = null;
        }
        capturedAuth = nextAuth;
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
  // it is deliberately reduced here before crossing out of MAIN world. The token remains only in
  // this page's memory and is refreshed from Eloísa's own session endpoint after full route loads.
  const clearClinicalBinding = () => {
    sessionBindingRevision += 1;
    capturedAuth = null;
    capturedListUrl = null;
    capturedApiOrigin = null;
    try {
      sessionStorage.removeItem(NURSING_CONTEXT_KEY);
    } catch (_) {}
  };

  const resolveNursingContext = ({ facilityId, practitionerId, practitionerRoleId, role }) => {
    const identityKey = [facilityId, practitionerId, practitionerRoleId].join(':');
    const routeIsNursing = NURSING_ROUTE_RE.test(window.location.pathname || '');
    const routeIsMedicalList = MEDICAL_LIST_ROUTE_RE.test(window.location.pathname || '');
    const roleIsNursing = /enfermer/i.test(role);
    const roleIsMedical = /m[eé]dic/i.test(role);
    try {
      if ((routeIsMedicalList && !roleIsNursing) || (roleIsMedical && !routeIsNursing)) {
        sessionStorage.removeItem(NURSING_CONTEXT_KEY);
      } else if (roleIsNursing || (routeIsNursing && !roleIsMedical)) {
        sessionStorage.setItem(NURSING_CONTEXT_KEY, identityKey);
      }
      return (
        routeIsNursing ||
        roleIsNursing ||
        (!routeIsMedicalList &&
          !roleIsMedical &&
          sessionStorage.getItem(NURSING_CONTEXT_KEY) === identityKey)
      );
    } catch (_) {
      return routeIsNursing || roleIsNursing;
    }
  };

  // Concurrent callers share ONE in-flight verification. Without this, parallel module
  // requests (vitales + identificación + franja de paciente) bump `sessionBindingRevision`
  // against each other, the older call aborts with null and the user sees a spurious
  // "la sesión clínica cambió o venció" even though the session is healthy.
  let sessionIdentityInflight = null;
  const readSafeSessionIdentity = () => {
    if (sessionIdentityInflight) return sessionIdentityInflight;
    sessionIdentityInflight = readSafeSessionIdentityUncached().finally(() => {
      sessionIdentityInflight = null;
    });
    return sessionIdentityInflight;
  };

  const readSafeSessionIdentityUncached = async () => {
    const revision = ++sessionBindingRevision;
    try {
      const response = await origFetch('/api/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (revision !== sessionBindingRevision) return null;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) clearClinicalBinding();
        return null;
      }
      const payload = await response.json();
      if (revision !== sessionBindingRevision) return null;
      const session = payload && payload.ok !== false ? payload.session : null;
      const sessionToken = String((session && session.token) || '');
      if (!session || !sessionToken) {
        clearClinicalBinding();
        return null;
      }
      const facilityId = String(session.facilityId || '');
      const practitionerId = String(session.healthCarePractitionerId || '');
      const practitionerRoleId = String(session.healthCarePractitionerRoleId || '');
      if (!/^\d+$/.test(facilityId) || !/^\d+$/.test(practitionerId) || !/^\d+$/.test(practitionerRoleId)) {
        return null;
      }
      const role = normalization.normalizeSessionRole(session);
      const previousAuth = capturedAuth;
      const tokenMatchesCapturedAuth = !previousAuth || previousAuth === sessionToken;
      if (previousAuth && previousAuth !== sessionToken) capturedListUrl = null;
      capturedAuth = sessionToken;
      capturedApiOrigin = capturedApiOrigin || DEFAULT_API_ORIGIN;
      return {
        facilityId,
        practitionerId,
        practitionerRoleId,
        role,
        isNursing: resolveNursingContext({ facilityId, practitionerId, practitionerRoleId, role }),
        fullName: String(session.fullName || '').replace(/\s+/g, ' ').trim(),
        expiresAt: normalization.normalizeSessionExpiry(session, payload),
        tokenMatchesCapturedAuth,
      };
    } catch (_) {
      return null;
    }
  };

  const getVerifiedClinicalContext = async () => {
    const identity = await readSafeSessionIdentity();
    if (!capturedAuth || !capturedApiOrigin) {
      throw new Error('La sesión clínica de Eloísa no está disponible. Inicia sesión y reintenta.');
    }
    if (!identity || !identity.tokenMatchesCapturedAuth) {
      throw new Error('La sesión clínica cambió o venció. Inicia sesión nuevamente antes de continuar.');
    }
    const isNurse = identity.isNursing === true;
    let base = null;
    // A medical list URL may remain in memory after an SPA transition. Nursing views must always
    // use their three work-list endpoints, never a stale /encounter/list/filter request.
    if (isNurse) capturedListUrl = null;
    if (capturedListUrl && !isNurse) {
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
      base = new URL(LIST_PATH, capturedApiOrigin);
    }
    if (base) {
      base.searchParams.set('facilityId', identity.facilityId);
      base.searchParams.set('healthCarePractitionerId', identity.practitionerId);
      base.searchParams.set('healthCarePractitionerRoleId', identity.practitionerRoleId);
    }
    return { base, identity, apiOrigin: capturedApiOrigin, listSource: base ? 'medical' : 'nursing' };
  };

  // Prime and revalidate the in-memory binding whenever the SPA changes route or the tab becomes
  // active again. No token is persisted by the extension and Eloísa remains the authority on
  // expiration; a 401/403 clears the binding immediately.
  const refreshSessionBinding = () => {
    void readSafeSessionIdentity();
  };
  window.addEventListener('hhr:fichamedico-locationchange', refreshSessionBinding);
  window.addEventListener('pageshow', refreshSessionBinding);
  window.addEventListener('focus', refreshSessionBinding);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSessionBinding();
  });
  refreshSessionBinding();
  const headerUrl = (base, encId) =>
    `${base.origin}/api/encounter/patientHeaderData/${encId}/false`;
  const diagnosisUrl = (base, encId) =>
    `${base.origin}/api/encounter/entrySummary/diagnosisEntry/` +
    `${encId}/0/2/${base.searchParams.get('healthCarePractitionerId') || '7941'}`;
  const isolationUrl = (base, encId) => `${base.origin}/api/encounter/${encodeURIComponent(encId)}/isolationEncounter/0/getAll`;
  const readCensus = async () => {
    const context = await getVerifiedClinicalContext();
    const base = context.base || new URL(context.apiOrigin);
    const physicianCatalogPromise = (globalThis.HhrFichaMedicoTreatingPhysicianNormalization?.capture || (async () => ({ physicians: [], physicianById: {} })))({ apiGet, apiOrigin: context.apiOrigin, facilityId: context.identity.facilityId, auth: capturedAuth }).catch(() => ({ physicians: [], physicianById: {} }));
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
    const { physicians, physicianById } = await physicianCatalogPromise;
    // Keep a small concurrency ceiling: headers and diagnoses are independent, but the bridge
    // should not burst dozens of requests against Ficha Medico at once.
    const encounters = new Array(rows.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < rows.length) {
        const index = cursor++;
        const { item, discharged: isDischarged } = rows[index];
        const [headerResult, diagnosisResult, isolationResult] = await Promise.allSettled([
          apiGet(headerUrl(base, item.id), capturedAuth),
          apiGet(diagnosisUrl(base, item.id), capturedAuth),
          normalization.requiresIsolationDetails(item) ? apiGet(isolationUrl(base, item.id), capturedAuth) : Promise.resolve([]),
        ]);
        const header = headerResult.status === 'fulfilled' ? headerResult.value : null;
        const diagnosisRows = diagnosisResult.status === 'fulfilled' ? diagnosisResult.value : [];
        const isolationEntries = isolationResult.status === 'fulfilled' && Array.isArray(isolationResult.value)
          ? isolationResult.value : null;
        const itemWithIsolation = isolationEntries ? { ...item, isolationEntries } : item;
        const principalDiagnosis = normalization.selectPrincipalDiagnosis(
          diagnosisRows,
          header,
          itemWithIsolation
        );
        encounters[index] = normalization.normalizeEncounter(
          itemWithIsolation,
          header,
          principalDiagnosis,
          isDischarged, physicianById
        );
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, rows.length) }, () => worker()));

    return {
      capturedAt: new Date().toISOString(),
      facilityId: Number(context.identity.facilityId),
      isComplete: true, // filterType=3 + Servicio Todos covers the whole active census
      encounters, physicians,
    };
  };
  // --- Bridge with the isolated content script ---
  window.addEventListener('message', async event => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;

    if (data.type === 'RAYEN_EPICRISIS_PDF_CAPTURE_ARM') {
      const reqId = String(data.reqId || '');
      if (!/^[a-z0-9-]{8,80}$/i.test(reqId)) return;
      epicrisisCapture = { reqId, expiresAt: Date.now() + 30_000 };
      window.setTimeout(() => {
        if (!epicrisisCapture || epicrisisCapture.reqId !== reqId) return;
        epicrisisCapture = null;
        window.postMessage({
          type: 'RAYEN_EPICRISIS_PDF_CAPTURE_RESULT',
          reqId,
          error: 'Eloísa no generó el PDF de alta dentro del tiempo esperado.',
        }, window.location.origin);
      }, 30_100);
      return;
    }

    if (data.type === 'RAYEN_EPICRISIS_PDF_CAPTURE_CANCEL') {
      const reqId = String(data.reqId || '');
      if (epicrisisCapture && epicrisisCapture.reqId === reqId) epicrisisCapture = null;
      epicrisisPdfCandidates.forEach(function (candidate, url) {
        if (candidate.capture.reqId !== reqId) return;
        epicrisisPdfCandidates.delete(url);
      });
      return;
    }

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

    if (data.type === 'RAYEN_FM_SESSION_STATUS_REQUEST') {
      const identity = await readSafeSessionIdentity();
      const ready = Boolean(identity && capturedAuth && capturedApiOrigin);
      window.postMessage(
        {
          type: 'RAYEN_FM_SESSION_STATUS_RESULT',
          reqId: data.reqId,
          ready,
          identity: ready
            ? {
                fullName: identity.fullName,
                role: identity.role,
                practitionerId: identity.practitionerId,
                practitionerRoleId: identity.practitionerRoleId,
              }
            : null,
          message: ready
            ? 'Ficha Médico disponible. Sesión clínica vigente.'
            : 'La sesión clínica de Ficha Médico no está disponible.',
        },
        window.location.origin
      );
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
                isNursing: safeIdentity.isNursing,
                fullName: safeIdentity.fullName,
                expiresAt: safeIdentity.expiresAt,
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
