import { describe, expect, it } from 'vitest';
import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
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

describe('clinical crib discharge lifecycle', () => {
  it('clears only the nested newborn when its administrative discharge is confirmed', () => {
    const mother = encounter();
    const child = newborn();
    const closedChild = { ...child, hasMedicalDischarge: true };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(current, [dischargeRow(child)], [mother, closedChild]);

    expect(enriched.pendingAdministrativeDischarges).toHaveLength(0);
    expect(enriched.summary.unchanged).toBe(1);
    expect(enriched.updates).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        rut: seed(child).rut,
        changes: [expect.objectContaining({ field: 'clinicalCrib', to: undefined })],
      }),
    ]);
    expect(enriched.reportEgresos).toEqual([
      expect.objectContaining({ encounterId: 'NEWBORN', run: '' }),
    ]);
    expect(applied.skipped).toHaveLength(0);
    expect(applied.record.beds.H5C1).toMatchObject({ clinicalEpisodeId: 'MOTHER' });
    expect(applied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('does not reattach the same newborn episode after its administrative discharge', () => {
    const mother = encounter();
    const child = newborn();
    const current = recordWith(mother, child);
    const { applied } = apply(current, [dischargeRow(child)], [mother, child]);

    expect(applied.record.discharges).toEqual([
      expect.objectContaining({ rut: child.run, clinicalEpisodeId: 'NEWBORN' }),
    ]);

    const staleSnapshot = reconcileCensus(applied.record, snapshotOf([mother, child]), {
      reference: REFERENCE,
    });
    const reapplied = applyCensusImportDiff(applied.record, staleSnapshot, {
      idFactory: () => 'second-movement-id',
      now: REFERENCE,
      syncRunId: 'crib-stale-snapshot',
    });

    expect(staleSnapshot.conflicts).toHaveLength(0);
    expect(staleSnapshot.activeClinicalCribs ?? []).toHaveLength(0);
    expect(staleSnapshot.updates).toHaveLength(0);
    expect(reapplied.record.beds.H5C1.clinicalCrib).toBeUndefined();
  });

  it('allows a later newborn episode without RUN after an earlier episode was discharged', () => {
    const mother = encounter();
    const priorChild = newborn();
    const current = recordWith(mother, priorChild);
    const { applied } = apply(current, [dischargeRow(priorChild)], [mother, priorChild]);
    const readmittedChild = { ...priorChild, encounterId: 'NEWBORN-READMISSION' };

    const diff = reconcileCensus(applied.record, snapshotOf([mother, readmittedChild]), {
      reference: REFERENCE,
    });
    const reapplied = applyCensusImportDiff(applied.record, diff, {
      idFactory: () => 'readmission-movement-id',
      now: REFERENCE,
      syncRunId: 'crib-readmission',
    });

    expect(diff.conflicts).toHaveLength(0);
    expect(diff.activeClinicalCribs).toEqual([
      expect.objectContaining({
        parentBedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN-READMISSION' }),
      }),
    ]);
    expect(reapplied.record.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'NEWBORN-READMISSION',
    });
  });

  it('promotes a clinically closed newborn until its own administrative discharge exists', () => {
    const mother = encounter();
    const child = newborn();
    const closedChild = { ...child, hasMedicalDischarge: true };
    const current = recordWith(mother, child);
    const { enriched, applied } = apply(current, [dischargeRow(mother)], [mother, closedChild]);

    expect(enriched.admissions).toEqual([
      expect.objectContaining({
        bedId: 'H5C1',
        patient: expect.objectContaining({ clinicalEpisodeId: 'NEWBORN', bedMode: 'Cuna' }),
      }),
    ]);
    expect(applied.record.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'NEWBORN',
      bedMode: 'Cuna',
    });
  });
});
