import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  applyDailyRecordClinicalConsistencyCheck,
  type DailyRecordClinicalConsistencyContext,
} from '@/services/repositories/dailyRecordClinicalConsistencyCheck';
import { shouldPreserveLocalPatientNarrative } from '@/services/repositories/patientEpisodeNarrativePolicy';
import { buildMedicalHandoffSummary } from '@/domain/handoff/specialty';
import { findActiveMovementLineageConflicts } from '@/application/census/movementReclassificationConcurrencyPolicy';

const MOVEMENT_FIELDS = ['discharges', 'transfers', 'cma'] as const;
const HANDOFF_NOTE_FIELDS = ['handoffNoteDayShift', 'handoffNoteNightShift'] as const;

type MovementField = (typeof MOVEMENT_FIELDS)[number];
type HandoffNoteField = (typeof HANDOFF_NOTE_FIELDS)[number];

export type DailyRecordConflictPostMergeInvariantViolationType =
  | 'movement_missing_after_merge'
  | 'movement_tombstone_revived'
  | 'movement_lineage_classified_twice'
  | 'duplicate_active_patient_after_merge'
  | 'handoff_note_missing_after_merge'
  | 'medical_handoff_entry_missing_after_merge'
  | 'medical_handoff_entry_cross_episode_after_merge';

export interface DailyRecordConflictPostMergeInvariantViolation {
  type: DailyRecordConflictPostMergeInvariantViolationType;
  path: string;
  message: string;
}

export interface DailyRecordConflictPostMergeInvariantResult {
  record: DailyRecord;
  status: 'ok' | 'blocked';
  violations: DailyRecordConflictPostMergeInvariantViolation[];
}

interface EvaluateDailyRecordConflictPostMergeInvariantsInput {
  remote: DailyRecord;
  local: DailyRecord;
  resolved: DailyRecord;
  context: DailyRecordClinicalConsistencyContext;
}

type MovementLike = {
  id?: string | number;
  deletedAt?: unknown;
  patientName?: unknown;
};

type MedicalHandoffEntryLike = {
  id?: string | number;
  note?: unknown;
  specialty?: unknown;
};

const normalizeId = (value: unknown): string => String(value || '').trim();

const isDeletedMovement = (movement: MovementLike | undefined): boolean =>
  Boolean(String(movement?.deletedAt || '').trim());

const hasText = (value: unknown): boolean => String(value || '').trim().length > 0;

const getMovementItems = (record: DailyRecord, field: MovementField): MovementLike[] =>
  Array.isArray(record[field]) ? (record[field] as unknown as MovementLike[]) : [];

const getMedicalHandoffEntries = (
  patient: DailyRecord['beds'][string] | undefined
): MedicalHandoffEntryLike[] =>
  Array.isArray(patient?.medicalHandoffEntries)
    ? (patient.medicalHandoffEntries as unknown as MedicalHandoffEntryLike[])
    : [];

const collectById = (record: DailyRecord, field: MovementField): Map<string, MovementLike> => {
  const items = new Map<string, MovementLike>();
  getMovementItems(record, field).forEach(item => {
    const id = normalizeId(item.id);
    if (id) {
      items.set(id, item);
    }
  });
  return items;
};

const describeMovement = (movement: MovementLike | undefined, id: string): string => {
  const patientName = String(movement?.patientName || '').trim();
  return patientName ? `${patientName} (${id})` : id;
};

const collectMovementInvariantViolations = ({
  remote,
  local,
  resolved,
}: Pick<
  EvaluateDailyRecordConflictPostMergeInvariantsInput,
  'remote' | 'local' | 'resolved'
>): DailyRecordConflictPostMergeInvariantViolation[] => {
  const violations: DailyRecordConflictPostMergeInvariantViolation[] = [];

  MOVEMENT_FIELDS.forEach(field => {
    const remoteById = collectById(remote, field);
    const localById = collectById(local, field);
    const resolvedById = collectById(resolved, field);
    const ids = new Set([...remoteById.keys(), ...localById.keys()]);

    ids.forEach(id => {
      const remoteMovement = remoteById.get(id);
      const localMovement = localById.get(id);
      const resolvedMovement = resolvedById.get(id);
      const sourceHasTombstone =
        isDeletedMovement(remoteMovement) || isDeletedMovement(localMovement);

      if (sourceHasTombstone) {
        if (!isDeletedMovement(resolvedMovement)) {
          violations.push({
            type: 'movement_tombstone_revived',
            path: `${field}.${id}`,
            message: `El movimiento eliminado ${describeMovement(
              remoteMovement ?? localMovement,
              id
            )} reaparecio activo tras el merge.`,
          });
        }
        return;
      }

      if (!resolvedMovement || isDeletedMovement(resolvedMovement)) {
        violations.push({
          type: 'movement_missing_after_merge',
          path: `${field}.${id}`,
          message: `El movimiento visible ${describeMovement(
            remoteMovement ?? localMovement,
            id
          )} desaparecio tras el merge.`,
        });
      }
    });
  });

  return violations;
};

const collectMovementLineageInvariantViolations = (
  record: DailyRecord
): DailyRecordConflictPostMergeInvariantViolation[] =>
  findActiveMovementLineageConflicts(record).map(conflict => ({
    type: 'movement_lineage_classified_twice',
    path: `movements.lineage.${conflict.lineageId}`,
    message: `El mismo egreso quedó activo en más de una clasificación (${conflict.classifications.join(
      ', '
    )}).`,
  }));

