import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';

export type DailyRecordPatchBaseRecordRegistry = WeakMap<object, DailyRecord>;

export const createDailyRecordPatchBaseRecordRegistry = (): DailyRecordPatchBaseRecordRegistry =>
  new WeakMap<object, DailyRecord>();

const resolvePatchObject = (partial: DailyRecordPatch): object | null =>
  partial && typeof partial === 'object' ? (partial as object) : null;

export const getDailyRecordPatchBaseRecord = (
  registry: DailyRecordPatchBaseRecordRegistry,
  partial: DailyRecordPatch
): DailyRecord | undefined => {
  const patchObject = resolvePatchObject(partial);
  return patchObject ? registry.get(patchObject) : undefined;
};

export const rememberDailyRecordPatchBaseRecord = (
  registry: DailyRecordPatchBaseRecordRegistry,
  partial: DailyRecordPatch,
  baseRecord: DailyRecord | null | undefined
): void => {
  const patchObject = resolvePatchObject(partial);
  if (!patchObject) return;
  if (baseRecord) {
    registry.set(patchObject, baseRecord);
    return;
  }
  registry.delete(patchObject);
};

export const forgetDailyRecordPatchBaseRecord = (
  registry: DailyRecordPatchBaseRecordRegistry,
  partial: DailyRecordPatch
): void => {
  const patchObject = resolvePatchObject(partial);
  if (patchObject) {
    registry.delete(patchObject);
  }
};
