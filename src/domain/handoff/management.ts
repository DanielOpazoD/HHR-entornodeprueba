import type { HandoffDailyRecordContract } from '@/domain/handoff/recordContracts';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

export const buildChecklistUpdateRecord = (
  record: HandoffDailyRecordContract,
  shift: 'day' | 'night' | 'shared',
  field: string,
  value: boolean | string
): HandoffDailyRecordContract => {
  const updatedRecord = { ...record };
  if (shift === 'shared') {
    updatedRecord.handoffSharedChecklist = {
      ...record.handoffSharedChecklist,
      [field]: value,
    };
  } else if (shift === 'day') {
    updatedRecord.handoffDayChecklist = {
      ...updatedRecord.handoffDayChecklist,
      [field]: value as boolean,
    } as HandoffDailyRecordContract['handoffDayChecklist'];
  } else {
    updatedRecord.handoffNightChecklist = {
      ...updatedRecord.handoffNightChecklist,
      [field]: value,
    } as HandoffDailyRecordContract['handoffNightChecklist'];
  }
  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

export const buildNovedadesUpdateRecord = (
  record: HandoffDailyRecordContract,
  shift: 'day' | 'night',
  value: string
): HandoffDailyRecordContract => {
  const updatedRecord = { ...record };
  if (shift === 'day') updatedRecord.handoffNovedadesDayShift = value;
  if (shift === 'night') updatedRecord.handoffNovedadesNightShift = value;
  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

export const buildUpdatedHandoffStaffRecord = (
  currentRecord: HandoffDailyRecordContract,
  shift: 'day' | 'night',
  type: 'delivers' | 'receives' | 'tens',
  staffList: string[]
): HandoffDailyRecordContract => {
  const updatedRecord = { ...currentRecord };

  if (shift === 'day') {
    if (type === 'delivers') {
      updatedRecord.nursesDayShift = staffList;
    } else if (type === 'receives') {
      updatedRecord.nursesNightShift = staffList;
    } else {
      updatedRecord.tensDayShift = staffList;
    }
  } else if (type === 'delivers') {
    updatedRecord.nursesNightShift = staffList;
  } else if (type === 'receives') {
    updatedRecord.handoffNightReceives = staffList;
  } else {
    updatedRecord.tensNightShift = staffList;
  }

  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

// ---------------------------------------------------------------------------
// Patch builders — return only the changed fields for concurrent-safe writes.
// Each function mirrors its full-record counterpart above but produces a
// DailyRecordPatch suitable for Firestore updateDoc() field-level writes.
// ---------------------------------------------------------------------------

export const buildChecklistPatch = (
  shift: 'day' | 'night' | 'shared',
  field: string,
  value: boolean | string
): DailyRecordPatch => {
  const key =
    shift === 'shared'
      ? 'handoffSharedChecklist'
      : shift === 'day'
        ? 'handoffDayChecklist'
        : 'handoffNightChecklist';
  return { [`${key}.${field}`]: value } as DailyRecordPatch;
};

export const buildNovedadesPatch = (shift: 'day' | 'night', value: string): DailyRecordPatch =>
  shift === 'day' ? { handoffNovedadesDayShift: value } : { handoffNovedadesNightShift: value };

export const buildHandoffStaffPatch = (
  shift: 'day' | 'night',
  type: 'delivers' | 'receives' | 'tens',
  staffList: string[]
): DailyRecordPatch => {
  if (shift === 'day') {
    if (type === 'delivers') return { nursesDayShift: staffList };
    if (type === 'receives') return { nursesNightShift: staffList };
    return { tensDayShift: staffList };
  }
  if (type === 'delivers') return { nursesNightShift: staffList };
  if (type === 'receives') return { handoffNightReceives: staffList };
  return { tensNightShift: staffList };
};
