/**
 * Pure Ficha Medico normalization helpers shared by the MAIN-world reader and unit tests.
 * This file never performs network or storage operations.
 */
(function (root, factory) {
  const api = factory();
  root.HhrFichaMedicoNormalization = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const text = value => (value == null ? '' : String(value).trim());

  const record = value => value && typeof value === 'object' ? value : {};

  const normalizeSessionRole = session => {
    const safeSession = record(session);
    const candidates = [
      safeSession.role,
      safeSession.roleName,
      safeSession.profileName,
      safeSession.practitionerRoleName,
      safeSession.healthCarePractitionerRoleName,
      safeSession.healthCareRoleName,
    ];
    return text(candidates.find(value => typeof value === 'string' && value.trim()))
      .replace(/\s+/g, ' ');
  };

  const normalizeSessionExpiry = (session, payload) => {
    const safeSession = record(session);
    const safePayload = record(payload);
    const value = (
      safeSession.expiresAt ||
      safeSession.expires ||
      safeSession.expirationDateTime ||
      safeSession.expiration ||
      safePayload.expiresAt ||
      safePayload.expires
    );
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value <= 0) return null;
      return value > 10_000_000_000 ? Math.round(value) : Math.round(value * 1000);
    }
    const parsed = Date.parse(text(value));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const validClinicalDate = value => {
    const candidate = text(value);
    if (!candidate || Number(candidate.slice(0, 4)) <= 1) return undefined;
    return Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
  };

  const flag = value => {
    if (value === true || value === 1) return true;
    return ['true', '1', 's', 'si', 'sí'].includes(text(value).toLowerCase());
  };

  const isActiveDiagnosis = row =>
    Boolean(row) &&
    !flag(row.archived) &&
    !flag(row.deleted) &&
    text(row.status).toLowerCase() !== 'inactivo';

  /** Select the first active principal diagnosis exactly as ordered by Ficha Medico. */
  const selectPrincipalDiagnosis = (rows, header, listItem) => {
    const diagnoses = Array.isArray(rows) ? rows : [];
    const firstPrincipal = diagnoses.find(row => isActiveDiagnosis(row) && flag(row.isPrincipal));
    const fallbackHeader = header || {};
    const fallbackItem = listItem || {};

    const name = text(
      firstPrincipal &&
        (firstPrincipal.diagnosisName ||
          firstPrincipal.name ||
          firstPrincipal.description ||
          firstPrincipal.freeTextDiagnosis)
    );
    const headerName = text(fallbackHeader.principalDiagName);

    return {
      name: name || headerName || text(fallbackHeader.haoDiagName) || text(fallbackItem.diagnosisName),
      code: text(firstPrincipal && firstPrincipal.internalCode),
      source: firstPrincipal ? 'principal-entry' : headerName ? 'principal-header' : 'admission',
    };
  };

  const normalizeEncounter = (item, header, principalDiagnosis, discharged) => {
    const safeItem = record(item);
    const patient = record(safeItem.patient);
    const safeHeader = record(header);
    const diagnosis = record(principalDiagnosis);
    const fullName = text(safeItem.patientName || patient.patientName).replace(/\s+/g, ' ');
    return {
      encounterId: safeItem.id == null ? '' : String(safeItem.id),
      run: safeHeader.preferredIdentifierCode || patient.identifier || safeItem.patientIdentifier || '',
      firstGivenName: safeHeader.firstGivenName || fullName || '',
      nextGivenNames: safeHeader.nextGivenNames || '',
      firstFamilyName: safeHeader.firstFamilyName || '',
      secondFamilyName: safeHeader.secondFamilyName || '',
      birthDate: safeHeader.birthDate || patient.birthDate || safeItem.birthDate || '',
      administrativeSexId: safeHeader.adseId || safeItem.patientAdministrativeSexId || '',
      administrativeSex: safeHeader.adseName || '',
      gender: safeHeader.gendName || patient.genero || '',
      service: safeItem.hospitalDepartmentShortName || safeItem.hospitalDepartmentName || safeItem.serviceName || '',
      room: safeItem.roomShortName || safeItem.roomName || '',
      bed: safeItem.bedShortName || safeItem.bedName || '',
      hospitalDepartmentId: safeItem.hospitalDepartmentId || safeHeader.hospitalDepartmentId || '',
      nurseStationId: safeItem.nurseStationId || '',
      patientId: safeHeader.patID || safeItem.patientId || patient.id || '',
      admissionDatetime: safeHeader.encStartPeriod || safeItem.startDatetime || '',
      diagnosis: text(diagnosis.name),
      diagnosisCode: text(diagnosis.code) || undefined,
      diagnosisDescription: text(diagnosis.code) ? text(diagnosis.name) : undefined,
      hasMedicalDischarge: Boolean(discharged || safeItem.hasMedicalDischarge || safeItem.medicalDischarge),
      hasNurseDischarge: Boolean(safeItem.hasNurseDischarge),
      dischargeDatetime: validClinicalDate(safeHeader.encEndPeriod) ||
        validClinicalDate(safeItem.medicalDischargeDateTime),
      isDead: Boolean(safeItem.isDead),
      isIsolated: Boolean(safeItem.isIsolated),
      isGes: Boolean(safeItem.isGes),
    };
  };

  return {
    normalizeEncounter,
    normalizeSessionExpiry,
    normalizeSessionRole,
    selectPrincipalDiagnosis,
    validClinicalDate,
  };
});
