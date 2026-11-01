const { iso } = require('./dailyRecordRestoreSource');
const { readClinicalDerivedLayout } = require('./clinicalDerivedContract');
const text = value => (typeof value === 'string' ? value : '');
const identity = (patient, bedId) => ({
  bedId,
  patientName: text(patient?.patientName),
  rut: text(patient?.rut),
  documentType: text(patient?.documentType),
  clinicalEpisodeId: text(patient?.clinicalEpisodeId),
});
const summarizeRestoreState = ({ record, docs }) => {
  const beds = Object.entries(record.beds);
  const occupied = beds.filter(([, patient]) => !patient.isBlocked && patient.patientName);
  const patients = [
    ...beds.flatMap(([, patient]) => [patient, patient.clinicalCrib]),
    ...['discharges', 'transfers', 'cma'].flatMap(field =>
      record[field]
        .filter(item => !item.deletedAt)
        .flatMap(item => [item.originalData, item.originalData?.clinicalCrib])
    ),
  ].filter(Boolean);
  const movements = field =>
    record[field]
      .filter(item => !item.deletedAt)
      .map(item => ({
        ...identity({ ...item.originalData, ...item }, text(item.bedId || item.bedName)),
        id: String(item.id ?? ''),
        date: text(item.movementDate),
        time: text(item.time),
      }));
  const layout = readClinicalDerivedLayout(record);
  return {
    lastUpdated: iso(record.lastUpdated),
    revision: Number(record.meta?.revision) || 0,
    occupiedBeds: occupied.map(([bedId, patient]) => identity(patient, bedId)),
    clinicalCribs: beds
      .filter(([, patient]) => patient.clinicalCrib?.patientName)
      .map(([bedId, patient]) => identity(patient.clinicalCrib, bedId)),
    discharges: movements('discharges'),
    transfers: movements('transfers'),
    cma: movements('cma'),
    episodeDocuments: docs.map(({ id, data }) => ({
      clinicalEpisodeId: id,
      lastUpdated: iso(data.updatedAt),
      currentGeneration:
        layout.status === 'marked' &&
        data.layoutGeneration === layout.layout.generation &&
        data.date === record.date,
    })),
    // Conservative: warn for every CUDYR or official discharge, even without a sanitization flag.
    warnings: [
      ...(record.cudyrLocked ||
      record.cudyrCompletedAt ||
      record.medicalSignature ||
      record.censusVerified ||
      record.verifiedAt
        ? ['El día tiene cierre, firma o verificación.']
        : []),
      ...(patients.some(patient => patient.cudyr || patient.evaluationScores?.cudyr)
        ? ['El día contiene CUDYR: puede incluir resultados saneados.']
        : []),
      ...(record.discharges.some(
        item => !item.deletedAt && (item.time || item.originalData?.dischargeVerification)
      )
        ? ['El día contiene altas con horas de egreso que pueden ser oficiales de Eloísa.']
        : []),
    ],
  };
};
module.exports = { summarizeRestoreState };
