// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveDailyRecordConflictWithTrace } from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// Stored legacy days can hold a primitive where the type now expects an object; the record
// salvage in zodSafeParsers keeps a truthy numeric checklist, for example.
const storedDay = (fields: Record<string, unknown>): DailyRecord =>
  ({
    date: '2026-11-15',
    beds: {},
    lastUpdated: '2026-11-15T12:00:00Z',
    ...fields,
  }) as unknown as DailyRecord;

const mergedStructure = {
  date: '2026-11-15',
  beds: {},
  lastUpdated: '2026-11-15T12:00:00.000Z',
  discharges: [],
  transfers: [],
  cma: [],
  nurses: [],
  nursesDayShift: [],
  nursesNightShift: [],
  tensDayShift: [],
  tensNightShift: [],
  activeExtraBeds: [],
  rayenSyncHistory: [],
  rayenBedCollisionResolutions: [],
};

const structureTrace = [
  {
    path: 'nursesDayShift',
    strategy: 'merge_fixed_staffing_slots',
    winner: 'merged',
    reason: 'staffing_slots_prefer_local_fill_vacancies',
  },
  {
    path: 'beds',
    strategy: 'merge_beds',
    winner: 'merged',
    reason: 'clinical_merge_union_by_bed_id',
  },
  ...['discharges', 'transfers', 'cma'].map(path => ({
    path,
    strategy: 'merge_array_by_id',
    winner: 'merged',
    reason: 'local_changed_path_preserve_remote_tombstones',
  })),
  ...['nursesNightShift', 'tensDayShift', 'tensNightShift'].map(path => ({
    path,
    strategy: 'merge_fixed_staffing_slots',
    winner: 'merged',
    reason: 'staffing_slots_prefer_local_fill_vacancies',
  })),
  {
    path: 'activeExtraBeds',
    strategy: 'merge_unique_primitive_array',
    winner: 'merged',
    reason: 'staffing_union_prefer_local_order',
  },
  {
    path: 'rayenBedCollisionResolutions',
    strategy: 'merge_array_by_id',
    winner: 'merged',
    reason: 'union_preserve_local_override',
  },
];

describe('conflict resolution with a legacy primitive in an object field', () => {
  it('merges a remote text signature with a local signature object as before', () => {
    const result = resolveDailyRecordConflictWithTrace(
      storedDay({ medicalSignature: 'old' }),
      storedDay({ medicalSignature: { doctorName: 'Synthetic' } })
    );

    expect(result.record).toEqual({
      ...mergedStructure,
      medicalSignature: { 0: 'o', 1: 'l', 2: 'd', doctorName: 'Synthetic' },
    });
    expect(result.trace.entries).toEqual([
      ...structureTrace,
      {
        path: 'medicalSignature',
        strategy: 'merge_object',
        winner: 'merged',
        reason: 'merge_object_fields',
      },
      ...['0', '1', '2'].map(index => ({
        path: `medicalSignature.${index}`,
        strategy: 'scalar_policy',
        winner: 'remote',
        reason: 'local_undefined_fallback',
      })),
      {
        path: 'medicalSignature.doctorName',
        strategy: 'scalar_policy',
        winner: 'local',
        reason: 'remote_undefined_fallback',
      },
    ]);
  });

  it('merges a remote numeric checklist with a local checklist object as before', () => {
    const result = resolveDailyRecordConflictWithTrace(
      storedDay({ handoffDayChecklist: 7 }),
      storedDay({ handoffDayChecklist: { x: true } })
    );

    expect(result.record).toEqual({ ...mergedStructure, handoffDayChecklist: { x: true } });
    expect(result.trace.entries).toEqual([
      ...structureTrace,
      {
        path: 'handoffDayChecklist',
        strategy: 'merge_object',
        winner: 'merged',
        reason: 'handoff_merge_object_fields',
      },
      {
        path: 'handoffDayChecklist.x',
        strategy: 'scalar_policy',
        winner: 'local',
        reason: 'remote_undefined_fallback',
      },
    ]);
  });
});
