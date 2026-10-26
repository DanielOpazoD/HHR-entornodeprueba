import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { hasSameBedOccupant } from '@/services/storage/sync/bedOccupantIdentity';
import { hasSameNoteValue } from '@/services/storage/sync/dayTaskReplayGuard';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';

const NOTE_FIELDS = [
  'medicalHandoffEntries',
  'medicalHandoffNote',
  'medicalHandoffAudit',
  'clinicalEvents',
] as const;
const patientsInRecord = (record?: DailyRecord): PatientData[] =>
  Object.values(record?.beds ?? {}).flatMap(bed => [
    bed,
    ...(bed?.clinicalCrib ? [bed.clinicalCrib] : []),
  ]);
const isEmptyNoteValue = (value: unknown) =>
  value == null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0);
const hasSameNoteBase = (a: unknown, b: unknown) =>
  hasSameNoteValue(a, b) || (isEmptyNoteValue(a) && isEmptyNoteValue(b));
/** A carried note is an edit only when its writer actually read the stored note as its base. */
export const assertFullSaveNoteBase = (
  incoming: DailyRecord,
  stored?: DailyRecord,
  base?: DailyRecord
): void => {
  if (!stored) return;
  if (base && base.date !== incoming.date)
    throw new ConcurrencyError(
      'El registro pertenece a otra fecha clínica. Abra el día correcto antes de guardar.'
    );
  const storedPatients = patientsInRecord(stored);
  const basePatients = patientsInRecord(base);
  const incomingPatients = patientsInRecord(incoming);
  for (const patient of storedPatients) {
    if (
      incomingPatients.some(other => hasSameBedOccupant(patient, other)) ||
      NOTE_FIELDS.every(field => isEmptyNoteValue(patient[field]))
    )
      continue;
    const bases = basePatients.filter(other => hasSameBedOccupant(patient, other));
    if (
      bases.length !== 1 ||
      NOTE_FIELDS.some(field => !hasSameNoteBase(bases[0][field], patient[field]))
    )
      throw new ConcurrencyError(
        'La entrega del paciente cambió. Recargue y revísela antes de retirarlo del censo.'
      );
  }
  for (const patient of incomingPatients) {
    if (!patient || ![patient.clinicalEpisodeId, patient.rut, patient.patientName].some(Boolean))
      continue;
    const matches = storedPatients.filter(other => hasSameBedOccupant(patient, other));
    const bases = basePatients.filter(other => hasSameBedOccupant(patient, other));
    if (!matches.length) {
      const carriesNote = NOTE_FIELDS.some(field => !isEmptyNoteValue(patient[field]));
      if (carriesNote && (!base || bases.length > 0))
        throw new ConcurrencyError(
          'La nota corresponde a una copia anterior del paciente. Recargue y revise la entrega antes de guardar.'
        );
      continue;
    }
    for (const field of NOTE_FIELDS) {
      if (matches.every(other => hasSameNoteBase(patient[field], other[field]))) continue;
      if (
        matches.length !== 1 ||
        bases.length !== 1 ||
        !hasSameNoteBase(bases[0][field], matches[0][field])
      )
        throw new ConcurrencyError(
          'No se pudo comprobar que esta nota siga vigente. Recargue y revise la entrega médica antes de guardar.'
        );
    }
  }
};