const describePatient = (
  patient: DailyRecord['beds'][string] | undefined,
  bedId: string
): string => {
  const patientName = String(patient?.patientName || '').trim();
  const rut = String(patient?.rut || '').trim();
  if (patientName && rut) return `${patientName} (${rut}) en ${bedId}`;
  if (patientName) return `${patientName} en ${bedId}`;
  return bedId;
};

const collectHandoffNoteInvariantViolations = ({
  remote,
  local,
  resolved,
}: Pick<
  EvaluateDailyRecordConflictPostMergeInvariantsInput,
  'remote' | 'local' | 'resolved'
>): DailyRecordConflictPostMergeInvariantViolation[] => {
  const violations: DailyRecordConflictPostMergeInvariantViolation[] = [];
  const bedIds = new Set([
    ...Object.keys(remote.beds || {}),
    ...Object.keys(local.beds || {}),
    ...Object.keys(resolved.beds || {}),
  ]);

  bedIds.forEach(bedId => {
    const resolvedPatient = resolved.beds?.[bedId];
    const sources = [remote.beds?.[bedId], local.beds?.[bedId]];

    HANDOFF_NOTE_FIELDS.forEach((field: HandoffNoteField) => {
      const resolvedHasNote = hasText(resolvedPatient?.[field]);
      sources.forEach(sourcePatient => {
        if (!hasText(sourcePatient?.[field])) return;
        if (!shouldPreserveLocalPatientNarrative(sourcePatient, resolvedPatient)) return;
        if (resolvedHasNote) return;

        violations.push({
          type: 'handoff_note_missing_after_merge',
          path: `beds.${bedId}.${field}`,
          message: `La nota de entrega ${field} de ${describePatient(
            sourcePatient,
            bedId
          )} desaparecio tras el merge.`,
        });
      });
    });
  });

  return violations;
};

const collectMedicalHandoffEntryInvariantViolations = ({
  remote,
  local,
  resolved,
}: Pick<
  EvaluateDailyRecordConflictPostMergeInvariantsInput,
  'remote' | 'local' | 'resolved'
>): DailyRecordConflictPostMergeInvariantViolation[] => {
  const violations: DailyRecordConflictPostMergeInvariantViolation[] = [];
  const bedIds = new Set([
    ...Object.keys(remote.beds || {}),
    ...Object.keys(local.beds || {}),
    ...Object.keys(resolved.beds || {}),
  ]);

  bedIds.forEach(bedId => {
    const resolvedPatient = resolved.beds?.[bedId];
    const resolvedEntryIds = new Set(
      getMedicalHandoffEntries(resolvedPatient)
        .map(entry => normalizeId(entry.id))
        .filter(Boolean)
    );
    const sources = [remote.beds?.[bedId], local.beds?.[bedId]];

    sources.forEach(sourcePatient => {
      const preserveSource = shouldPreserveLocalPatientNarrative(sourcePatient, resolvedPatient);
      getMedicalHandoffEntries(sourcePatient).forEach(entry => {
        const id = normalizeId(entry.id);
        if (!id) return;
        const path = `beds.${bedId}.medicalHandoffEntries.${id}`;

        if (preserveSource) {
          if (!resolvedEntryIds.has(id)) {
            violations.push({
              type: 'medical_handoff_entry_missing_after_merge',
              path,
              message: `La entrada medica de entrega ${id} de ${describePatient(
                sourcePatient,
                bedId
              )} desaparecio tras el merge.`,
            });
          }
          return;
        }

        if (resolvedEntryIds.has(id)) {
          violations.push({
            type: 'medical_handoff_entry_cross_episode_after_merge',
            path,
            message: `La entrada medica de entrega ${id} de ${describePatient(
              sourcePatient,
              bedId
            )} reaparecio sobre otro episodio clinico.`,
          });
        }
      });
    });
  });

  return violations;
};

const collectClinicalConsistencyInvariantViolations = (
  result: ReturnType<typeof applyDailyRecordClinicalConsistencyCheck>
): DailyRecordConflictPostMergeInvariantViolation[] =>
  result.violations
    .filter(violation => violation.type === 'duplicate_active_patient')
    .map(violation => ({
      type: 'duplicate_active_patient_after_merge' as const,
      path: violation.path,
      message: violation.message,
    }));

const normalizeMedicalHandoffDerivedSummary = (record: DailyRecord): DailyRecord => {
  const nextSummary = buildMedicalHandoffSummary(record);
  if (nextSummary === (record.medicalHandoffNovedades || '')) {
    return record;
  }
  return {
    ...record,
    medicalHandoffNovedades: nextSummary,
  };
};

export const evaluateDailyRecordConflictPostMergeInvariants = ({
  remote,
  local,
  resolved,
  context,
}: EvaluateDailyRecordConflictPostMergeInvariantsInput): DailyRecordConflictPostMergeInvariantResult => {
  const clinicalConsistency = applyDailyRecordClinicalConsistencyCheck(resolved, context);
  const normalizedRecord = normalizeMedicalHandoffDerivedSummary(clinicalConsistency.record);
  const violations = [
    ...collectMovementInvariantViolations({
      remote,
      local,
      resolved: normalizedRecord,
    }),
    ...collectMovementLineageInvariantViolations(normalizedRecord),
    ...collectHandoffNoteInvariantViolations({
      remote,
      local,
      resolved: normalizedRecord,
    }),
    ...collectMedicalHandoffEntryInvariantViolations({
      remote,
      local,
      resolved: normalizedRecord,
    }),
    ...collectClinicalConsistencyInvariantViolations(clinicalConsistency),
  ];

  return {
    record: normalizedRecord,
    status: violations.length > 0 ? 'blocked' : 'ok',
    violations,
  };
};
