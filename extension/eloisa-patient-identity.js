/** Lossless official patient identifiers shared by Eloísa extension runtimes. */
(function (root) { 'use strict';
  const PLACEHOLDERS = new Set(['NN', 'N/N', 'SINRUT', 'SIN-RUT', 'SINRUN', 'SIN-RUN', 'NOINFORMADO', 'NO-INFORMADO']);
  const official = value => {
    const result = String(value || '').trim().toUpperCase();
    return PLACEHOLDERS.has(result.replace(/\s+/g, '')) ? '' : result;
  };
  const compactRun = value => official(value).replace(/[^0-9K]/g, '');
  const hasForeignLetter = value => {
    const result = official(value);
    return /[A-JL-Z]/.test(result) || result.slice(0, -1).includes('K');
  };
  const isValidRun = value => {
    const compact = compactRun(value);
    if (!/^\d{7,8}[0-9K]$/.test(compact) || hasForeignLetter(value)) return false;
    let sum = 0;
    let factor = 2;
    for (let index = compact.length - 2; index >= 0; index -= 1) {
      sum += Number(compact[index]) * factor;
      factor = factor === 7 ? 2 : factor + 1;
    }
    const expected = 11 - (sum % 11);
    return (expected === 11 ? '0' : expected === 10 ? 'K' : String(expected)) === compact.slice(-1);
  };
  const resolveDocumentType = ({
    identifier, explicit, typeIds = [], allowRunShape = false, requireExplicitRut = false,
  }) => {
    if (hasForeignLetter(identifier)) return 'Pasaporte';
    if (explicit === 'RUT' || explicit === 'Pasaporte') return explicit;
    const ids = typeIds.map(Number);
    if (ids.some(id => id === 9 || id === 10)) return 'Pasaporte';
    if (ids.some(id => id === 2 || id === 4)) return 'RUT';
    if (!ids.includes(3) && !requireExplicitRut && isValidRun(identifier)) return 'RUT';
    return allowRunShape && /^\d{7,8}[0-9K]$/.test(compactRun(identifier)) ? 'RUT' : undefined;
  };
  const documentTypeFromSources = (identifier, ...sources) => resolveDocumentType({
    identifier,
    typeIds: sources.filter(source => source && typeof source === 'object').flatMap(source => [
      source.prefferedPeridentId, source.preferredPeridentId,
      source.preferredIdentifierTypeId, source.peridentId,
    ]).filter(value => value != null),
  });
  const identifierTypes = documentType => documentType === 'RUT'
    ? [2, 4]
    : documentType === 'Pasaporte' ? [3, 9] : [2, 4, 3, 9];
  const queryIdentifier = (value, documentType) => documentType === 'RUT' || ([2, 4].includes(documentType) && /^(?:\d{1,2}(?:\.\d{3}){2}|\d{7,8})-[0-9K]$/i.test(official(value))) ? compactRun(value) : official(value);
  const normalizeLookupTarget = value => {
    const target = value && typeof value === 'object' ? value : { run: value };
    const raw = official(target.run);
    const documentType = resolveDocumentType({
      identifier: raw, explicit: target.documentType, requireExplicitRut: true,
    });
    const run = queryIdentifier(raw, documentType);
    return {
      run,
      queryIdentifier: run,
      identifierTypes: identifierTypes(documentType),
      encounterId: String(target.encounterId || '').trim(),
      ...(documentType ? { documentType } : {}),
      ...(documentType && ['RUT', 'Pasaporte'].includes(target.documentType)
        ? { confirmedDocumentType: documentType }
        : {}),
      ...(target.dischargeDay ? { dischargeDay: String(target.dischargeDay).trim() } : {}),
    };
  };
  const identityKey = (value, explicit) => {
    const documentType = resolveDocumentType({ identifier: value, explicit, allowRunShape: true });
    return queryIdentifier(value, documentType);
  };
  const display = (value, formatRun) => hasForeignLetter(value) ? official(value) : formatRun(value) || String(value || '');
  const isSearchable = (value, explicit) => {
    const documentType = resolveDocumentType({ identifier: value, explicit, allowRunShape: true });
    return documentType === 'RUT'
      ? /^\d{6,8}[0-9K]$/.test(compactRun(value))
      : documentType === 'Pasaporte' && /^[A-Z0-9][A-Z0-9.\/-]{2,63}$/.test(official(value));
  };
  const lookupFirstUnique = async ({ value, getJson, buildUrl }) => {
    const target = normalizeLookupTarget(value);
    for (const type of target.identifierTypes) {
      const payload = await getJson(buildUrl(target.queryIdentifier, type));
      const rows = Array.isArray(payload) ? payload : payload ? [payload] : [];
      if (rows.length === 1) return { run: target.run, item: rows[0] };
      if (rows.length > 1) return { run: target.run, item: null };
    }
    return { run: target.run, item: null };
  };
  const resolveReportRows = async request => {
    const requested = request.isEncounter(request.encId) ? String(request.encId) : '';
    const rowsByEncounter = new Map();
    for (const type of identifierTypes(resolveDocumentType({
      identifier: request.patientRun, explicit: request.patientDocumentType, allowRunShape: true,
    }))) {
      const result = await request.fetchRows(type);
      if (result.error) return result;
      const matches = request.matchingRows(
        result.rows, request.patientRun, request.patientDocumentType
      );
      if (requested && matches.some(row => String(row.encounterId) === requested)) return result;
      result.rows.forEach(row => {
        const id = String((row && row.encounterId) || '');
        if (request.isEncounter(id) && !rowsByEncounter.has(id)) rowsByEncounter.set(id, row);
      });
    }
    return { rows: [...rowsByEncounter.values()] };
  };
  root.HhrEloisaPatientIdentity = Object.freeze({
    display, documentTypeFromSources, identityKey, identifierTypes, isSearchable,
    lookupFirstUnique, normalizeLookupTarget,
    official, queryIdentifier, resolveDocumentType, resolveReportRows,
  });
})(typeof self !== 'undefined' ? self : globalThis);
