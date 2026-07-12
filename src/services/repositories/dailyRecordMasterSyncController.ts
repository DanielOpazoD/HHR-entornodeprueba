export const buildPatientMasterSeed = (input: {
  rut: string;
  fullName: string;
  birthDate?: string | null;
  forecast?: string | null;
  gender?: string | null;
  clinicalEpisodeId?: string | null;
}) => ({
  rut: input.rut,
  fullName: input.fullName,
  birthDate: input.birthDate ?? undefined,
  forecast: input.forecast ?? undefined,
  gender: input.gender ?? undefined,
  // Only set when present so a later stub write (e.g. discharge, which lacks the encId) merges
  // without clobbering a previously captured id.
  ...(input.clinicalEpisodeId ? { lastClinicalEpisodeId: input.clinicalEpisodeId } : {}),
});

export const buildIngresoRealtimeEvent = (input: {
  date: string;
  diagnosis?: string | null;
  bedName?: string | null;
}) => ({
  id: `${input.date}-ingreso-rt`,
  type: 'Ingreso' as const,
  date: input.date,
  diagnosis: input.diagnosis || 'S/D',
  bedName: input.bedName ?? undefined,
});

export const buildEgresoRealtimeEvent = (input: {
  date: string;
  diagnosis?: string | null;
  bedName?: string | null;
}) => ({
  id: `${input.date}-egreso-rt`,
  type: 'Egreso' as const,
  date: input.date,
  diagnosis: input.diagnosis || 'S/D',
  bedName: input.bedName ?? undefined,
});

export const buildTrasladoRealtimeEvent = (input: {
  date: string;
  diagnosis?: string | null;
  bedName?: string | null;
  receivingCenter?: string | null;
}) => ({
  id: `${input.date}-traslado-rt`,
  type: 'Traslado' as const,
  date: input.date,
  diagnosis: input.diagnosis || 'S/D',
  bedName: input.bedName ?? undefined,
  receivingCenter: input.receivingCenter ?? undefined,
});

export const buildDischargePatientMasterPatch = (input: {
  date: string;
  status?: string | null;
}) => ({
  lastDischarge: input.date,
  ...(input.status === 'Fallecido' ? { vitalStatus: 'Fallecido' as const } : {}),
});

export const buildAdmissionPatientMasterPatch = (date?: string | null) =>
  date ? { lastAdmission: date } : {};

export const buildAdmissionHospitalizationAppendPayload = (input: {
  rut: string;
  fullName: string;
  birthDate?: string | null;
  forecast?: string | null;
  gender?: string | null;
  date: string;
  diagnosis?: string | null;
  bedName?: string | null;
}) => ({
  patient: buildPatientMasterSeed({
    rut: input.rut,
    fullName: input.fullName,
    birthDate: input.birthDate,
    forecast: input.forecast,
    gender: input.gender,
  }),
  event: buildIngresoRealtimeEvent({
    date: input.date,
    diagnosis: input.diagnosis,
    bedName: input.bedName,
  }),
  extra: buildAdmissionPatientMasterPatch(input.date),
});

export const buildAdmissionHospitalizationSyncPlan = (patient: {
  rut?: string | null;
  patientName?: string | null;
  birthDate?: string | null;
  insurance?: string | null;
  biologicalSex?: string | null;
  admissionDate?: string | null;
  pathology?: string | null;
  bedId?: string | null;
}) => {
  if (!patient.rut || !patient.admissionDate) {
    return null;
  }

  return {
    appendPayload: buildAdmissionHospitalizationAppendPayload({
      rut: patient.rut,
      fullName: patient.patientName || '',
      birthDate: patient.birthDate,
      forecast: patient.insurance,
      gender: patient.biologicalSex,
      date: patient.admissionDate,
      diagnosis: patient.pathology,
      bedName: patient.bedId,
    }),
  };
};

