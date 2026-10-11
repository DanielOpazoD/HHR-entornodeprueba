import { describe, expect, it } from 'vitest';
import { reconcileCensus } from '@/features/rayen-import';
import { resolveNeonatalPlacements } from '@/features/rayen-import/domain/neonatalPlacementReview';
import { areRayenStructuralPlansEquivalent } from '@/features/rayen-import/hooks/confirmRayenImport';
import { assertNeonatalSourceChangesReviewed } from '@/features/rayen-import/domain/reviewedNeonatalSourcePlacement';
import { createEmptyCensusImportDiff } from '@/features/rayen-import/domain/censusImportDiffFactory';
import {
  encounter,
  newborn,
  recordWith,
  seed,
  snapshotOf,
  REFERENCE,
} from './clinicalCribDischargePromotion.fixtures';
import type { DailyRecord } from '@/types/domain/dailyRecord';
const at = '2026-07-08T20:00:00-06:00';
const sources = () => {
  const mother = encounter(),
    child = {
      ...newborn(),
      run: '222222222',
      firstGivenName: 'RN de Desconocida',
      firstFamilyName: 'Otra',
    };
  return { mother, child };
};

describe('RN review concurrency protection', () => {
  it.each([false, true])(
    'rejects a newly admitted mother destination that became occupied or blocked (%s)',
    blocked => {
      const { mother, child } = sources();
      const base = { ...recordWith(mother, child), beds: {} };
      const diff = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
      const fresh: DailyRecord = {
        ...base,
        beds: {
          H5C1: {
            ...seed(encounter({ encounterId: 'OTHER' })),
            ...(blocked ? { patientName: '', clinicalEpisodeId: undefined, isBlocked: true } : {}),
          },
        },
      };
      const before = JSON.stringify(fresh);
      expect(() =>
        resolveNeonatalPlacements(
          fresh,
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
        )
      ).toThrow(/destino.*disponible/);
      expect(JSON.stringify(fresh)).toBe(before);
    }
  );
  it('rejects an unrelated old-bed update instead of dropping it when reassociating an independent RN', () => {
    const { mother, child } = sources();
    const base: DailyRecord = {
      ...recordWith(mother, child),
      beds: { H5C1: seed(mother), NEO1: { ...seed(child), bedId: 'NEO1', bedMode: 'Cama' } },
    };
    const diff = reconcileCensus(base, snapshotOf([mother, child]), { reference: REFERENCE });
    const other = encounter({ encounterId: 'OTHER' });
    diff.updates.push({
      bedId: 'NEO1',
      rut: other.run,
      patientName: 'Synthetic',
      patient: seed(other),
      source: other,
      changes: [{ field: 'isBlocked', from: false, to: true }],
    });
    const before = JSON.stringify(diff);
    expect(() =>
      resolveNeonatalPlacements(
        base,
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
      )
    ).toThrow(/otros cambios/);
    expect(JSON.stringify(diff)).toBe(before);
  });
  it('binds a reviewed source change to its exact source/HHR placement during CAS comparison', () => {
    const diff = createEmptyCensusImportDiff(true);
    diff.neonatalSourceChanges = [
      {
        episodeId: 'RN',
        patientName: 'Synthetic',
        hhrBedId: 'R3',
        sourceBedId: 'C-R2',
        sourceMode: 'Cuna',
        hhrMode: 'Cuna',
      },
    ];
    const changed = {
      ...diff,
      neonatalSourceChanges: [{ ...diff.neonatalSourceChanges[0], sourceBedId: 'C-R4' }],
    };
    assertNeonatalSourceChangesReviewed(diff, ['RN']);
    assertNeonatalSourceChangesReviewed(changed, ['RN']);
    expect(areRayenStructuralPlansEquivalent(diff, changed)).toBe(false);
    expect(areRayenStructuralPlansEquivalent(diff, { ...diff })).toBe(true);
  });
});
