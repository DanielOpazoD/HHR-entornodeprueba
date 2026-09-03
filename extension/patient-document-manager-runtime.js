/**
 * Read-only patient document-manager runtime for the MV3 service worker.
 *
 * Resolves the patient behind an encounter before counting active attachments. Opening the
 * manager reuses the preferred Eloisa tab and adds a one-shot marker consumed by the relay.
 */
(function (root) {
  'use strict';

  const FICHAMEDICO_MATCH = 'https://fichamedico.rayensalud.cl/*';
  const OPEN_MARKER = 'hhrOpenDocumentManager';
  const ACK_TIMEOUT_MS = 17000;

  const assertFunction = (value, name) => {
    if (typeof value !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    return value;
  };

  const isDeleted = row => {
    if (!row || typeof row !== 'object') return false;
    const value = row.deleted ?? row.isDeleted ?? row.DELETED;
    return value === true || value === 1 || String(value).toLowerCase() === 'true';
  };

  const create = dependencies => {
    const deps = dependencies || {};
    const chromeApi = deps.chrome;
    const tabs = chromeApi && chromeApi.tabs;
    const windows = chromeApi && chromeApi.windows;
    const encounterNavigation = deps.encounterNavigation;
    const getClinicalReportContext = assertFunction(
      deps.getClinicalReportContext,
      'getClinicalReportContext'
    );
    const readJson = assertFunction(deps.readJson, 'readJson');
    const fetchClaims = assertFunction(deps.fetchClaims, 'fetchClaims');
    const hasClaim = assertFunction(deps.hasClaim, 'hasClaim');
    const pendingOpenRequests = new Map();
    if (!tabs) throw new Error('Falta la dependencia chrome.tabs.');
    ['query', 'update', 'create'].forEach(method =>
      assertFunction(tabs[method], `chrome.tabs.${method}`)
    );
    assertFunction(windows && windows.update, 'chrome.windows.update');
    assertFunction(
      encounterNavigation && encounterNavigation.normalizeEncounterId,
      'encounterNavigation.normalizeEncounterId'
    );
    assertFunction(
      encounterNavigation && encounterNavigation.orderEncounterTabs,
      'encounterNavigation.orderEncounterTabs'
    );
    assertFunction(
      encounterNavigation && encounterNavigation.buildEncounterUrl,
      'encounterNavigation.buildEncounterUrl'
    );

    const count = async ({ encId, sender }) => {
      try {
        const context = await getClinicalReportContext(encId, null, null, sender);
        if (context.error) return { ok: false, error: context.error };
        const [result, claims] = await Promise.all([
          readJson({
            info: context.info,
            path: `/api/evolutionary/${encodeURIComponent(context.patientId)}`,
            cache: 'no-store',
          }),
          fetchClaims(context.info),
        ]);
        if (claims.error) return { ok: false, error: claims.error };
        if (!Array.isArray(result.data)) {
          return {
            ok: false,
            error: 'Eloísa no entregó una lista válida de documentos del paciente.',
          };
        }
        const canViewClinical = hasClaim(claims, 'Ver_Repositorio_Documental_Clinico');
        const canViewAdministrative = hasClaim(
          claims,
          'Ver_Repositorio_Documental_Administrativo'
        );
        const visibleRows = result.data.filter(row => {
          if (isDeleted(row)) return false;
          if (canViewClinical && canViewAdministrative) return true;
          const classId = Number(row && row.classId);
          return (canViewClinical && classId === 1) || (canViewAdministrative && classId === 2);
        });
        return { ok: true, count: visibleRows.length };
      } catch (error) {
        const detail = String((error && error.message) || error || 'error desconocido');
        return { ok: false, error: `No se pudieron contar los documentos en Eloísa: ${detail}` };
      }
    };

    const open = async ({ encId, routeHint }) => {
      const normalizedEncounterId = encounterNavigation.normalizeEncounterId(encId);
      if (!normalizedEncounterId) {
        return { ok: false, opened: false, reused: false, error: 'El episodio clínico no es válido.' };
      }
      const requestId = `hhr-documents-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
      try {
        const matchingTabs = await tabs.query({ url: FICHAMEDICO_MATCH });
        const orderedTabs = encounterNavigation.orderEncounterTabs(matchingTabs);
        const existingTab = orderedTabs[0];
        const reused = Boolean(existingTab && existingTab.id != null);
        const target = new URL(
          encounterNavigation.buildEncounterUrl(
            normalizedEncounterId,
            existingTab && existingTab.url,
            routeHint
          )
        );
        target.searchParams.set(OPEN_MARKER, requestId);
        const acknowledgement = new Promise(resolve => {
          const timeoutId = setTimeout(() => {
            pendingOpenRequests.delete(requestId);
            resolve({
              ok: false,
              opened: false,
              error: 'Eloísa no confirmó la apertura del Gestor documental.',
            });
          }, ACK_TIMEOUT_MS);
          pendingOpenRequests.set(requestId, result => {
            clearTimeout(timeoutId);
            pendingOpenRequests.delete(requestId);
            resolve(result);
          });
        });
        const tab = reused
          ? await tabs.update(existingTab.id, { url: target.toString(), active: true })
          : await tabs.create({ url: target.toString(), active: true });
        if (tab && tab.windowId != null) {
          try {
            await windows.update(tab.windowId, { focused: true });
          } catch (_error) {
            // The manager is open; focusing its window is best-effort.
          }
        }
        const result = await acknowledgement;
        return { ...result, reused };
      } catch (error) {
        const settle = pendingOpenRequests.get(requestId);
        if (settle) settle({ ok: false, opened: false });
        return {
          ok: false,
          opened: false,
          reused: false,
          error: 'No se pudo abrir el Gestor documental: ' +
            String((error && error.message) || error),
        };
      }
    };

    const acknowledge = ({ requestId, opened, error, sender }) => {
      const senderUrl = String((sender && sender.url) || (sender && sender.tab && sender.tab.url) || '');
      if (!senderUrl.startsWith('https://fichamedico.rayensalud.cl/')) {
        return { ok: false, error: 'La confirmación no proviene de Ficha Médico.' };
      }
      const settle = pendingOpenRequests.get(String(requestId || ''));
      if (!settle) return { ok: false, error: 'La solicitud de apertura ya no está activa.' };
      const didOpen = opened === true;
      settle({
        ok: didOpen,
        opened: didOpen,
        ...(didOpen ? {} : { error: String(error || 'Eloísa no mostró el Gestor documental.') }),
      });
      return { ok: true };
    };

    const handleRequest = ({ encId, operation, routeHint, sender }) => {
      if (operation === 'count') return count({ encId, sender });
      if (operation === 'open') return open({ encId, routeHint });
      return Promise.resolve({ ok: false, error: 'La operación del Gestor documental no es válida.' });
    };

    return Object.freeze({ handleRequest, count, open, acknowledge });
  };

  const api = Object.freeze({ create, isDeleted, OPEN_MARKER });
  root.HhrPatientDocumentManagerRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
