/**
 * inject-gestioncamas.js  (MAIN world, document_start)
 *
 * Runs inside Eloísa Gestión de Camas (hospitalizado.rayensalud.cl). Wraps fetch/XHR to
 * capture the backend auth header (which the app attaches to hospbackend calls). Two uses:
 *   1. Look up the egreso (discharge) of one or more RUNs via the REST encounter endpoint —
 *      recovers definitive egresos that already vanished from Ficha Médico (the "late sync"
 *      gap). The RUN result is returned; the token stays in this world.
 *   2. Hand the token + API base to the background service worker so IT can download the bulk
 *      "Alta Administrativa" report (a binary Jasper .xls whose GET carries no CORS header, so
 *      only the background — via host_permissions — can fetch it). For this the token crosses
 *      into the extension's own context, but never leaves the machine.
 *
 * Endpoint (confirmed): GET {api_app}/facility/{facId}/encounter
 *   ?facId=0&prefferedIdentifierCode={RUN digits}&prefferedPeridentId=2   ("preffered" typo is Rayen's)
 *
 * It talks to the isolated content script only via window.postMessage.
 */
(() => {
  'use strict';
  if (window.__gcInjected) return;
  window.__gcInjected = true;

  const BACKEND_HINT = 'hospbackend.rayensalud.cl';
  let capturedAuth = null;
  let capturedAuthConnectionAttemptId = '';
  let activeConnectionAttemptId = '';
  let lastAnnouncedSessionKey = null;

  const announceCapturedSession = (auth, connectionAttemptId, attempt = 0) => {
    setTimeout(() => {
      const base = apiBase();
      const facId = facilityId();
      if ((!base || !/^\d+$/.test(facId)) && attempt < 8) {
        announceCapturedSession(auth, connectionAttemptId, attempt + 1);
        return;
      }
      const sessionKey = [auth, base, facId, connectionAttemptId].join('|');
      if (!base || !/^\d+$/.test(facId) || auth !== capturedAuth ||
          sessionKey === lastAnnouncedSessionKey) return;
      lastAnnouncedSessionKey = sessionKey;
      window.postMessage(
        {
          type: 'RAYEN_GC_SESSION_CAPTURED',
          info: { token: auth, apiBase: base, facId, connectionAttemptId },
        },
        window.location.origin
      );
    }, attempt === 0 ? 40 : 250);
  };

  const remember = (url, auth) => {
    try {
      if (auth && String(url).includes(BACKEND_HINT)) {
        capturedAuth = auth;
        capturedAuthConnectionAttemptId = activeConnectionAttemptId;
        return true;
      }
    } catch (_) {}
    return false;
  };

  const announceSuccessfulCapture = (url, auth, connectionAttemptId) => {
    if (!auth || auth !== capturedAuth || !String(url).includes(BACKEND_HINT)) return;
    // A generic backend response proves only that the credential was accepted for that route.
    // The background worker verifies the selected facility with its dedicated probe.
    announceCapturedSession(auth, connectionAttemptId);
  };

  // --- Wrap fetch (the app attaches the token here for backend calls) ---
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let observed = null;
    try {
      const url = typeof input === 'string' ? input : input && input.url;
      const headers = (init && init.headers) || (input && input.headers);
      let auth;
      if (headers instanceof Headers) auth = headers.get('Authorization');
      else if (headers) auth = headers['Authorization'] || headers['authorization'];
      if (remember(url, auth)) {
        observed = { url, auth, connectionAttemptId: activeConnectionAttemptId };
      }
    } catch (_) {}
    const request = origFetch.apply(this, arguments);
    if (!observed) return request;
    return request.then(response => {
      if (response && response.ok) {
        announceSuccessfulCapture(observed.url, observed.auth, observed.connectionAttemptId);
      }
      return response;
    });
  };

  // --- Wrap XHR too, for robustness ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gcUrl = url;
    this.__gcAuth = null;
    this.__gcConnectionAttemptId = '';
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (key, value) {
    try {
      if (String(key).toLowerCase() === 'authorization') {
        this.__gcAuth = value;
        this.__gcConnectionAttemptId = activeConnectionAttemptId;
        remember(this.__gcUrl, value);
      }
    } catch (_) {}
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__gcUrl && this.__gcAuth) {
      this.addEventListener('loadend', () => {
        if (this.status >= 200 && this.status < 300) {
          announceSuccessfulCapture(
            this.__gcUrl,
            this.__gcAuth,
            this.__gcConnectionAttemptId
          );
        }
      }, { once: true });
    }
    return origSend.apply(this, arguments);
  };

  // --- Config read from the app (non-sensitive) ---
  const apiBase = () => {
    try {
      return window.envConfig && window.envConfig.environment && window.envConfig.environment.api_app;
    } catch (_) {
      return null;
    }
  };
  const facilityId = () => {
    try {
      return localStorage.getItem('FAC_ID') || '';
    } catch (_) {
      return '';
    }
  };
  const normalizeRun = run => String(run || '').replace(/[^0-9kK]/g, '');

  // Forward every SCALAR field except patient identifiers — that covers all the discharge
  // metadata (id, periods, status, destination/type ids, flags) without dumping PHI or the
  // nested clinical sub-objects. The HHR side maps the destination to alta/traslado.
  const PHI_FIELDS = new Set([
    'patient', 'firstName', 'firstGivenName', 'nextGivenNames', 'lastName', 'firstFamilyName',
    'secondFamilyName', 'name', 'fullName', 'motherName', 'fatherName',
    'identifier', 'run', 'rut', 'preferredIdentifierCode', 'prefferedIdentifierCode',
    'birthDate', 'address', 'phone', 'email',
  ]);
  const pick = obj => {
    const out = {};
    if (obj && typeof obj === 'object') {
      for (const key of Object.keys(obj)) {
        if (PHI_FIELDS.has(key)) continue;
        const value = obj[key];
        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
          out[key] = value;
        }
      }
    }
    return out;
  };

  const getJson = async url => {
    const res = await origFetch(url, { headers: { Authorization: capturedAuth } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  };

  const lookupOne = async run => {
    const base = apiBase();
    if (!base) return { run, error: 'Sin URL de backend (envConfig).' };
    if (!capturedAuth) {
      return { run, error: 'Sin token de Gestión de Camas. Recarga la pestaña e inténtalo.' };
    }
    // Find the encounter by RUN → confirmed egreso (id, periods, status). This closes the
    // late-sync gap. The discharge DESTINATION (domicilio/traslado) is not exposed here as
    // JSON (only in the server-rendered Jasper report), so the HHR side records a plain
    // 'alta' by default; it still detects traslado/cma if a destination text ever appears.
    try {
      const encData = await getJson(
        `${base}/facility/${facilityId()}/encounter?facId=0&prefferedIdentifierCode=${normalizeRun(run)}&prefferedPeridentId=2`
      );
      const item = Array.isArray(encData) ? encData[0] : encData;
      return { run, egreso: item ? pick(item) : null };
    } catch (error) {
      return { run, error: String((error && error.message) || error) };
    }
  };

  const lookupEgresos = async runs => {
    const out = [];
    for (const run of Array.isArray(runs) ? runs : []) {
      try {
        out.push(await lookupOne(run));
      } catch (e) {
        out.push({ run, error: String((e && e.message) || e) });
      }
    }
    return out;
  };

  // --- Bridge with the isolated content script ---
  window.addEventListener('message', async event => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d) return;
    const reply = (type, extra) =>
      window.postMessage({ type, reqId: d.reqId, ...extra }, window.location.origin);

    if (d.type === 'RAYEN_GC_CONNECTION_ATTEMPT') {
      activeConnectionAttemptId = String(d.connectionAttemptId || '');
      if (d.rehydrated === true && activeConnectionAttemptId && capturedAuth) {
        // A new document may issue its bootstrap request before the isolated bridge returns.
        // Re-announce only on document rehydration; same-document renewals must wait for a new
        // observed credential. The background still performs the facility-bound verification.
        capturedAuthConnectionAttemptId = activeConnectionAttemptId;
        announceCapturedSession(capturedAuth, capturedAuthConnectionAttemptId);
      }
      return;
    }

    if (d.type === 'RAYEN_GC_LOOKUP_REQUEST') {
      try {
        reply('RAYEN_GC_LOOKUP_RESULT', { results: await lookupEgresos(d.runs) });
      } catch (error) {
        reply('RAYEN_GC_LOOKUP_RESULT', { error: String((error && error.message) || error) });
      }
      return;
    }
    // The bulk "Alta Administrativa" report is a binary Jasper .xls whose GET response carries
    // no Access-Control-Allow-Origin, so a page/content-script fetch is blocked (CORS). Hand
    // the captured token + API base to the background service worker, which downloads it
    // (host_permissions bypass CORS) and returns the bytes to HHR. Token stays in-extension.
    if (d.type === 'RAYEN_GC_FETCHINFO_REQUEST') {
      const requestedAttemptId = String(d.connectionAttemptId || '');
      if (
        requestedAttemptId !== activeConnectionAttemptId ||
        requestedAttemptId !== capturedAuthConnectionAttemptId
      ) {
        reply('RAYEN_GC_FETCHINFO_RESULT', {
          error: 'El intento de conexión cambió antes de leer la sesión.',
        });
        return;
      }
      reply(
        'RAYEN_GC_FETCHINFO_RESULT',
        capturedAuth
          ? { info: { token: capturedAuth, apiBase: apiBase(), facId: facilityId() } }
          : { error: 'Sin token de Gestión de Camas. Recarga la pestaña e inicia sesión.' }
      );
      return;
    }
  });
})();