export const buildDischargeHospitalizationAppendPayload = (input: {
  rut: string;
  fullName: string;
  forecast?: string | null;
  date: string;
  diagnosis?: string | null;
  bedName?: string | null;
  status?: string | null;
}) => ({
  patient: buildPatientMasterSeed({
    rut: input.rut,
    fullName: input.fullName,
    forecast: input.forecast,
  }),
  event: buildEgresoRealtimeEvent({
    date: input.date,
    diagnosis: input.diagnosis,
    bedName: input.bedName,
  }),
  extra: buildDischargePatientMasterPatch({
    date: input.date,
    status: input.status,
  }),
});

export const buildTransferHospitalizationAppendPayload = (input: {
  rut: string;
  fullName: string;
  date: string;
  diagnosis?: string | null;
  bedName?: string | null;
  receivingCenter?: string | null;
}) => ({
  patient: buildPatientMasterSeed({
    rut: input.rut,
    fullName: input.fullName,
  }),
  event: buildTrasladoRealtimeEvent({
    date: input.date,
    diagnosis: input.diagnosis,
    bedName: input.bedName,
    receivingCenter: input.receivingCenter,
  }),
});

export const resolveAdmissionBackfillAppendPayload = ({
  existingBedPatientRuts,
  rut,
  fullName,
  admissionDate,
  diagnosis,
  bedName,
}: {
  existingBedPatientRuts: Set<string>;
  rut?: string | null;
  fullName: string;
  admissionDate?: string | null;
  diagnosis?: string | null;
  bedName?: string | null;
}) => {
  if (!rut || existingBedPatientRuts.has(rut) || !admissionDate) {
    return null;
  }

  return buildAdmissionHospitalizationAppendPayload({
    rut,
    fullName,
    date: admissionDate,
    diagnosis,
    bedName,
  });
};

export const buildDischargeHospitalizationSyncPlan = ({
  existingBedPatientRuts,
  recordDate,
  discharge,
}: {
  existingBedPatientRuts: Set<string>;
  recordDate: string;
  discharge: {
    rut?: string | null;
    patientName: string;
    insurance?: string | null;
    diagnosis?: string | null;
    bedName?: string | null;
    status?: string | null;
    admissionDate?: string | null;
  };
}) => {
  if (!discharge.rut) {
    return null;
  }

  return {
    appendPayload: buildDischargeHospitalizationAppendPayload({
      rut: discharge.rut,
      fullName: discharge.patientName,
      forecast: discharge.insurance,
      date: recordDate,
      diagnosis: discharge.diagnosis,
      bedName: discharge.bedName,
      status: discharge.status,
    }),
    admissionBackfillPayload: resolveAdmissionBackfillAppendPayload({
      existingBedPatientRuts,
      rut: discharge.rut,
      fullName: discharge.patientName,
      admissionDate: discharge.admissionDate,
      diagnosis: discharge.diagnosis,
      bedName: discharge.bedName,
    }),
  };
};

export const buildTransferHospitalizationSyncPlan = ({
  existingBedPatientRuts,
  recordDate,
  transfer,
}: {
  existingBedPatientRuts: Set<string>;
  recordDate: string;
  transfer: {
    rut?: string | null;
    patientName: string;
    diagnosis?: string | null;
    bedName?: string | null;
    receivingCenter?: string | null;
    admissionDate?: string | null;
  };
}) => {
  if (!transfer.rut) {
    return null;
  }

  return {
    appendPayload: buildTransferHospitalizationAppendPayload({
      rut: transfer.rut,
      fullName: transfer.patientName,
      date: recordDate,
      diagnosis: transfer.diagnosis,
      bedName: transfer.bedName,
      receivingCenter: transfer.receivingCenter,
    }),
    admissionBackfillPayload: resolveAdmissionBackfillAppendPayload({
      existingBedPatientRuts,
      rut: transfer.rut,
      fullName: transfer.patientName,
      admissionDate: transfer.admissionDate,
      diagnosis: transfer.diagnosis,
      bedName: transfer.bedName,
    }),
  };
};
