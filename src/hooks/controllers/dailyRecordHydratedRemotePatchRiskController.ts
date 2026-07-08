import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { isHydratedAdmissionFollowUpClinicalPatch } from '@/hooks/controllers/dailyRecordHydratedAdmissionFollowUpController';
import {
  normalizeDailyRecordClinicalField,
  parseDailyRecordBedPatchPath,
  resolveDailyRecordClinicalGroup,
  resolveDailyRecordClinicalLockKey,
  type DailyRecordClinicalLockKey,
} from '@/hooks/controllers/dailyRecordClinicalPatchPathController';

export type HydratedRemotePatchRisk =
  | 'independent_field'
  | 'same_field'
  | 'same_group'
  | 'episode_changed'
  | 'movement_changed'
  | 'unknown_high_risk';

export interface HydratedRemoteClinicalFieldLocks extends Partial<
  Record<DailyRecordClinicalLockKey, boolean>
> {
  allClinical?: boolean;
}

export type HydratedRemoteClinicalFieldLocksByBedId = Record<
  string,
  HydratedRemoteClinicalFieldLocks
>;

const VISIBLE_EPISODE_FIELDS = new Set(['rut', 'patientName', 'admissionDate', 'firstSeenDate']);
const MOVEMENT_LIST_KEYS = new Set(['discharges', 'transfers', 'cma']);

const getPathValue = (source: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);

const valuesDiffer = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) !== JSON.stringify(right ?? null);

const hasOwnPatchPath = (patch: DailyRecordPatch, path: string): boolean =>
  Object.prototype.hasOwnProperty.call(patch, path);

const getPatchValue = (patch: DailyRecordPatch, path: string): unknown =>
  (patch as Record<string, unknown>)[path];

const normalizeComparableText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

const hasMeaningfulText = (value: unknown): boolean => normalizeComparableText(value).length > 0;

const isMovementListPatchPath = (path: string): boolean => MOVEMENT_LIST_KEYS.has(path);

const collectChangedBedFields = (
  previousRecord: DailyRecord,
  hydratedRecord: DailyRecord,
  bedId: string
): Set<string> => {
  const fields = new Set<string>();
  const previousBed = (previousRecord.beds?.[bedId] ?? {}) as unknown as Record<string, unknown>;
  const hydratedBed = (hydratedRecord.beds?.[bedId] ?? {}) as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(previousBed), ...Object.keys(hydratedBed)]);

  keys.forEach(field => {
    if (valuesDiffer(previousBed[field], hydratedBed[field])) {
      fields.add(field);
    }
  });

  const previousCrib = (previousBed.clinicalCrib ?? {}) as Record<string, unknown>;
  const hydratedCrib = (hydratedBed.clinicalCrib ?? {}) as Record<string, unknown>;
  const cribKeys = new Set([...Object.keys(previousCrib), ...Object.keys(hydratedCrib)]);
  cribKeys.forEach(field => {
    if (valuesDiffer(previousCrib[field], hydratedCrib[field])) {
      fields.add(`clinicalCrib.${field}`);
    }
  });

  return fields;
};

const hasVisibleEpisodeChange = (changedFields: Set<string>): boolean =>
  Array.from(VISIBLE_EPISODE_FIELDS).some(field => changedFields.has(field));

const hasChangedFieldInClinicalGroup = (
  changedFields: Set<string>,
  attemptedGroup: ReadonlySet<string>
): boolean =>
  Array.from(changedFields).some(changedField =>
    attemptedGroup.has(normalizeDailyRecordClinicalField(changedField))
  );

const patchValueMatchesHydratedRecord = (
  attemptedPatch: DailyRecordPatch,
  attemptedPath: string,
  hydratedRecord: DailyRecord,
  canonicalPath: string
): boolean => {
  if (!hasOwnPatchPath(attemptedPatch, attemptedPath)) {
    return false;
  }
  return !valuesDiffer(
    getPatchValue(attemptedPatch, attemptedPath),
    getPathValue(hydratedRecord, canonicalPath)
  );
};

