import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import {
  buildSpecialistHandoffTargets,
  sameSpecialistHandoffTarget,
} from '@/services/storage/firestore/specialistMedicalHandoffIdentity';
import { hasSameNoteValue, NOTE_FIELDS } from '@/services/storage/sync/dayTaskReplayGuard';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
import { applyPatches } from '@/utils/patchUtils';

/** Original remote evidence and the final occupant are checked independently, before any overlay. */
export const projectRemoteAdmissionNotes = (
  candidate: DailyRecord,
  remote: DailyRecord | null,
  tasks: readonly SyncTask[],
  detached: SpecialistHandoffSyncPayload[]
): { record: DailyRecord; projected: boolean } => {
  let record = candidate;
  let projected = false;
  const patches: DailyRecordPatch = {};
  for (const task of [...tasks].sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
    if (task.type !== 'UPDATE_SPECIALIST_HANDOFF') continue;
    const active =
      ['PENDING', 'PROCESSING'].includes(task.status) &&
      !task.projectionReleased &&
      !task.handoffProjection?.released;
    const payload = task.payload as SpecialistHandoffSyncPayload;
    if (payload?.date !== candidate.date || !remote) continue;
    const projection = task.handoffProjection;
    if (
      !projection ||
      !Object.keys(projection.projected).length ||
      !payload.expectedOccupants?.length
    )
      continue;
    const actual = buildSpecialistHandoffTargets(remote, projection.projected);
    const destination = buildSpecialistHandoffTargets(candidate, projection.projected);
    const owns = (targets: typeof actual) =>
      actual.length === payload.expectedOccupants.length &&
      payload.expectedOccupants.every(
        expected =>
          expected.clinicalEpisodeId &&
          expected.patientName &&
          targets.some(target => sameSpecialistHandoffTarget(target, expected))
      );
    const remoteMatches = owns(actual);
    const destinationMatches = owns(destination);
    const projectedRemote = applyPatches(remote, projection.projected as DailyRecordPatch);
    // Other independently based notes may already be part of this edit's construction base.
    let baseRemote = remote;
    for (const other of tasks) {
      if (
        other === task ||
        other.type !== 'UPDATE_SPECIALIST_HANDOFF' ||
        !['PENDING', 'PROCESSING'].includes(other.status) ||
        other.projectionReleased ||
        !other.handoffProjection ||
        other.handoffProjection.released
      )
        continue;
      const otherPayload = other.payload as SpecialistHandoffSyncPayload;
      if (otherPayload.date !== candidate.date || !otherPayload.expectedOccupants?.length) continue;
      const otherActual = buildSpecialistHandoffTargets(remote, other.handoffProjection.projected);
      if (
        !otherActual.length ||
        !otherActual.every(target =>
          otherPayload.expectedOccupants.some(
            expected =>
              sameSpecialistHandoffTarget(target, expected) &&
              expected.clinicalEpisodeId &&
              expected.patientName &&
              expected.handoffBases?.includes(target.handoffBases?.[0] ?? '')
          )
        )
      )
        continue;
      baseRemote = applyPatches(baseRemote, other.handoffProjection.projected as DailyRecordPatch);
    }
    const baseTargets = buildSpecialistHandoffTargets(baseRemote, projection.projected);
    const sentTargets = buildSpecialistHandoffTargets(projectedRemote, projection.projected);
    const compatible =
      active &&
      remoteMatches &&
      actual.every(target => {
        const expected = payload.expectedOccupants.find(item =>
          sameSpecialistHandoffTarget(item, target)
        );
        const state = target.handoffBases?.[0];
        return (
          state !== undefined &&
          (expected?.handoffBases?.includes(state) ||
            sentTargets.some(
              sent => sameSpecialistHandoffTarget(sent, target) && sent.handoffBases?.[0] === state
            ) ||
            baseTargets.some(
              base =>
                sameSpecialistHandoffTarget(base, target) &&
                expected?.handoffBases?.includes(base.handoffBases?.[0] ?? '')
            ))
        );
      });
    if (active && (!compatible || !destinationMatches)) detached.push(payload);
    for (const [path, value] of Object.entries(projection.projected)) {
      const parts = path.split('.');
      const field = parts[2] === 'clinicalCrib' ? parts[3] : parts[2];
      if (parts[0] !== 'beds' || !NOTE_FIELDS.some(allowed => allowed === field)) continue;
      if (compatible && destinationMatches) {
        const replaced = projection.replaced[path];
        if (hasSameNoteValue(replaced, value)) continue;
        const current = path in patches ? patches[path] : getValueAtPath(record, path);
        patches[path] = mergeOwnedNoteValues(current, replaced, value);
        projected = true;
      } else if (remoteMatches && destinationMatches) {
        // Never transplant remote note fields onto a different final occupant.
        record = applyPatches(record, { [path]: getValueAtPath(remote, path) } as DailyRecordPatch);
      }
    }
  }
  return {
    record: Object.keys(patches).length ? applyPatches(record, patches) : record,
    projected,
  };
};

/** Array snapshots include other specialties. Only members changed by this task are owned. */
const mergeOwnedNoteValues = (current: unknown, replaced: unknown, projected: unknown): unknown => {
  if (!Array.isArray(current) || !Array.isArray(replaced) || !Array.isArray(projected))
    return projected;
  const id = (value: unknown): unknown =>
    value && typeof value === 'object' && 'id' in value ? value.id : undefined;
  if (![...current, ...replaced, ...projected].every(item => typeof id(item) === 'string'))
    return projected;
  const changed = projected.filter(
    item =>
      !hasSameNoteValue(
        item,
        replaced.find(before => id(before) === id(item))
      )
  );
  const removed = replaced.filter(item => !projected.some(after => id(after) === id(item)));
  return [
    ...current
      .filter(item => !removed.some(before => id(before) === id(item)))
      .map(item => changed.find(after => id(after) === id(item)) ?? item),
    ...changed.filter(item => !current.some(before => id(before) === id(item))),
  ];
};
