import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  CUDYR_SCORE_FIELDS,
  hasValidCudyrSaveAttribution,
  resolveCudyrRecordCompletion,
} from '@/domain/cudyr/cudyrCompletion';

const CUDYR_CLOSURE_FIELDS = [
  'cudyrUpdatedAt',
  'cudyrUpdatedBy',
  'cudyrUpdatedById',
  'cudyrLockedAt',
  'cudyrLockedBy',
  'cudyrShiftDate',
  'cudyrCompletedAt',
  'cudyrCompletedBy',
] as const satisfies readonly (keyof DailyRecord)[];

export interface CudyrPostMergeInvariantViolation {
  type: 'cudyr_changed_after_remote_completion';
  path: string;
  message: string;
}

const buildCudyrFingerprint = (patient: DailyRecord['beds'][string] | undefined): string => {
  const episodeId = String(patient?.clinicalEpisodeId || '').trim();
  const identity = episodeId
    ? `episode:${episodeId}`
    : [
        'fallback',
        patient?.rut,
        patient?.patientName,
        patient?.admissionDate,
        patient?.admissionTime,
      ]
        .map(value => String(value || '').trim())
        .join(':');
  const scores = CUDYR_SCORE_FIELDS.map(
    field => `${field}:${String(patient?.cudyr?.[field] ?? '')}`
  ).join('|');
  return `${identity}|${scores}`;
};

export const collectClosedCudyrInvariantViolations = ({
  remote,
  resolved,
}: {
  remote: DailyRecord;
  resolved: DailyRecord;
}): CudyrPostMergeInvariantViolation[] => {
  const remoteIsComplete = resolveCudyrRecordCompletion(remote).isComplete;
  const resolvedIsComplete = resolveCudyrRecordCompletion(resolved).isComplete;
  const introducesInvalidLock =
    !remote.cudyrLocked &&
    resolved.cudyrLocked === true &&
    (!resolvedIsComplete ||
      !hasValidCudyrSaveAttribution(resolved, { allowShiftDateNormalization: true }));
  if (!remote.cudyrLocked && !remoteIsComplete && !introducesInvalidLock) return [];

  const changedBeds = new Set([
    ...Object.keys(remote.beds || {}),
    ...Object.keys(resolved.beds || {}),
  ]);
  const changedPaths = new Set<string>();

  changedBeds.forEach(bedId => {
    const remotePatient = remote.beds?.[bedId];
    const resolvedPatient = resolved.beds?.[bedId];
    if (buildCudyrFingerprint(remotePatient) !== buildCudyrFingerprint(resolvedPatient)) {
      changedPaths.add(`beds.${bedId}.cudyr`);
    }
    if (
      buildCudyrFingerprint(remotePatient?.clinicalCrib) !==
      buildCudyrFingerprint(resolvedPatient?.clinicalCrib)
    ) {
      changedPaths.add(`beds.${bedId}.clinicalCrib.cudyr`);
    }
  });

  if ((remoteIsComplete && !resolvedIsComplete) || introducesInvalidLock) {
    changedPaths.add('cudyrLocked');
  }

  if (remote.cudyrLocked) {
    if (resolved.cudyrLocked !== true) changedPaths.add('cudyrLocked');
    CUDYR_CLOSURE_FIELDS.forEach(field => {
      if (resolved[field] !== remote[field]) changedPaths.add(field);
    });
  }

  return [...changedPaths].map(path => ({
    type: 'cudyr_changed_after_remote_completion',
    path,
    message: 'Un CUDYR ya completado en la nube no puede modificarse mediante un merge tardío.',
  }));
};