const isSameHydratedAdmissionActivation = (
  attemptedPatch: DailyRecordPatch,
  previousRecord: DailyRecord,
  hydratedRecord: DailyRecord,
  bedId: string
): boolean => {
  const previousBed = previousRecord.beds?.[bedId];
  const hydratedBed = hydratedRecord.beds?.[bedId];
  if (!previousBed || !hydratedBed) return false;

  if (hasMeaningfulText(previousBed.patientName) || hasMeaningfulText(previousBed.rut)) {
    return false;
  }

  const identityFields = ['patientName', 'rut'] as const;
  const touchesIdentity = identityFields.some(field =>
    hasOwnPatchPath(attemptedPatch, `beds.${bedId}.${field}`)
  );
  if (!touchesIdentity) return false;

  const touchedFieldsMatchHydrated = [...identityFields, 'admissionDate'].every(field => {
    const path = `beds.${bedId}.${field}`;
    if (!hasOwnPatchPath(attemptedPatch, path)) {
      return true;
    }
    const hydratedBedValues = hydratedBed as unknown as Record<string, unknown>;
    return (
      normalizeComparableText(getPatchValue(attemptedPatch, path)) ===
      normalizeComparableText(hydratedBedValues[field])
    );
  });

  return (
    touchedFieldsMatchHydrated &&
    (hasMeaningfulText(hydratedBed.patientName) || hasMeaningfulText(hydratedBed.rut))
  );
};

const isHydratedClinicalCribActivation = (
  attemptedPath: string,
  previousRecord: DailyRecord,
  hydratedRecord: DailyRecord,
  bedId: string
): boolean => {
  if (!attemptedPath.startsWith(`beds.${bedId}.clinicalCrib.`)) {
    return false;
  }

  const previousCrib = previousRecord.beds?.[bedId]?.clinicalCrib;
  const hydratedCrib = hydratedRecord.beds?.[bedId]?.clinicalCrib;
  const previousHadIdentity =
    hasMeaningfulText(previousCrib?.patientName) || hasMeaningfulText(previousCrib?.rut);

  return (
    !previousHadIdentity &&
    (hasMeaningfulText(hydratedCrib?.patientName) || hasMeaningfulText(hydratedCrib?.rut))
  );
};

