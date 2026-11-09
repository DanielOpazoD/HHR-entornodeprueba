/** Resolve the selected native care before constructing the five official report parameters. */
(function (root) {
  'use strict';
  const { fail, positiveId, sameId } = root.HhrUrgencyApi;
  const assertCare = (care, { attentionId, row, facilityId }) => {
    if (care?.IsDeleted || care?.IsEmergency !== true || !sameId(care?.Id, attentionId) ||
        !sameId(care?.IdPatient, row.Patient.Id) || !sameId(care?.IdEmergencyAdmission, row.Id) ||
        !sameId(care?.IdHealthCareCenter, facilityId)) fail('IDENTITY');
  };
  const create = ({ api, normalizeRun }) => {
    const read = async ({ patientRun, attentionId, session: auth, assertCurrent }) => {
      const options = { token: auth.token, assertCurrent };
      const query = new URLSearchParams({ Rut: patientRun, IdIdentificationType: '0' });
      const rows = await api.read(`/api/emergencyAdmissionsByPatient/?${query}`, options);
      if (!Array.isArray(rows)) fail('IDENTITY');
      const matches = rows.filter(row => !row?.IsDeleted && !row?.Patient?.IsDeleted &&
        !row?.PatientCare?.IsDeleted && normalizeRun(row?.Patient?.Rut) === patientRun &&
        sameId(row?.PatientCare?.Id, attentionId));
      if (matches.length !== 1) fail('IDENTITY');
      const row = matches[0];
      if (!sameId(row.IdFacility, auth.facilityId)) fail('FACILITY');
      if (!positiveId(row.Id) || !positiveId(row.Patient.Id)) fail('IDENTITY');
      const care = await api.read(`/api/healthCareCenter/${auth.facilityId}/emergencyAdmissions/${row.Id}/encounters/${attentionId}`, options);
      assertCare(care, { attentionId, row, facilityId: auth.facilityId });
      // Rayen's public report configuration uses TIME_DIFFERENCE=0; no date is inferred here.
      const report = new URLSearchParams({ timeDifference: '0', nodId: auth.facilityId,
        iurgId: String(row.Id), atenId: String(care.Id), uspId: String(row.Patient.Id) });
      return await api.read(`/api/reportes/DAU_C.pdf?${report}`, { ...options, pdf: true });
    };
    return { read };
  };
  root.HhrUrgencyDauApi = { create };
})(typeof self !== 'undefined' ? self : globalThis);
