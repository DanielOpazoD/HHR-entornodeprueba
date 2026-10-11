import { describe, expect, it } from 'vitest';
import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import {
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
const at = '2026-07-08T20:00:00-06:00';

describe('neonatal identity and known-association ambiguity', () => {
  it.each(['mother', 'independent'] as const)(
    'never stores a shared maternal RUN as personal identity after %s review',
    kind => {
      const mother = encounter();
      const other = encounter({
        encounterId: 'OTHER',
        firstGivenName: 'Otra',
        firstFamilyName: 'Madre',
        room: 'R3',
        bed: 'R3',
      });
      const child = { ...newborn(), run: mother.run, firstGivenName: 'RN de Desconocida' };
      const current = {
        ...recordWith(mother, child),
        beds: { H5C1: seed(mother), R3: seed(other) },
      };
      const diff = reconcileCensus(current, snapshotOf([mother, other, child]), {
        reference: REFERENCE,
      });
      expect(diff.neonatalPlacementReviews?.[0].episodeId).toBe('NEWBORN');
      const resolved = resolveNeonatalPlacements(
        current,
        diff,
        [
          {
            episodeId: 'NEWBORN',
            kind,
            bedId: kind === 'mother' ? 'H5C1' : 'NEO1',
            parentEpisodeId: kind === 'mother' ? 'MOTHER' : undefined,
            effectiveAt: kind === 'independent' ? '2026-07-08T14:00:00-06:00' : undefined,
          },
        ],
        at,
        'Nurse'
      );
      const saved = applyCensusImportDiff(current, resolved, {
        now: new Date(at),
        idFactory: () => 'review',
        syncRunId: 'review',
        actor: 'Nurse',
      }).record;
      const rn = kind === 'mother' ? saved.beds.H5C1.clinicalCrib! : saved.beds.NEO1;
      expect(rn.rut).toBe('');
      expect(rn.identityStatus).toBe('provisional');
      if (kind === 'mother')
        expect(rn.neonatalPlacementDecision?.maternalRut).toBe(seed(mother).rut);
    }
  );
  it('protects an existing independent RN own document when the corrected source shares an ambiguous maternal RUN', () => {
    const mother = encounter();
    const other = encounter({
      encounterId: 'OTHER',
      firstGivenName: 'Otra',
      room: 'R3',
      bed: 'R3',
    });
    const child = {
      ...newborn(),
      run: '222222222',
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
    };
    const own = seed(child);
    own.neonatalPlacementDecision = {
      clinicalEpisodeId: 'NEWBORN',
      kind: 'independent',
      bedId: 'NEO1',
      effectiveAt: '2026-07-08T14:00:00-06:00',
      reviewedAt: at,
      reviewedBy: 'Nurse',
      sourcePlacementKey: 'H5C1:cuna',
    };
    const current = {
      ...recordWith(mother, child),
      beds: { H5C1: seed(mother), R3: seed(other), NEO1: own },
    };
    const corrected = { ...child, run: mother.run };
    const diff = reconcileCensus(current, snapshotOf([mother, other, corrected]), {
      reference: REFERENCE,
    });
    const saved = applyCensusImportDiff(current, diff, {
      now: new Date(at),
      idFactory: () => 'review',
      syncRunId: 'review',
      actor: 'Nurse',
    }).record;
    expect(saved.beds.NEO1.rut).toBe(own.rut);
    expect(saved.beds.NEO1.neonatalPlacementDecision?.maternalRut).toBeUndefined();
  });
  it('never offers or associates another hospitalized RN as the mother', () => {
    const source = {
      ...newborn(),
      encounterId: 'INDEPENDENT_RN',
      run: encounter().run,
      firstGivenName: 'RN de Ana',
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
      administrativeSex: 'Mujer',
    };
    const patient = {
      ...seed(source),
      rut: '22.222.222-2',
      bedId: 'NEO1',
      bedMode: 'Cama' as const,
      neonatalPlacementDecision: {
        clinicalEpisodeId: 'INDEPENDENT_RN',
        kind: 'independent' as const,
        bedId: 'NEO1',
        effectiveAt: '2026-07-08T14:00:00-06:00',
        reviewedAt: at,
        reviewedBy: 'Nurse',
        sourcePlacementKey: 'NEO1:cama',
        maternalRut: encounter().run,
      },
    };
    const child = {
      ...newborn(),
      run: source.run,
      firstGivenName: 'RN de Desconocida',
      bed: 'CNEO1',
      clinicalCribParentBedId: 'NEO1',
    };
    const current = { ...recordWith(encounter(), child), beds: { NEO1: patient } };
    const diff = reconcileCensus(current, snapshotOf([source, child]), { reference: REFERENCE });
    expect(diff.neonatalPlacementReviews?.find(r => r.episodeId === 'NEWBORN')?.mothers).toEqual(
      []
    );
    const saved = applyCensusImportDiff(current, diff, {
      now: new Date(at),
      idFactory: () => 'review',
      syncRunId: 'review',
      actor: 'Nurse',
    }).record;
    expect(saved.beds.NEO1.clinicalCrib).toBeUndefined();
    expect(saved.beds.NEO1.rut).toBe(patient.rut);
  });
  it.each(['MOTHER', 'OTHER', 'deferred'])(
    'allows a known ambiguous RN to retain, change or defer its mother: %s',
    selected => {
      const mother = encounter();
      const other = encounter({ encounterId: 'OTHER', run: '123456785', room: 'R3', bed: 'R3' });
      const child = { ...newborn(), run: '222222222' };
      const current = {
        ...recordWith(mother, child),
        beds: { ...recordWith(mother, child).beds, R3: seed(other) },
      };
      const diff = reconcileCensus(current, snapshotOf([mother, other, child]), {
        reference: REFERENCE,
      });
      const review = diff.neonatalPlacementReviews!.find(r => r.episodeId === 'NEWBORN')!;
      expect(review.existingKind).toBe('mother');
      expect(review.mothers.map(m => m.episodeId).sort()).toEqual(['MOTHER', 'OTHER']);
      const resolved = resolveNeonatalPlacements(
        current,
        diff,
        [
          {
            episodeId: 'NEWBORN',
            kind: selected === 'deferred' ? 'deferred' : 'mother',
            bedId: selected === 'OTHER' ? 'R3' : selected === 'MOTHER' ? 'H5C1' : '',
            parentEpisodeId: selected === 'deferred' ? undefined : selected,
          },
        ],
        at,
        'Nurse'
      );
      const saved = applyCensusImportDiff(current, resolved, {
        now: new Date(at),
        idFactory: () => 'review',
        syncRunId: 'review',
        actor: 'Nurse',
      }).record;
      const rn = saved.beds[selected === 'OTHER' ? 'R3' : 'H5C1'].clinicalCrib!;
      expect(rn.clinicalEpisodeId).toBe('NEWBORN');
      expect(rn.rut).toBe(seed(child).rut);
      expect(saved.discharges).toHaveLength(0);
      if (selected === 'OTHER') expect(saved.beds.H5C1.clinicalCrib).toBeUndefined();
      if (selected !== 'deferred') expect(resolved.conflicts).toHaveLength(0);
    }
  );
});