export const classifyHydratedRemotePatchRisk = ({
  attemptedPatch,
  previousRecord,
  hydratedRecord,
}: {
  attemptedPatch: DailyRecordPatch;
  previousRecord: DailyRecord | null | undefined;
  hydratedRecord: DailyRecord | null | undefined;
}): HydratedRemotePatchRisk => {
  if (!previousRecord || !hydratedRecord) {
    return 'unknown_high_risk';
  }

  if (
    valuesDiffer(previousRecord.discharges, hydratedRecord.discharges) ||
    valuesDiffer(previousRecord.transfers, hydratedRecord.transfers) ||
    valuesDiffer(previousRecord.cma, hydratedRecord.cma)
  ) {
    return 'movement_changed';
  }

  const attemptedPaths = Object.keys(attemptedPatch);
  for (const attemptedPath of attemptedPaths) {
    if (isMovementListPatchPath(attemptedPath)) {
      continue;
    }

    const attemptedBedPatch = parseDailyRecordBedPatchPath(attemptedPath);
    if (!attemptedBedPatch) {
      return 'unknown_high_risk';
    }

    const changedFields = collectChangedBedFields(
      previousRecord,
      hydratedRecord,
      attemptedBedPatch.bedId
    );
    const sameHydratedAdmissionActivation = isSameHydratedAdmissionActivation(
      attemptedPatch,
      previousRecord,
      hydratedRecord,
      attemptedBedPatch.bedId
    );
    const hydratedAdmissionFollowUpClinicalPatch = isHydratedAdmissionFollowUpClinicalPatch(
      attemptedPatch,
      previousRecord,
      hydratedRecord,
      attemptedBedPatch.bedId
    );
    if (
      hasVisibleEpisodeChange(changedFields) &&
      !sameHydratedAdmissionActivation &&
      !hydratedAdmissionFollowUpClinicalPatch
    ) {
      return 'episode_changed';
    }

    if (!attemptedBedPatch.field) {
      if (changedFields.size > 0) {
        return Array.from(changedFields).some(field => resolveDailyRecordClinicalGroup(field))
          ? 'same_group'
          : 'unknown_high_risk';
      }
      continue;
    }

    const isClinicalCribActivation = isHydratedClinicalCribActivation(
      attemptedPath,
      previousRecord,
      hydratedRecord,
      attemptedBedPatch.bedId
    );

    if (
      !isClinicalCribActivation &&
      !hydratedAdmissionFollowUpClinicalPatch &&
      attemptedBedPatch.canonicalPath &&
      valuesDiffer(
        getPathValue(previousRecord, attemptedBedPatch.canonicalPath),
        getPathValue(hydratedRecord, attemptedBedPatch.canonicalPath)
      )
    ) {
      if (
        patchValueMatchesHydratedRecord(
          attemptedPatch,
          attemptedPath,
          hydratedRecord,
          attemptedBedPatch.canonicalPath
        )
      ) {
        continue;
      }
      return 'same_field';
    }

    const attemptedGroup = resolveDailyRecordClinicalGroup(attemptedBedPatch.field);
    if (
      !isClinicalCribActivation &&
      !hydratedAdmissionFollowUpClinicalPatch &&
      attemptedGroup &&
      hasChangedFieldInClinicalGroup(changedFields, attemptedGroup)
    ) {
      return 'same_group';
    }
  }

  return 'independent_field';
};

export const isHydratedRemotePatchRiskBlocking = (risk: HydratedRemotePatchRisk): boolean =>
  risk !== 'independent_field';

export const doesPatchTouchHydratedRemoteClinicalLocks = (
  attemptedPatch: DailyRecordPatch,
  locksByBedId: HydratedRemoteClinicalFieldLocksByBedId
): boolean =>
  Object.keys(attemptedPatch).some(path => {
    const attemptedBedPatch = parseDailyRecordBedPatchPath(path);
    if (!attemptedBedPatch) {
      return false;
    }

    const locks = locksByBedId[attemptedBedPatch.bedId];
    if (!locks) {
      return false;
    }

    if (locks.allClinical) {
      return true;
    }

    if (!attemptedBedPatch.field) {
      return Object.values(locks).some(Boolean);
    }

    const lockKey = resolveDailyRecordClinicalLockKey(attemptedBedPatch.field);
    return lockKey ? locks[lockKey] === true : false;
  });

export const buildHydratedRemoteClinicalFieldLocks = ({
  previousRecord,
  hydratedRecord,
}: {
  previousRecord: DailyRecord | null | undefined;
  hydratedRecord: DailyRecord | null | undefined;
}): HydratedRemoteClinicalFieldLocksByBedId => {
  if (!previousRecord || !hydratedRecord) {
    return {};
  }

  const bedIds = new Set([
    ...Object.keys(previousRecord.beds ?? {}),
    ...Object.keys(hydratedRecord.beds ?? {}),
  ]);
  const locksByBedId: HydratedRemoteClinicalFieldLocksByBedId = {};

  bedIds.forEach(bedId => {
    const changedFields = collectChangedBedFields(previousRecord, hydratedRecord, bedId);
    if (changedFields.size === 0) {
      return;
    }

    const locks: HydratedRemoteClinicalFieldLocks = {};
    if (hasVisibleEpisodeChange(changedFields)) {
      locks.allClinical = true;
    }

    changedFields.forEach(field => {
      const lockKey = resolveDailyRecordClinicalLockKey(field);
      if (lockKey) {
        locks[lockKey] = true;
      }
    });

    if (Object.keys(locks).length > 0) {
      locksByBedId[bedId] = locks;
    }
  });

  return locksByBedId;
};
