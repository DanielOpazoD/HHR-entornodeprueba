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
  const isolationNormalization = globalThis.HhrFichaMedicoIsolationNormalization;
  const treatingPhysicianFields = (item, physicianById, physicianByEncounterId) => globalThis.HhrFichaMedicoTreatingPhysicianNormalization?.toEncounterFields(item, physicianById, physicianByEncounterId) || {};
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
      safeSession.expirationDate || safeSession.expirationDateTime || // expirationDate: campo real de Eloísa (02-09)
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

  const diagnosisCoding = globalThis.HhrFichaMedicoDiagnosisCoding;

  const normalizeEncounter = (item, header, principalDiagnosis, discharged, physicianById, physicianByEncounterId) => {
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
      ...isolationNormalization.toEncounterFields(safeItem),
      isGes: Boolean(safeItem.isGes), ...treatingPhysicianFields(safeItem, physicianById, physicianByEncounterId),
    };
  };

  return {
    requiresIsolationDetails: isolationNormalization.requiresIsolationDetails,
    normalizeEncounter,
    normalizeSessionExpiry,
    normalizeSessionRole,
    selectPrincipalDiagnosis: diagnosisCoding.selectPrincipalDiagnosis,
    indexDiagnosisCatalog: diagnosisCoding.indexDiagnosisCatalog,
    validClinicalDate,
  };
});
