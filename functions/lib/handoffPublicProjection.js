const UPC_BED_IDS = new Set(['R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2']);

const pick = (value, fields) =>
  Object.fromEntries(
    fields.filter(field => value?.[field] !== undefined).map(field => [field, value[field]])
  );

const projectActor = actor => pick(actor, ['displayName']);

const projectMedicalEntry = entry => ({
  ...pick(entry, [
    'id',
    'specialty',
    'note',
    'originalNoteAt',
    'updatedAt',
    'currentStatus',
    'currentStatusDate',
    'currentStatusAt',
  ]),
  ...Object.fromEntries(
    ['originalNoteBy', 'updatedBy', 'currentStatusBy']
      .filter(field => entry?.[field])
      .map(field => [field, projectActor(entry[field])])
  ),
});

const projectMedicalAudit = audit => ({
  ...pick(audit, [
    'lastSpecialistUpdateAt',
    'lastSpecialistUpdateSpecialty',
    'originalNoteAt',
    'currentStatus',
    'currentStatusDate',
    'currentStatusAt',
    'currentStatusSpecialty',
  ]),
  ...Object.fromEntries(
    ['lastSpecialistUpdateBy', 'originalNoteBy', 'currentStatusBy']
      .filter(field => audit?.[field])
      .map(field => [field, projectActor(audit[field])])
  ),
});

const isUpcPatient = (bedId, patient) => {
  if (!UPC_BED_IDS.has(bedId)) return false;
  const checklist = patient?.upcChecklist;
  return Boolean(
    checklist?.uciCriteria?.length ||
    checklist?.utiCriteria?.length ||
    checklist?.classification ||
    patient?.isUPC
  );
};

const projectPatient = (bedId, patient, includeCrib = true) => ({
  ...pick(patient, [
    'isBlocked',
    'bedMode',
    'hasCompanionCrib',
    'patientName',
    'rut',
    'age',
    'pathology',
    'specialty',
    'status',
    'admissionDate',
    'admissionTime',
    'medicalHandoffNote',
  ]),
  bedId,
  isUPC: isUpcPatient(bedId, patient),
  ...(Array.isArray(patient.medicalHandoffEntries)
    ? { medicalHandoffEntries: patient.medicalHandoffEntries.map(projectMedicalEntry) }
    : {}),
  ...(patient.medicalHandoffAudit
    ? { medicalHandoffAudit: projectMedicalAudit(patient.medicalHandoffAudit) }
    : {}),
  ...(Array.isArray(patient.clinicalEvents)
    ? {
        clinicalEvents: patient.clinicalEvents.map(event =>
          pick(event, ['id', 'name', 'date', 'note', 'createdAt'])
        ),
      }
    : {}),
  ...(includeCrib && patient.clinicalCrib
    ? { clinicalCrib: projectPatient(bedId, patient.clinicalCrib, false) }
    : {}),
});

const projectSpecialtyNote = note => ({
  ...pick(note, ['note', 'createdAt', 'updatedAt', 'version']),
  ...(note.author ? { author: projectActor(note.author) } : {}),
  ...(note.lastEditor ? { lastEditor: projectActor(note.lastEditor) } : {}),
  ...(note.dailyContinuity
    ? {
        dailyContinuity: Object.fromEntries(
          Object.entries(note.dailyContinuity).map(([date, entry]) => [
            date,
            {
              ...pick(entry, ['status', 'confirmedAt', 'comment']),
              ...(entry.confirmedBy ? { confirmedBy: projectActor(entry.confirmedBy) } : {}),
            },
          ])
        ),
      }
    : {}),
});

const projectPublicMedicalHandoffRecord = (record, date, scope, signature) => {
  const beds = Object.fromEntries(
    Object.entries(record.beds || {})
      .filter(
        ([bedId, patient]) =>
          patient && (scope === 'all' || isUpcPatient(bedId, patient) === (scope === 'upc'))
      )
      .map(([bedId, patient]) => [bedId, projectPatient(bedId, patient)])
  );
  const sentAt =
    record.medicalHandoffSentAtByScope?.[scope] ||
    (scope === 'all' ? record.medicalHandoffSentAt : undefined);
  const publicSignature = signature ? pick(signature, ['doctorName', 'signedAt']) : null;

  return {
    ...pick(record, ['lastUpdated', 'medicalHandoffDoctor']),
    date,
    beds,
    activeExtraBeds: (record.activeExtraBeds || []).filter(bedId => Object.hasOwn(beds, bedId)),
    discharges: [],
    transfers: [],
    cma: [],
    ...(scope === 'all'
      ? {
          ...pick(record, ['medicalHandoffNovedades']),
          ...(record.medicalHandoffBySpecialty
            ? {
                medicalHandoffBySpecialty: Object.fromEntries(
                  Object.entries(record.medicalHandoffBySpecialty).map(([key, note]) => [
                    key,
                    projectSpecialtyNote(note),
                  ])
                ),
              }
            : {}),
        }
      : {}),
    ...(sentAt
      ? {
          medicalHandoffSentAtByScope: { [scope]: sentAt },
          ...(scope === 'all' ? { medicalHandoffSentAt: sentAt } : {}),
        }
      : {}),
    ...(publicSignature
      ? {
          medicalSignatureByScope: { [scope]: publicSignature },
          ...(scope === 'all' ? { medicalSignature: publicSignature } : {}),
        }
      : {}),
  };
};

module.exports = { projectPublicMedicalHandoffRecord };
