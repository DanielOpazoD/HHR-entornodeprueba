import { describe, expect, it } from 'vitest';
import { applyCensusImportDiff, reconcileCensus } from '@/features/rayen-import';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { neonatalMaternalLookupRut } from '@/features/rayen-import/domain/neonatalMaternalLookupIdentity';
import {
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
const at = '2026-07-08T20:00:00-06:00';
const apply = (current: ReturnType<typeof recordWith>, diff: ReturnType<typeof reconcileCensus>) =>
  applyCensusImportDiff(current, diff, {
    now: new Date(at),
    idFactory: () => 'review',
    syncRunId: 'review',
    actor: 'Nurse',
  }).record;

describe('maternal candidate and legacy neonatal identity safety', () => {
  it('requires review instead of retaining the replacement occupant as mother', () => {
    const original = encounter();
    const child = newborn();
    const current = recordWith(original, child);
    current.beds.H5C1.clinicalCrib!.neonatalMaternalRut = seed(original).rut;
    const replacement = encounter({
      encounterId: 'REPLACEMENT',
      run: '123456785',
      firstGivenName: 'Otra',
      firstFamilyName: 'Mujer',
    });
    current.beds.H5C1 = { ...seed(replacement), clinicalCrib: current.beds.H5C1.clinicalCrib };
    const diff = reconcileCensus(current, snapshotOf([replacement, child]), {
      reference: REFERENCE,
    });
    expect(
      diff.neonatalPlacementReviews?.find(r => r.episodeId === child.encounterId)
    ).toBeDefined();
    expect(diff.activeClinicalCribs ?? []).toHaveLength(0);
  });

  it('never treats a personally named independent female neonate as a mother', () => {
    const infant = {
      ...newborn(),
      encounterId: 'INFANT',
      firstGivenName: 'Maria',
      firstFamilyName: 'Perez',
      run: '222222222',
      administrativeSex: 'Mujer',
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
    };
    const child = {
      ...newborn(),
      run: infant.run,
      firstGivenName: 'RN de Maria',
      bed: 'CNEO1',
      clinicalCribParentBedId: 'NEO1',
    };
    const current = { ...recordWith(encounter(), child), beds: { NEO1: seed(infant) } };
    const diff = reconcileCensus(current, snapshotOf([infant, child]), { reference: REFERENCE });
    expect(diff.neonatalPlacementReviews?.find(r => r.episodeId === 'NEWBORN')?.mothers).toEqual(
      []
    );
    expect(
      neonatalMaternalLookupRut(current, [infant, child], child.encounterId, child.run)
    ).toBeUndefined();
    expect(apply(current, diff).beds.NEO1.clinicalCrib).toBeUndefined();
  });
  it('does not offer a clinically discharged mother absent from the current census', () => {
    const mother = { ...encounter(), hasMedicalDischarge: true };
    const occupant = encounter({
      encounterId: 'OTHER',
      run: '123456785',
      firstGivenName: 'Otro',
      administrativeSex: 'Hombre',
    });
    const child = { ...newborn(), run: mother.run };
    const current = { ...recordWith(mother, child), beds: { H5C1: seed(occupant) } };
    const diff = reconcileCensus(current, snapshotOf([mother, occupant, child]), {
      reference: REFERENCE,
    });
    expect(diff.activeClinicalCribs ?? []).toHaveLength(0);
    expect(
      diff.neonatalPlacementReviews?.find(r => r.episodeId === 'NEWBORN')?.mothers ?? []
    ).toEqual([]);
    expect(
      neonatalMaternalLookupRut(current, [mother, occupant, child], child.encounterId, child.run)
    ).toBeUndefined();
  });
  it('clears a proven maternal RUN from a legacy nested child and retains its curated name', () => {
    const mother = encounter();
    const child = { ...newborn(), run: mother.run };
    const current = recordWith(mother, child);
    current.beds.H5C1.clinicalCrib!.patientName = 'Nombre RN confirmado';
    const saved = apply(
      current,
      reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE })
    );
    expect(saved.beds.H5C1.clinicalCrib).toMatchObject({
      rut: '',
      identityStatus: 'provisional',
      patientName: 'Nombre RN confirmado',
    });
  });
  it.each([false, true])(
    'clears a proven maternal RUN on an already reviewed episode with source crib=%s',
    sourceCrib => {
      const mother = encounter();
      const child = {
        ...newborn(),
        run: mother.run,
        room: 'Neo 1',
        bed: 'Neo1',
        clinicalCribParentBedId: undefined,
      };
      const patient = seed(child);
      patient.neonatalPlacementDecision = {
        clinicalEpisodeId: child.encounterId,
        kind: 'independent',
        bedId: 'NEO1',
        effectiveAt: '2026-07-08T14:00:00-06:00',
        reviewedAt: at,
        reviewedBy: 'Nurse',
        sourcePlacementKey: 'H5C1:cuna',
        maternalRut: seed(mother).rut,
      };
      const current = { ...recordWith(mother, child), beds: { H5C1: seed(mother), NEO1: patient } };
      const source = sourceCrib ? { ...newborn(), run: mother.run } : child;
      const diff = reconcileCensus(current, snapshotOf([mother, source]), { reference: REFERENCE });
      expect(diff.neonatalPlacementReviews).toEqual([]);
      expect(apply(current, diff).beds.NEO1).toMatchObject({
        rut: '',
        identityStatus: 'provisional',
      });
    }
  );
  it.each([false, true])(
    'protects personal identity in an ordinary neonatal episode without review, known=%s',
    known => {
      const mother = encounter();
      const child = {
        ...newborn(),
        run: mother.run,
        room: 'Neo 1',
        bed: 'Neo1',
        clinicalCribParentBedId: undefined,
      };
      const own = seed({ ...child, run: '222222222' });
      const current = {
        ...recordWith(mother, child),
        beds: { H5C1: seed(mother), ...(known ? { NEO1: own } : {}) },
      };
      const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
      const saved = apply(current, diff);
      expect(saved.beds.NEO1.rut).toBe(known ? own.rut : '');
      expect(saved.beds.NEO1.neonatalMaternalRut).toBe(seed(mother).rut);
      expect(saved.beds.NEO1.neonatalPlacementDecision).toBeUndefined();
      if (!known) expect(saved.beds.NEO1.identityStatus).toBe('provisional');
      expect(diff.neonatalPlacementReviews).toEqual([]);
    }
  );
  it('retains an existing independent personal document when maternal matches are ambiguous', () => {
    const mother = encounter();
    const duplicate = encounter({ encounterId: 'DUPLICATE', room: 'H4', firstGivenName: 'Otra' });
    const child = {
      ...newborn(),
      run: mother.run,
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
    };
    const own = seed(child);
    own.neonatalPlacementDecision = {
      clinicalEpisodeId: child.encounterId,
      kind: 'independent',
      bedId: 'NEO1',
      effectiveAt: '2026-07-08T14:00:00-06:00',
      reviewedAt: at,
      reviewedBy: 'Nurse',
      maternalRut: '12345678-5',
      sourceRun: '123456785',
      sourceRunIsMaternal: true,
      sourcePlacementKey: 'NEO1:cama',
    };
    const current = {
      ...recordWith(mother, child),
      beds: { H5C1: seed(mother), H4C1: seed(duplicate), NEO1: own },
    };
    const diff = reconcileCensus(current, snapshotOf([mother, duplicate, child]), {
      reference: REFERENCE,
    });
    const saved = apply(current, diff);
    expect(saved.beds.NEO1.rut).toBe(own.rut);
    expect(saved.beds.NEO1.identityStatus).toBe('official');
  });
  it('does not retain or offer an independent neonatal principal as a mother', () => {
    const infant = {
      ...newborn(),
      encounterId: 'INFANT',
      run: '222222222',
      firstGivenName: 'Maria',
      room: 'H5',
      bed: 'C1',
      clinicalCribParentBedId: undefined,
    };
    const child = { ...newborn(), run: '', firstGivenName: 'RN de Desconocida' };
    const current = {
      ...recordWith(encounter(), child),
      beds: { H5C1: { ...seed(infant), clinicalCrib: seed(child) } },
    };
    const diff = reconcileCensus(current, snapshotOf([infant, child]), { reference: REFERENCE });
    const review = diff.neonatalPlacementReviews!.find(r => r.episodeId === child.encounterId)!;
    expect(review).toBeDefined();
    expect(review.mothers).toEqual([]);
    review.mothers.push({ bedId: 'H5C1', episodeId: infant.encounterId, name: 'Maria' });
    expect(() =>
      resolveNeonatalPlacements(
        current,
        diff,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'H5C1',
            parentEpisodeId: infant.encounterId,
          },
        ],
        at,
        'Nurse'
      )
    ).toThrow(/madre/);
  });
  it('does not derive parental proof from another infant during explicit placement resolution', () => {
    const infant = {
      ...newborn(),
      encounterId: 'INFANT',
      run: '222222222',
      firstGivenName: 'Maria',
      firstFamilyName: 'Perez',
      administrativeSex: 'Mujer',
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
    };
    const child = {
      ...newborn(),
      run: infant.run,
      firstGivenName: 'RN de Desconocida',
      bed: 'CNEO1',
      clinicalCribParentBedId: 'NEO1',
    };
    const current = { ...recordWith(encounter(), child), beds: { NEO1: seed(infant) } };
    const diff = reconcileCensus(current, snapshotOf([infant, child]), { reference: REFERENCE });
    const resolved = resolveNeonatalPlacements(
      current,
      diff,
      [
        {
          episodeId: child.encounterId,
          kind: 'independent',
          bedId: 'R3',
          effectiveAt: '2026-07-08T14:00:00-06:00',
        },
      ],
      at,
      'Nurse'
    );
    expect(apply(current, resolved).beds.R3.rut).toBe(seed(child).rut);
    expect(apply(current, resolved).beds.R3.neonatalPlacementDecision?.maternalRut).toBeUndefined();
  });
  it.each([true, false])(
    'does not auto-associate a closed RN with a source-only closed or blocked mother, absent=%s',
    absent => {
      const mother = { ...encounter(), hasMedicalDischarge: true };
      const child = { ...newborn(), run: mother.run, hasMedicalDischarge: true };
      const current = {
        ...recordWith(mother, child),
        beds: absent
          ? ({} as ReturnType<typeof recordWith>['beds'])
          : { H5C1: { ...seed(mother), isBlocked: true } },
      };
      const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
      expect(diff.activeClinicalCribs ?? []).toHaveLength(0);
      expect(diff.updates.some(u => u.changes.some(c => c.field === 'clinicalCrib'))).toBe(false);
    }
  );
  it.each(['', '222222222'])(
    'records the selected mother independently of the source RN document: %s',
    run => {
      const mother = encounter();
      const child = { ...newborn(), run, firstGivenName: 'RN de Desconocida' };
      const current = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
      const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
      const resolved = resolveNeonatalPlacements(
        current,
        diff,
        [
          {
            episodeId: child.encounterId,
            kind: 'mother',
            bedId: 'H5C1',
            parentEpisodeId: mother.encounterId,
          },
        ],
        at,
        'Nurse'
      );
      const saved = apply(current, resolved).beds.H5C1.clinicalCrib!;
      expect(saved.neonatalPlacementDecision?.maternalRut).toBe(seed(mother).rut);
      expect(saved.rut).toBe(seed(child).rut);
    }
  );
  it('does not admit a closed maternal episode via a legacy RUN-only current match', () => {
    const mother = { ...encounter(), hasMedicalDischarge: true };
    const child = { ...newborn(), run: '222222222' };
    const current = {
      ...recordWith(mother, child),
      beds: { H5C1: { ...seed(mother), clinicalEpisodeId: undefined } },
    };
    const diff = reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE });
    expect(diff.activeClinicalCribs ?? []).toHaveLength(0);
    expect(diff.updates.some(u => u.changes.some(c => c.field === 'clinicalCrib'))).toBe(false);
  });
  it('accepts the new personal RUN after provisional ordinary-bed identity without losing maternal metadata', () => {
    const mother = encounter();
    const child = {
      ...newborn(),
      run: mother.run,
      room: 'Neo 1',
      bed: 'Neo1',
      clinicalCribParentBedId: undefined,
    };
    const current = { ...recordWith(mother, child), beds: { H5C1: seed(mother) } };
    const provisional = apply(
      current,
      reconcileCensus(current, snapshotOf([mother, child]), { reference: REFERENCE })
    );
    expect(provisional.beds.NEO1.identityStatus).toBe('provisional');
    const registered = { ...child, run: '222222222' };
    const saved = apply(
      provisional,
      reconcileCensus(provisional, snapshotOf([mother, registered]), { reference: REFERENCE })
    );
    expect(saved.beds.NEO1).toMatchObject({
      rut: seed(registered).rut,
      identityStatus: 'official',
      neonatalMaternalRut: seed(mother).rut,
    });
  });
});
