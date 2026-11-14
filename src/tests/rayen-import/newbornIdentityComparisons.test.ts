import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { associateClinicalCribsWithMothers } from '@/features/rayen-import/domain/clinicalCribMaternalAssociation';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { rayenToPatientData } from '@/features/rayen-import';
import { encounter, newborn, seed, REFERENCE } from './clinicalCribDischargePromotion.fixtures';
import {
  prepareNeonatalReview,
  REVIEWED_AT,
  INDEPENDENT_CARE_AT,
} from './neonatalPlacementReview.fixtures';

const RUT = '12.345.678-5';

// Each case reaches the exported resolver with distinct synthetic mother/RN episodes.
describe.each(['P123456785', '12A3456785'])('neonatal identity collision: %s', passport => {
  const association = (foreignMother: boolean) => {
    const child = { ...newborn(), run: RUT };
    const mother = encounter({ run: foreignMother ? RUT : '144700554' });
    return associateClinicalCribsWithMothers(
      [{ encounter: child, mapped: rayenToPatientData(child, REFERENCE) }],
      () => undefined,
      () => ({
        episodeId: foreignMother ? 'REVIEWED-MOTHER' : mother.encounterId,
        bedId: 'H5C1',
        rut: '14.470.055-4',
        reviewed: true,
        sourceRun: passport,
        sourceRunIsMaternal: true,
      }),
      [{ encounter: mother, mapped: rayenToPatientData(mother, REFERENCE) }]
    )[0];
  };

  it('A107 requires review when a foreign mother matches only the current RUT', () => {
    expect(association(true).maternalAssociationConflict).toBe('ambiguous');
  });

  it('A129 does not mark the current RUT as maternal from a previous passport', () => {
    const result = association(false);
    expect(result.maternalAssociationConflict).toBeUndefined();
    expect(result.usesMaternalRun).toBe(false);
    expect(result.mapped.patient.rut).toBe(RUT);
  });

  it('N182 records maternal source evidence despite multiple mothers when the RN owns a passport', () => {
    const { record: initialRecord, diff } = prepareNeonatalReview();
    const record: DailyRecord = initialRecord;
    record.beds = {
      H5C1: seed(encounter({ run: RUT })),
      R3: { ...seed(encounter({ encounterId: 'OTHER-MOTHER', run: RUT })), bedId: 'R3' },
    };
    const review = diff.neonatalPlacementReviews![0];
    review.source.run = RUT;
    review.patient = { ...review.patient, rut: passport, documentType: 'Pasaporte' };
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
    expect(resolved.admissions[0].patient.neonatalPlacementDecision?.sourceRunIsMaternal).toBe(
      true
    );
    expect(resolved.admissions[0].patient.rut).toBe(passport);
  });

  it('N183 does not attribute a source passport to the selected mother RUT', () => {
    const { record, diff } = prepareNeonatalReview();
    record.beds.H5C1.rut = RUT;
    const review = diff.neonatalPlacementReviews![0];
    review.source.run = passport;
    review.patient = { ...review.patient, rut: passport, documentType: 'Pasaporte' };
    const resolved = resolveNeonatalPlacements(
      record,
      diff,
      [
        {
          episodeId: 'NEWBORN',
          kind: 'mother',
          bedId: 'H5C1',
          parentEpisodeId: 'MOTHER',
        },
      ],
      REVIEWED_AT,
      'Synthetic reviewer'
    );
    const child = resolved.activeClinicalCribs![0].patient;
    expect(child.neonatalPlacementDecision?.sourceRunIsMaternal).toBe(false);
    expect(child.rut).toBe(passport);
  });

  const resolvePreviousPassport = () => {
    const { record: initialRecord, diff } = prepareNeonatalReview();
    const record: DailyRecord = initialRecord;
    const review = diff.neonatalPlacementReviews![0];
    review.source.run = RUT;
    review.patient = {
      ...review.patient,
      rut: RUT,
      identityStatus: 'official',
      bedMode: 'Cama',
      bedId: 'NEO1',
    };
    review.existingBedId = 'NEO1';
    review.existingKind = 'independent';
    record.beds.NEO1 = {
      ...review.patient,
      neonatalPlacementDecision: {
        clinicalEpisodeId: 'NEWBORN',
        kind: 'independent',
        bedId: 'NEO1',
        effectiveAt: INDEPENDENT_CARE_AT,
        reviewedAt: REVIEWED_AT,
        reviewedBy: 'Synthetic reviewer',
        sourceRun: passport,
        sourceRunIsMaternal: true,
      },
    };
    return resolveNeonatalPlacements(
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
    ).updates.find(u => u.bedId === 'NEO1')!;
  };

  it('N185 does not carry maternal attribution from a prior passport to a current RUT', () => {
    const decision = resolvePreviousPassport().changes.find(
      c => c.field === 'neonatalPlacementDecision'
    );
    expect(decision?.to).toMatchObject({ sourceRun: RUT, sourceRunIsMaternal: false });
  });

  it('N191 preserves the own RUT when only the prior passport was maternal', () => {
    expect(
      resolvePreviousPassport().changes.some(c => c.field === 'rut' || c.field === 'identityStatus')
    ).toBe(false);
  });

  it('N192 preserves the newborn passport when the source uses the maternal RUT', () => {
    const { record, diff } = prepareNeonatalReview();
    record.beds.H5C1.rut = RUT;
    const review = diff.neonatalPlacementReviews![0];
    review.source.run = RUT;
    review.patient = {
      ...review.patient,
      rut: passport,
      documentType: 'Pasaporte',
      identityStatus: 'official',
    };
    const resolved = resolveNeonatalPlacements(
      record,
      diff,
      [
        {
          episodeId: 'NEWBORN',
          kind: 'mother',
          bedId: 'H5C1',
          parentEpisodeId: 'MOTHER',
        },
      ],
      REVIEWED_AT,
      'Synthetic reviewer'
    );
    expect(resolved.activeClinicalCribs![0].patient).toMatchObject({
      rut: passport,
      documentType: 'Pasaporte',
      identityStatus: 'official',
    });
  });
});
