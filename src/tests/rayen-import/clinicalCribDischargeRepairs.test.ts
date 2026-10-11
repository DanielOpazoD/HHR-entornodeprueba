import { describe, expect, it } from 'vitest';
import {
  planClinicalCribDischargeRepairs,
  applyClinicalCribDischargeRepairs,
} from '@/features/rayen-import/domain/clinicalCribDischargeRepairs';
import {
  planRayenCensusImport,
  applyCensusImportDiff,
  requiresReview,
} from '@/features/rayen-import';
import { hasApplicableCensusChanges } from '@/features/rayen-import/domain/rayenPreviewClosePolicy';
import { hasNoApplicableRayenStructuralChanges } from '@/features/rayen-import/hooks/rayenSnapshotPlanningDecision';
import { areRayenStructuralPlansEquivalent } from '@/features/rayen-import/hooks/confirmRayenImport';
import {
  getActiveDischarges,
  getStatisticalDischarges,
} from '@/application/census/movementTombstonePolicy';
import { mergeMovementArrayById } from '@/services/repositories/conflictResolutionMovementMergePolicy';
import type { DischargeData } from '@/types/domain/movements';
import { repairRecord } from './clinicalCribDischargeRepairs.fixtures';
import { DischargeDataSchema } from '@/schemas/zod/movements';
const now = new Date('2026-09-30T18:30:00Z');
const plan = (record = repairRecord()) =>
  planRayenCensusImport({
    current: record,
    snapshot: { capturedAt: now.toISOString(), facilityId: 1342, encounters: [] },
  }).diff;

