import { describe, expect, it } from 'vitest';
import { applyCensusImportDiff, applyEgresoReport, reconcileCensus } from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { findPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';
import {
  attachAssociatedClinicalCribDischarges,
  buildClinicalCribPromotionCandidates,
} from '@/features/rayen-import/domain/associatedClinicalCribDischarge';
import type { OccupiedClinicalCrib } from '@/features/rayen-import/domain/egresoReportPolicy';
import {
  REFERENCE,
  apply,
  dischargeRow,
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
} from './clinicalCribDischargePromotion.fixtures';

describe('clinical crib discharge promotion', () => {
  it('skips malformed occupied cribs without a traceable maternal identity', () => {
    const child = seed(newborn());
    const diff = reconcileCensus(
      {
        date: '2026-07-08',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '',
        activeExtraBeds: [],
      },
      snapshotOf([]),
      { reference: REFERENCE }
    );
    const occupiedCribs = new Map<string, OccupiedClinicalCrib>([
      [
        'missing-parent',
        {
          parentBedId: 'H5C1',
          parent: undefined as unknown as OccupiedClinicalCrib['parent'],
          patient: child,
        },
      ],
      [
        'missing-parent-rut',
        {
          parentBedId: 'H6C1',
          parent: { patientName: 'Madre sin RUT', rut: '' } as OccupiedClinicalCrib['parent'],
          patient: child,
        },
      ],
    ]);

    expect(buildClinicalCribPromotionCandidates(diff, occupiedCribs)).toEqual(new Map());
  });

  it('records a RUN-less newborn as an associated non-statistical discharge with its mother', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const completeEmptySnapshot = { ...snapshotOf([]), isComplete: true };
    const diff = reconcileCensus(current, completeEmptySnapshot, { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [dischargeRow(mother)], current);
    let sequence = 0;
    const applied = applyCensusImportDiff(current, enriched, {
      idFactory: () => `movement-${++sequence}`,
      now: REFERENCE,
      syncRunId: 'mother-newborn-associated-discharge',
    });

    expect(enriched.discharges).toEqual([
      expect.objectContaining({
        encounterId: 'MOTHER',
        associatedClinicalCrib: {
          clinicalEpisodeId: 'NEWBORN',
          patientName: 'Rn De Ana Perez',
          rut: '',
        },
      }),
    ]);
    expect(applied.applied.discharges).toBe(1);
    expect(applied.record.beds.H5C1).toBeUndefined();
    expect(applied.record.discharges).toEqual([
      expect.objectContaining({ clinicalEpisodeId: 'MOTHER', isNested: false }),
      expect.objectContaining({
        clinicalEpisodeId: 'NEWBORN',
        isNested: true,
        patientName: 'Rn De Ana Perez',
        rut: '',
      }),
    ]);
    expect(findPatientErasures(current, applied.record)).toEqual([]);
  });

  it('does not infer an associated newborn discharge from a partial snapshot', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const diff = reconcileCensus(current, snapshotOf([]), { reference: REFERENCE });
    const enriched = applyEgresoReport(diff, [dischargeRow(mother)], current);

    expect(enriched.discharges[0]?.associatedClinicalCrib).toBeUndefined();
  });

  it('resolves the associated newborn from the pre-move maternal bed', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const source = encounter({ room: 'H6', bed: 'C1' });
    const diff = reconcileCensus(
      current,
      { ...snapshotOf([source]), isComplete: true },
      {
        reference: REFERENCE,
      }
    );
    const relocatedDischarge = {
      bedId: 'H6C1',
      rut: seed(mother).rut,
      patientName: seed(mother).patientName,
      kind: 'alta' as const,
      status: 'Vivo' as const,
      reason: 'administrative-discharge' as const,
      encounterId: 'MOTHER',
    };

    expect(attachAssociatedClinicalCribDischarges(diff, [relocatedDischarge], current)).toEqual([
      expect.objectContaining({
        bedId: 'H6C1',
        associatedClinicalCrib: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN' }),
      }),
    ]);
  });

  it('does not discharge the nested newborn while its episode remains active elsewhere', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const diff = reconcileCensus(
      current,
      { ...snapshotOf([]), isComplete: true },
      {
        reference: REFERENCE,
      }
    );
    diff.activeClinicalEpisodeIds = ['NEWBORN'];
    const maternalDischarge = {
      bedId: 'H5C1',
      rut: seed(mother).rut,
      patientName: seed(mother).patientName,
      kind: 'alta' as const,
      status: 'Vivo' as const,
      reason: 'administrative-discharge' as const,
      encounterId: 'MOTHER',
    };

    expect(attachAssociatedClinicalCribDischarges(diff, [maternalDischarge], current)).toEqual([
      maternalDischarge,
    ]);
  });

  it('promotes an active attached newborn when the mother is discharged first', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    if (current.beds.H5C1.clinicalCrib) {
      current.beds.H5C1.clinicalCrib.handoffNote = 'Observación neonatal local';
    }
    const { enriched: firstReportResult, applied } = apply(
      current,
      [dischargeRow(mother)],
      [mother, child]
    );

    expect(firstReportResult.discharges).toEqual([
      expect.objectContaining({ bedId: 'H5C1', rut: seed(mother).rut }),
    ]);
    expect(firstReportResult.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'NEWBORN',
          bedMode: 'Cuna',
          clinicalCrib: undefined,
        }),
      }),
    ]);
    const secondReportResult = applyEgresoReport(
      firstReportResult,
      [dischargeRow(mother)],
      current
    );
    expect(secondReportResult.admissions).toHaveLength(1);
    expect(secondReportResult.admissions[0]?.patient.clinicalEpisodeId).toBe('NEWBORN');
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
      patientName: 'Rn De Ana Perez',
      handoffNote: 'Observación neonatal local',
    });
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();

    const repeated = reconcileCensus(applied.record, snapshotOf([child]), {
      reference: REFERENCE,
    });
    expect(repeated.conflicts).toHaveLength(0);
    expect(repeated.admissions).toHaveLength(0);
    expect(repeated.updates).toHaveLength(0);
    expect(repeated.summary.unchanged).toBe(1);
  });

  it('promotes the newborn when the exact maternal egreso has no RUN', () => {
    const mother = encounter({ run: '' });
    const child = { ...newborn(), run: '' };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(current, [dischargeRow(mother)], [mother, child]);

    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
    });
  });

  it('promotes the RUN-less newborn when the exact maternal egreso has a stale RUN', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const staleIdentityRow = { ...dischargeRow(mother), run: '999999999' };
    const { enriched, applied } = apply(current, [staleIdentityRow], [mother, child]);

    expect(enriched.discharges).toEqual([
      expect.objectContaining({ bedId: 'H5C1', encounterId: 'MOTHER' }),
    ]);
    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({
          clinicalEpisodeId: 'NEWBORN',
          rut: '',
          bedMode: 'Cuna',
        }),
      }),
    ]);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      rut: '',
      bedMode: 'Cuna',
    });
  });

  it('does not redirect an exact promotion when the stale report RUN belongs to another bed', () => {
    const mother = encounter();
    const child = newborn();
    const other = encounter({
      encounterId: 'OTHER',
      run: '999999999',
      firstGivenName: 'Otra',
      room: 'H4',
    });
    const current: DailyRecord = {
      ...recordWith(mother, child),
      beds: { H4C1: seed(other), H5C1: { ...seed(mother), clinicalCrib: seed(child) } },
    };
    const { applied } = apply(
      current,
      [{ ...dischargeRow(mother), run: other.run }],
      [other, mother, child]
    );

    expect(applied.record.beds.H4C1).toMatchObject({ clinicalEpisodeId: 'OTHER' });
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      rut: '',
      bedMode: 'Cuna',
    });
  });

  it('does not promote the newborn when both statistical discharges are confirmed', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(
      current,
      [dischargeRow(mother), dischargeRow(child)],
      [mother, child]
    );

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.summary.unchanged).toBe(0);
    expect(applied.record.beds.H5C1).toBeUndefined();
  });

  it('does not promote a crib associated with a different incoming principal patient', () => {
    const outgoingMother = encounter({
      encounterId: 'OUTGOING-MOTHER',
      run: '111111111',
      firstGivenName: 'Maria',
    });
    const incomingMother = encounter();
    const child = newborn();
    const current = recordWith(outgoingMother, child);
    const { enriched } = apply(current, [dischargeRow(outgoingMother)], [incomingMother, child]);

    expect(enriched.activeClinicalCribs).toEqual([
      expect.objectContaining({ parentBedId: 'H5C1', principalRut: incomingMother.run }),
    ]);
    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.conflicts).not.toHaveLength(0);
  });

  it('does not promote the newborn for an egreso from an older maternal episode', () => {
    const mother = encounter({ encounterId: 'MOTHER-READMISSION' });
    const oldMother = { ...mother, encounterId: 'MOTHER-OLD' };
    const child = newborn();
    const current: DailyRecord = {
      ...recordWith(mother, child),
      discharges: [{ rut: mother.run, clinicalEpisodeId: 'MOTHER-OLD' } as never],
    };
    const { enriched, applied } = apply(current, [dischargeRow(oldMother)], [mother, child]);

    expect(enriched.admissions).toHaveLength(0);
    expect(enriched.discharges).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'MOTHER-READMISSION',
      clinicalCrib: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN' }),
    });
  });

  it('does not promote either newborn while two snapshot cribs claim the same parent bed', () => {
    const mother = encounter();
    const child = newborn();
    const competingChild = {
      ...newborn(),
      encounterId: 'NEWBORN-2',
      run: '333333333',
      firstGivenName: 'Otro bebe',
    };
    const current = recordWith(mother, child);
    const { enriched } = apply(current, [dischargeRow(mother)], [mother, child, competingChild]);

    expect(enriched.conflicts).toEqual(
      expect.arrayContaining([expect.objectContaining({ bedId: 'H5C1', scope: 'clinical-crib' })])
    );
    expect(enriched.admissions).toHaveLength(0);
  });

  it('keeps a rejected cross-bed crib conflict visible and avoids duplicating the newborn', () => {
    const motherH4 = encounter({
      encounterId: 'MOTHER-H4',
      run: '333333333',
      firstGivenName: 'Carla',
      room: 'H4',
    });
    const motherH5 = encounter();
    const child = newborn();
    const current: DailyRecord = {
      ...recordWith(motherH5, child),
      beds: {
        H4C1: { ...seed(motherH4), clinicalCrib: seed(child) },
        H5C1: seed(motherH5),
      },
    };
    const { enriched, applied } = apply(
      current,
      [dischargeRow(motherH5)],
      [motherH4, motherH5, child]
    );

    expect(enriched.activeClinicalCribs ?? []).toHaveLength(0);
    expect(enriched.conflicts).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        reason: expect.stringContaining('ya está asociada a H4C1'),
      }),
    ]);
    expect(enriched.admissions).toHaveLength(0);
    expect(applied.record.beds.H4C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
    });
    expect(applied.record.beds.H5C1).toBeUndefined();
  });
});
