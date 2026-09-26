/** Select and code Rayen diagnoses without inferring clinical meaning from similar text. */
(function (root) {
  'use strict';

  const text = value => value == null ? '' : String(value).trim();
  const flag = value => value === true || value === 1 ||
    ['true', '1', 's', 'si', 'sí'].includes(text(value).toLowerCase());
  const classificationId = value => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  const comparableName = value => text(value)
    .replace(/\s*\((?:ingreso|solicitud hospitalizaci[oó]n)\)/gi, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase();
  const active = row => row && !flag(row.archived) && !flag(row.deleted) &&
    text(row.status).toLowerCase() !== 'inactivo';
  const firstText = (...values) => values.map(text).find(Boolean) || '';
  const admissionClassificationId = (header, item, admissionName, listName) =>
    classificationId(header.haoDiagId) ||
    (admissionName && comparableName(admissionName) === comparableName(listName)
      ? classificationId(item.diagnosisId) : null);

  const selectPrincipalDiagnosis = (rows, header, listItem) => {
    const principal = (Array.isArray(rows) ? rows : [])
      .find(row => active(row) && flag(row.isPrincipal));
    const h = header || {};
    const item = listItem || {};
    const principalName = text(h.principalDiagName);
    const admissionName = text(h.haoDiagName);
    const listName = text(item.diagnosisName);
    const listId = classificationId(item.diagnosisId);
    const admissionId = admissionClassificationId(h, item, admissionName, listName);

    if (principal) {
      return {
        name: firstText(principal.diagnosisName, principal.name, principal.description,
          principal.freeTextDiagnosis, principalName, admissionName, listName),
        code: text(principal.internalCode),
        classificationId: classificationId(principal.diagnosisClassifyId),
        source: 'principal-entry',
      };
    }
    if (principalName) {
      return {
        name: principalName,
        code: '',
        classificationId: classificationId(h.principalDiagId),
        source: 'principal-header',
      };
    }
    return {
      name: admissionName || listName,
      code: '',
      classificationId: admissionName ? admissionId : listId,
      source: 'admission',
    };
  };

  const cie10Code = value => {
    const code = text(value).toUpperCase();
    return /^[A-Z][0-9]{2}(?:\.[A-Z0-9]{1,4})?$/.test(code) ? code : '';
  };
  const indexDiagnosisCatalog = rows => {
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error('Eloísa no entregó el catálogo de diagnósticos.');
    }
    const codes = new Map();
    for (const row of rows) {
      const id = classificationId(row && row.id);
      const code = cie10Code(row && row.internalCode) || cie10Code(row && row.standarCode);
      if (id && code) codes.set(id, code);
    }
    return codes;
  };

  const createEnricher = readCatalog => {
    const pending = [];
    let catalogPromise = null;
    const catalog = () => {
      if (!catalogPromise) catalogPromise = Promise.resolve().then(readCatalog).catch(() => null);
      return catalogPromise;
    };
    return {
      queue(index, diagnosis) {
        if (diagnosis.code || !diagnosis.classificationId) return;
        pending.push({ index, diagnosis });
        void catalog();
      },
      async apply(encounters) {
        if (!pending.length) return;
        const codes = await catalog();
        if (!codes) return;
        for (const { index, diagnosis } of pending) {
          const code = codes.get(diagnosis.classificationId);
          if (!code || !encounters[index]) continue;
          encounters[index].diagnosisCode = code;
          encounters[index].diagnosisDescription = diagnosis.name;
        }
      },
    };
  };

  root.HhrFichaMedicoDiagnosisCoding = Object.freeze({
    selectPrincipalDiagnosis, indexDiagnosisCatalog, createEnricher,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
