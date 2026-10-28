import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
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
export const hasSamePatchBaseValue = (left: unknown, right: unknown): boolean =>
  hasSameComparableValue(left, right) || (isEmptyNoteValue(left) && isEmptyNoteValue(right));
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

const BED_SLOT_FIELDS = new Set(['isBlocked', 'blockedReason']);
const BED_FIELD_PATH = /^beds\.([^.]+)(?:\.([^.]+))?/;

/** A field edit belongs to the occupant it was written for; a whole-bed value compares by value. */
export const assertSameOccupantAtPath = (
  path: string,
  writtenFor: DailyRecord,
  projection: DailyRecord
): void => {
  const match = BED_FIELD_PATH.exec(path);
  if (!match || BED_SLOT_FIELDS.has(match[2])) return;
  const [, bedId, field] = match;
  const writtenBed = writtenFor.beds?.[bedId];
  const projectedBed = projection.beds?.[bedId];
  if (
    hasSameBedOccupant(writtenBed, projectedBed) &&
    ((field && field !== 'clinicalCrib') ||
      hasSameBedOccupant(writtenBed?.clinicalCrib, projectedBed?.clinicalCrib))
  ) {
    return;
  }
  throw new ConcurrencyError(
    'La cama o la cuna cambió de paciente en otra pestaña. Recargue el censo antes de continuar.'
  );
};

/** A full snapshot may replace pending values only when its writer actually read them. */
export const assertPendingFullSaveBase = ({
  incoming,
  pending,
  base,
}: {
  incoming: DailyRecord;
  pending: SyncTask[];
  base?: DailyRecord;
}): void => {
  const reject = (): never => {
    throw new ConcurrencyError(
      'El censo cambió. Recargue y revise los cambios pendientes.',
      'semantic_conflict'
    );
  };
  const writes = pending.map(task => ({
    task,
    ids: new Set(
      [task.syncContract?.mutationId, ...(task.localProjectionBaseIds ?? [])].filter(Boolean)
    ),
  }));
  const incorporates = (next: (typeof writes)[number], previous: (typeof writes)[number]) =>
    previous.ids.size > 0 &&
    next.ids.size > previous.ids.size &&
    [...previous.ids].every(id => next.ids.has(id));
  const heads = writes.filter(write => !writes.some(other => incorporates(other, write)));
  for (const write of writes) {
    // Keep each ancestor's owned paths, but use their values after accepted local supersession.
    for (const { task } of heads.filter(head => head === write || incorporates(head, write))) {
      const current = task.payload as DailyRecord;
      if (!current || current.date !== incoming.date || (base && base.date !== incoming.date))
        reject();
      const paths = write.task.syncContract?.changedPaths;
      for (const path of paths?.length && !paths.includes('*')
        ? paths
        : Object.keys({ ...base, ...incoming, ...current })) {
        if (path === 'lastUpdated') continue;
        const value = getValueAtPath(current, path);
        const read = base && hasSamePatchBaseValue(value, getValueAtPath(base, path));
        assertSameOccupantAtPath(path, read ? base : incoming, current);
        if (!read && !hasSamePatchBaseValue(value, getValueAtPath(incoming, path))) reject();
      }
    }
  }
};
