import type { SyncTask } from '@/services/storage/syncQueueTypes';

// These are the paths written by nursing notes and domain/handoff/management.ts.
// A generic handoff context, a whole bed or '*' also carries unrelated work.
const NURSING_ROOTS = new Set([
  'handoffSharedChecklist',
  'handoffDayChecklist',
  'handoffNightChecklist',
  'handoffNovedadesDayShift',
  'handoffNovedadesNightShift',
  'handoffNightReceives',
  'nursesDayShift',
  'nursesNightShift',
  'tensDayShift',
  'tensNightShift',
]);

export const isNursingHandoffPath = (path: string): boolean =>
  NURSING_ROOTS.has(path.split('.')[0]) ||
  /^beds\.[^.]+\.(clinicalCrib\.)?handoffNote(?:DayShift|NightShift)?$/.test(path);

export const nursingHandoffPaths = (task: SyncTask): string[] =>
  task.type === 'UPDATE_DAILY_RECORD'
    ? (task.syncContract?.changedPaths ?? []).filter(isNursingHandoffPath)
    : [];

export const hasPendingNursingHandoff = (task: SyncTask): boolean =>
  task.status !== 'RETIRED' && nursingHandoffPaths(task).length > 0;
