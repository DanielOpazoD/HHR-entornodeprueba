import type { DailyRecord, PatientData } from '../contracts/rayenDomainContracts';
import type { ClinicalFillPatchOperation } from '../contracts/clinicalFillContracts';
import {
  clinicalFieldValuesEqual,
  type CanonicalClinicalField,
} from './clinicalFieldCanonicalization';

const CLINICAL_FIELDS = new Set<CanonicalClinicalField>([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
]);

interface LocatedClinicalPatient {
  bedId: string;
  clinicalCrib: boolean;
  patient: PatientData;
}

const findClinicalPatient = (
  record: DailyRecord,
  clinicalEpisodeId: string,
  clinicalCrib: boolean
): LocatedClinicalPatient | undefined => {
  for (const [bedId, patient] of Object.entries(record.beds)) {
    const candidate = clinicalCrib ? patient.clinicalCrib : patient;
    if (candidate?.clinicalEpisodeId === clinicalEpisodeId) {
      return { bedId, clinicalCrib, patient: candidate };
    }
  }
  return undefined;
};

const fieldFromPatchPath = (path: string): CanonicalClinicalField | undefined => {
  const field = path.split('.').at(-1) as CanonicalClinicalField | undefined;
  return field && CLINICAL_FIELDS.has(field) ? field : undefined;
};

const fieldValue = (patient: PatientData, field: CanonicalClinicalField) => patient[field];

const operationLogicalTargetKey = (operation: ClinicalFillPatchOperation): string =>
  `${operation.target.clinicalEpisodeId}|${operation.target.clinicalCrib ? 'crib' : 'patient'}`;

/** Mirrors the batch builder: one canonical operation per episode and patient/crib target. */
const coalesceOperationsByLogicalTarget = (
  operations: ClinicalFillPatchOperation[]
): ClinicalFillPatchOperation[] => {
  const byTarget = new Map<string, ClinicalFillPatchOperation>();
  operations.forEach(operation => {
    const key = operationLogicalTargetKey(operation);
    const previous = byTarget.get(key);
    if (!previous) {
      byTarget.set(key, operation);
      return;
    }
    if (previous.target.bedId !== operation.target.bedId) {
      throw new Error('El lote clínico contiene un episodio ambiguo antes de reconstruirse.');
    }
    byTarget.set(key, {
      target: previous.target,
      patch: { ...previous.patch, ...operation.patch },
      clinicalFieldCount: (previous.clinicalFieldCount ?? 0) + (operation.clinicalFieldCount ?? 0),
      checkpointChanged: previous.checkpointChanged || operation.checkpointChanged,
    });
  });
  return [...byTarget.values()];
};

/**
 * Revalidates deferred Rayen operations against a freshly read census.
 *
 * A desired value is retained only when its field still equals the run's original base. Values
 * already committed disappear from the rebuilt delta; a third concurrent value fails closed so a
 * stale clinical object can never be stamped onto a newer revision.
 */
export const rebuildClinicalEnrichmentOperations = ({
  baseRecord,
  currentRecord,
  operations,
}: {
  baseRecord: DailyRecord;
  currentRecord: DailyRecord;
  operations: ClinicalFillPatchOperation[];
}): ClinicalFillPatchOperation[] =>
  coalesceOperationsByLogicalTarget(operations).flatMap(operation => {
    const isCrib = operation.target.clinicalCrib === true;
    const episodeId = operation.target.clinicalEpisodeId;
    const base = findClinicalPatient(baseRecord, episodeId, isCrib);
    const current = findClinicalPatient(currentRecord, episodeId, isCrib);
    if (!base || !current) {
      throw new Error('El episodio clínico cambió durante la persistencia del lote.');
    }

    const prefix = `beds.${current.bedId}${current.clinicalCrib ? '.clinicalCrib' : ''}`;
    const patch: ClinicalFillPatchOperation['patch'] = {};
    for (const [path, desired] of Object.entries(operation.patch)) {
      const field = fieldFromPatchPath(path);
      if (!field) {
        throw new Error('El lote clínico contiene un campo que no puede reconstruirse.');
      }
      const desiredValue = desired as PatientData[CanonicalClinicalField];
      const baseValue = fieldValue(base.patient, field);
      const currentValue = fieldValue(current.patient, field);
      if (clinicalFieldValuesEqual(field, currentValue, desiredValue)) continue;
      if (!clinicalFieldValuesEqual(field, currentValue, baseValue)) {
        throw new Error('Un campo clínico cambió mientras se preparaba el lote.');
      }
      patch[`${prefix}.${field}`] = desiredValue as never;
    }

    const checkpointPath = `${prefix}.clinicalSyncCheckpoint`;
    const checkpointChanged = Object.prototype.hasOwnProperty.call(patch, checkpointPath);
    const clinicalFieldCount = Object.keys(patch).filter(path => path !== checkpointPath).length;
    if (clinicalFieldCount === 0 && !checkpointChanged) return [];
    return [
      {
        ...operation,
        patch,
        clinicalFieldCount,
        checkpointChanged,
        target: {
          ...operation.target,
          bedId: current.bedId,
          ...(current.clinicalCrib ? { clinicalCrib: true as const } : {}),
        },
      },
    ];
  });
