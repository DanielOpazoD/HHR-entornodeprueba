import type { DailyRecord } from '@/types/domain/dailyRecord';
import { describe, expect, it } from 'vitest';
import { neonatalMaternalLookupRut } from '@/features/rayen-import/domain/neonatalMaternalLookupIdentity';
import { associateClinicalCribsWithMothers } from '@/features/rayen-import/domain/clinicalCribMaternalAssociation';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { formatRun, rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
import {
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
import {
  REVIEWED_AT,
  INDEPENDENT_CARE_AT,
  applyNeonatalReview,
  prepareNeonatalReview,
} from './neonatalPlacementReview.fixtures';

const mother = () =>
  encounter({ run: 'P123456785', firstGivenName: 'Sintética', firstFamilyName: 'Prueba' });
const child = () => ({
  ...newborn(),
  run: '12.345.678-5',
  firstGivenName: 'RN de Distinta',
  firstFamilyName: 'Prueba',
});
const mapped = (source: ReturnType<typeof encounter>) => ({
  encounter: source,
  mapped: rayenToPatientData(source, REFERENCE),
});

describe('passport digits never identify another person by RUN', () => {
  it.each(['census', 'source'])(
    'does not select a passport mother from %s for flow lookup',
    origin => {
      const parent = mother();
      const rn = child();
      const record: DailyRecord = {
        ...recordWith(parent, rn),
        beds: origin === 'census' ? { H5C1: seed(parent) } : {},
      };
      expect(
        neonatalMaternalLookupRut(
          record,
          origin === 'source' ? [parent] : [],
          rn.encounterId,
          rn.run
        )
      ).toBeUndefined();
    }
  );
  it('does not automatically associate a crib with a passport mother by digits', () => {
    const result = associateClinicalCribsWithMothers(
      [mapped(mother()), mapped(child())],
      () => undefined,
      () => undefined
    );
    expect(result[1].maternalAssociationConflict).toBe('unmatched');
  });
  it.each([false, true])(
    'keeps an established episode link without marking the child RUN maternal (reviewed=%s)',
    reviewed => {
      const result = associateClinicalCribsWithMothers(
        [mapped(child())],
        () => undefined,
        () => ({ episodeId: 'MOTHER', bedId: 'H5C1', rut: 'P123456785', reviewed })
      );
      expect(result[0].mapped.bedId).toBe('H5C1');
      expect(result[0].usesMaternalRun).toBe(false);
    }
  );
  it('independent review retains the child document instead of assigning a passport maternal RUN', () => {
    const parent = mother();
    const rn = child();
    const record: DailyRecord = { ...recordWith(parent, rn), beds: { H5C1: seed(parent) } };
    const diff = prepareNeonatalReview().diff;
    diff.neonatalPlacementReviews![0].source = rn;
    diff.neonatalPlacementReviews![0].patient = seed(rn);
    const resolved = resolveNeonatalPlacements(
      record,
      diff,
      [
        {
          episodeId: 'NEWBORN',
          kind: 'independent',
          bedId: 'NEO1',
          effectiveAt: INDEPENDENT_CARE_AT,
        },
      ],
      REVIEWED_AT,
      'Synthetic reviewer'
    );
    const saved = applyNeonatalReview(record, resolved).beds.NEO1;
    expect(saved.rut).toBe('12.345.678-5');
    expect(saved.neonatalPlacementDecision?.maternalRut).toBeUndefined();
  });
  it('preserves valid RUN formatting and maternal lookup', () => {
    const parent = { ...mother(), run: '123456785' };
    const rn = child();
    expect(formatRun(parent.run)).toBe('12.345.678-5');
    expect(
      neonatalMaternalLookupRut(
        { ...recordWith(parent, rn), beds: { H5C1: seed(parent) } },
        [],
        rn.encounterId,
        rn.run
      )
    ).toBe('12.345.678-5');
  });

  it('never rewrites the stored document of a patient already in the census', () => {
    // The source carries text with a letter for the same episode; whatever the mapper makes of it,
    // an ordinary sync must not turn it into a change of this patient's official document.
    const source = encounter({ run: '12A3456785' });
    const stored = { ...rayenToPatientData(source, REFERENCE).patient, rut: '12.345.678-5' };
    const current: DailyRecord = {
      ...recordWith(source, newborn()),
      beds: { [stored.bedId]: stored },
    };
    const diff = reconcileCensus(current, snapshotOf([source]), { reference: REFERENCE });
    const saved = applyCensusImportDiff(current, diff, {
      idFactory: () => 'SYNTHETIC',
      now: REFERENCE,
      syncRunId: 'SYNTHETIC',
    }).record.beds[stored.bedId];
    expect(saved?.rut).toBe('12.345.678-5');
    expect(diff.admissions).toEqual([]);
    expect(diff.discharges).toEqual([]);
  });
});