describe('reviewed current-day malformed newborn discharge repair', () => {
  it('offers a repair-only preview without modifying the record or counting a new discharge', () => {
    const record = repairRecord();
    const original = structuredClone(record);
    const diff = plan(record);
    expect(diff.clinicalCribDischargeRepairs).toHaveLength(1);
    expect(record).toEqual(original);
    expect(diff.summary.discharges).toBe(0);
    expect(requiresReview(diff)).toBe(true);
    expect(hasApplicableCensusChanges(diff)).toBe(true);
    expect(hasNoApplicableRayenStructuralChanges(diff)).toBe(false);
    const result = applyCensusImportDiff(record, diff, {
      now,
      actor: 'Synthetic operator',
      syncRunId: 'repair-sync',
      idFactory: () => {
        throw new Error('repair must not create movements');
      },
    });
    expect(result.skipped).toEqual([]);
    expect(result.applied.discharges).toBe(0);
    expect(result.record.beds).toEqual(record.beds);
    expect(result.record.discharges[0]).toEqual(record.discharges[0]);
    expect(result.record.discharges[1]).toEqual({
      ...record.discharges[1],
      deletedAt: now.toISOString(),
      deletedBy: 'Synthetic operator',
      deletedReason: 'duplicate_clinical_crib_discharge:canonical-rn',
    });
    expect(getActiveDischarges(result.record.discharges).filter(row => row.isNested)).toHaveLength(
      1
    );
    expect(getStatisticalDischarges(result.record.discharges)).toHaveLength(1);
    expect(plan(result.record).clinicalCribDischargeRepairs).toEqual([]);
    const retry = applyClinicalCribDischargeRepairs(
      result.record,
      diff.clinicalCribDischargeRepairs,
      new Date('2026-10-01T10:00:00Z'),
      'Other operator'
    );
    expect(retry.skipped).toEqual([]);
    expect(retry.discharges).toEqual(result.record.discharges);
    for (const preferLocal of [true, false]) {
      for (const [remote, local] of [
        [record.discharges, result.record.discharges],
        [result.record.discharges, record.discharges],
      ]) {
        expect(
          getActiveDischarges(mergeMovementArrayById(remote, local, preferLocal))
        ).toHaveLength(2);
      }
    }
  });

  it.each(['11:21', '11:20'])(
    'repairs persisted report copies with time %s from the same import',
    time => {
      const record = repairRecord();
      record.discharges[1].time = time;
      record.discharges = record.discharges.map(
        row => JSON.parse(JSON.stringify(DischargeDataSchema.parse(row))) as DischargeData
      );
      const original = structuredClone(record);
      const diff = plan(record);
      expect(diff.clinicalCribDischargeRepairs).toHaveLength(1);
      const result = applyCensusImportDiff(record, diff, {
        now,
        actor: 'Synthetic operator',
        syncRunId: 'repair-sync',
        idFactory: () => {
          throw new Error('repair must not create movements');
        },
      });
      expect(record).toEqual(original);
      expect(result.record.discharges[0]).toEqual(original.discharges[0]);
      expect(result.record.discharges[2]).toEqual(original.discharges[2]);
      expect(result.record.discharges[1].originalData).toEqual(original.discharges[1].originalData);
      expect(result.record.discharges[1].deletedAt).toBe(now.toISOString());
      expect(getActiveDischarges(result.record.discharges)).toHaveLength(2);
      expect(getStatisticalDischarges(result.record.discharges)).toHaveLength(1);
      const readback = {
        ...result.record,
        discharges: result.record.discharges.map(row =>
          DischargeDataSchema.parse(JSON.parse(JSON.stringify(row)))
        ),
      };
      expect(getActiveDischarges(readback.discharges)).toHaveLength(2);
      expect(plan(readback).clinicalCribDischargeRepairs).toEqual([]);
    }
  );

  it.each(['different-run', 'different-classification', 'empty-run', 'invalid-classification'])(
    'preserves differing times without matching import evidence (%s)',
    variant => {
      const record = repairRecord();
      const duplicate = record.discharges[1];
      duplicate.time = '11:20';
      const provenance = duplicate.movementProvenance!;
      if (provenance.source !== 'gestion_camas')
        throw new Error('fixture requires import provenance');
      if (variant === 'different-run') provenance.syncRunId = 'other-sync';
      if (variant === 'empty-run') provenance.syncRunId = '  ';
      if (variant === 'different-classification') provenance.classifiedAt = '2026-09-30T18:01:00Z';
      if (variant === 'invalid-classification') {
        provenance.classifiedAt = 'invalid';
        record.discharges[0].movementProvenance!.classifiedAt = 'invalid';
      }
      expect(planClinicalCribDischargeRepairs(record)).toEqual([]);
    }
  );

  it.each(['2026-02-30T18:00:00Z', '2026-09-30', '0', '2026-09-30T25:00:00Z'])(
    'rejects invalid classification timestamps even if both rows match (%s)',
    classifiedAt => {
      const record = repairRecord();
      record.discharges[1].time = '11:20';
      for (const row of record.discharges) row.movementProvenance!.classifiedAt = classifiedAt;
      expect(planClinicalCribDischargeRepairs(record)).toEqual([]);
    }
  );

  it.each([
    ['devices', ['VVP#1']],
    ['clinicalEvents', [{ id: 'event', name: 'Protected' }]],
    ['isUPC', true],
    ['diagnosisComments', 'Protected'],
    ['unrecognizedField', 'Protected'],
    ['firstName', 'Manual identity'],
  ])('preserves enriched persisted snapshots (%s)', (field, value) => {
    const record = repairRecord();
    record.discharges = record.discharges.map(
      row => JSON.parse(JSON.stringify(DischargeDataSchema.parse(row))) as DischargeData
    );
    record.discharges[1].originalData = {
      ...record.discharges[1].originalData!,
      [field]: value,
    };
    expect(planClinicalCribDischargeRepairs(record)).toEqual([]);
  });

  it('preserves both rows when the complete movement has an invalid time', () => {
    const record = repairRecord();
    record.discharges[0].time = '99:99';
    expect(planClinicalCribDischargeRepairs(record)).toEqual([]);
  });

  it.each([
    ['different episode', { clinicalEpisodeId: 'other-episode' }],
    ['missing episode', { clinicalEpisodeId: undefined }],

    ['invalid time', { time: '99:99' }],
    ['different day', { movementDate: '2026-09-29' }],
    ['different status', { status: 'Fallecido' }],
    ['statistical newborn', { isNested: false }],
    ['different RUN', { rut: '222222222' }],
    ['contradictory diagnosis', { diagnosis: 'Other diagnosis' }],
    ['IEEH data', { ieehData: { diagnosticoPrincipal: 'Protected report' } }],
    ['independent admission', { admissionDate: '2026-09-28' }],
    ['tombstone', { deletedAt: now.toISOString() }],
  ] as Array<[string, Partial<DischargeData>]>)('preserves %s', (_label, change) => {
    const record = repairRecord();
    record.discharges[1] = { ...record.discharges[1], ...change };
    expect(planClinicalCribDischargeRepairs(record)).toEqual([]);
  });

  it('preserves manual, enriched, legacy and ambiguous rows', () => {
    for (const variant of ['manual', 'legacy', 'enriched', 'ambiguous', 'same-id']) {
      const record = repairRecord();
      const duplicate = record.discharges[1];
      if (variant === 'manual')
        duplicate.movementProvenance = {
          source: 'manual',
          lineageId: 'manual',
          classifiedAt: now.toISOString(),
        };
      if (variant === 'legacy') duplicate.movementProvenance = undefined;
      if (variant === 'enriched')
        duplicate.originalData = {
          ...duplicate.originalData!,
          clinicalEpisodeId: 'rn-episode',
          diagnosisComments: 'Protected clinical data',
        };
      if (variant === 'ambiguous')
        record.discharges.push({ ...record.discharges[0], id: 'another-canonical' });
      if (variant === 'same-id') duplicate.id = record.discharges[0].id;
      expect(planClinicalCribDischargeRepairs(record), variant).toEqual([]);
    }
  });

  it.each([0, 1])('requires fresh review after row %i changes concurrently', index => {
    const record = repairRecord();
    const diff = plan(record);
    const fresh = structuredClone(record);
    fresh.discharges[index].patientName = 'Concurrent correction';
    const result = applyClinicalCribDischargeRepairs(fresh, diff.clinicalCribDischargeRepairs, now);
    expect(result.skipped).toHaveLength(1);
    expect(result.discharges).toEqual(fresh.discharges);
    expect(areRayenStructuralPlansEquivalent(diff, plan(fresh))).toBe(false);
  });

  it('accepts fresh repository snapshots with the same data in a different key order', () => {
    const record = repairRecord();
    const repairs = planClinicalCribDischargeRepairs(record);
    const fresh = structuredClone(record);
    fresh.discharges = fresh.discharges.map(
      row =>
        ({
          ...Object.fromEntries(Object.entries(row).reverse()),
          originalData: Object.fromEntries(Object.entries(row.originalData!).reverse()),
        }) as DischargeData
    );
    const result = applyClinicalCribDischargeRepairs(fresh, repairs, now, 'Synthetic operator');
    expect(result.skipped).toEqual([]);
    expect(getActiveDischarges(result.discharges)).toHaveLength(2);
  });

  it.each([undefined, '  '])('preserves the copy without an identified operator (%s)', actor => {
    const record = repairRecord();
    const repairs = planClinicalCribDischargeRepairs(record);
    const result = applyClinicalCribDischargeRepairs(record, repairs, now, actor);
    expect(result.discharges).toEqual(record.discharges);
    expect(result.skipped).toEqual([
      { bedId: 'H6C1', reason: expect.stringMatching(/identificar al operador/) },
    ]);
  });

  it('does not silently add or remove a repair during CAS replanning', () => {
    const diff = plan();
    const noRepair = { ...diff, clinicalCribDischargeRepairs: [] };
    expect(areRayenStructuralPlansEquivalent(diff, noRepair)).toBe(false);
    expect(areRayenStructuralPlansEquivalent(noRepair, diff)).toBe(false);
    expect(areRayenStructuralPlansEquivalent(diff, structuredClone(diff))).toBe(true);
    const record = repairRecord();
    expect(applyClinicalCribDischargeRepairs(record, undefined, now).discharges).toEqual(
      record.discharges
    );
  });
});
