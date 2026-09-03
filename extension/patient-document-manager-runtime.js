/** Read-only document repository for the patient behind a clinical encounter. */
(function (root) {
  'use strict';

  const assertFunction = (value, name) => {
    if (typeof value !== 'function') throw new Error(`Falta la dependencia ${name}.`);
    return value;
  };

  const isDeleted = row => {
    if (!row || typeof row !== 'object') return false;
    const value = row.deleted ?? row.isDeleted ?? row.DELETED;
    return value === true || value === 1 || String(value).toLowerCase() === 'true';
  };

  const stringValue = value => typeof value === 'string' ? value.trim() : '';

  // The document URL never crosses into HHR. This stable key is only used to ask the extension
  // to re-fetch and open the selected, still-authorized row.
  const documentKey = row => {
    const backendId = row && (
      row.id ?? row.evolutionaryId ?? row.evolutionary_id ?? row.documentId ?? row.idEvolutionary
    );
    return backendId !== undefined && backendId !== null && String(backendId).trim()
      ? `id:${String(backendId).trim()}`
      : null;
  };

  const create = dependencies => {
    const deps = dependencies || {};
    const tabs = deps.chrome && deps.chrome.tabs;
    const getClinicalReportContext = assertFunction(
      deps.getClinicalReportContext,
      'getClinicalReportContext'
    );
    const readJson = assertFunction(deps.readJson, 'readJson');
    const fetchClaims = assertFunction(deps.fetchClaims, 'fetchClaims');
    const hasClaim = assertFunction(deps.hasClaim, 'hasClaim');
    assertFunction(tabs && tabs.create, 'chrome.tabs.create');

    const readVisibleRows = async ({ encId, sender }) => {
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
        return { ok: false, error: 'Eloísa no entregó una lista válida de documentos del paciente.' };
      }
      const canViewClinical = hasClaim(claims, 'Ver_Repositorio_Documental_Clinico');
      const canViewAdministrative = hasClaim(
        claims,
        'Ver_Repositorio_Documental_Administrativo'
      );
      const rows = result.data
        .map(row => ({ row }))
        .filter(({ row }) => {
          if (!row || typeof row !== 'object' || isDeleted(row) || !documentKey(row)) return false;
          if (canViewClinical && canViewAdministrative) return true;
          const classId = Number(row.classId);
          return (canViewClinical && classId === 1) ||
            (canViewAdministrative && classId === 2);
        });
      return { ok: true, rows };
    };

    const list = async ({ encId, sender }) => {
      try {
        const result = await readVisibleRows({ encId, sender });
        if (!result.ok) return result;
        return {
          ok: true,
          documents: result.rows.map(({ row }) => ({
            id: documentKey(row),
            classification: stringValue(row.class_name) || 'Sin clasificación',
            fileName: stringValue(row.namefile) || 'Abrir archivo',
            name: stringValue(row.name) || 'Sin nombre',
            attachedBy: stringValue(row.hcp_created_name) || 'No informado',
            facility: stringValue(row.fac_name) || 'No informado',
            createdAt: stringValue(row.createdDatetime),
          })),
        };
      } catch (error) {
        const detail = String((error && error.message) || error || 'error desconocido');
        return { ok: false, error: `No se pudieron leer los documentos en Eloísa: ${detail}` };
      }
    };

    const openDocument = async ({ encId, documentId, sender }) => {
      try {
        const result = await readVisibleRows({ encId, sender });
        if (!result.ok) return { ...result, opened: false };
        const selected = result.rows.find(
          ({ row }) => documentKey(row) === String(documentId || '')
        );
        if (!selected) {
          return { ok: false, opened: false, error: 'El archivo ya no está disponible o autorizado.' };
        }
        const target = new URL(stringValue(selected.row.pathAzure));
        if (target.protocol !== 'https:') {
          return { ok: false, opened: false, error: 'Eloísa entregó una dirección de archivo no segura.' };
        }
        await tabs.create({ url: target.toString(), active: true });
        return { ok: true, opened: true };
      } catch (error) {
        return {
          ok: false,
          opened: false,
          error: 'No se pudo abrir el archivo: ' + String((error && error.message) || error),
        };
      }
    };

    const handleRequest = request => {
      if (request.operation === 'list') return list(request);
      if (request.operation === 'open-document') return openDocument(request);
      return Promise.resolve({ ok: false, error: 'La operación del Gestor documental no es válida.' });
    };

    return Object.freeze({ handleRequest, list, openDocument });
  };

  const api = Object.freeze({ create, isDeleted, documentKey });
  root.HhrPatientDocumentManagerRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
