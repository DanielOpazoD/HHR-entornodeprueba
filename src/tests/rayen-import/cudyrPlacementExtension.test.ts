// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import type { CudyrSourcePlacement } from '@/types/domain/cudyrPlacement';

const context = vm.createContext({ Map, Set });
for (const file of [
  'gestion-camas-active-beds.js',
  'gestion-camas-clinical-cribs.js',
  'cudyr-placement-support.js',
]) {
  vm.runInContext(
    readFileSync(new URL(`../../../extension/${file}`, import.meta.url), 'utf8'),
    context
  );
}
const api = (
  context as unknown as {
    HhrCudyrPlacementSupport: { buildPlacements: (beds: unknown[]) => CudyrSourcePlacement[] };
  }
).HhrCudyrPlacementSupport;
const bed = {
  id: 91,
  name: 'Cuna H2C2',
  shortName: 'CH2C2',
  encounterId: 901,
  hospitalDepartmentId: 4,
  bedEncounterMapping: {
    id: 88,
    hospitalDepartmentId: 4,
    timeStamp: 'opaque-token',
    startDateTime: '2026-10-06T02:30:00-05:00',
    endDateTime: '0001-01-01T00:00:00+00:00',
    encounterMapping: { encounter: { id: 901 } },
  },
};
describe('source CUDYR bed evidence', () => {
  it('preserves source intervals and recognizes a crib independently of its parent physical bed', () => {
    expect(api.buildPlacements([bed])).toMatchObject([
      {
        clinicalEpisodeId: '901',
        bedId: 'H2C2',
        modality: 'cuna',
        currentAssignment: true,
        sourceStartAt: bed.bedEncounterMapping.startDateTime,
        sourceEndAt: bed.bedEncounterMapping.endDateTime,
      },
    ]);
  });
  it.each(['CMA R1 Hospitalizados', 'Pabellón-R1 CMA'])(
    'archives the full Eloísa name %s instead of its abbreviation',
    name => {
      expect(api.buildPlacements([{ ...bed, name, shortName: 'CMAR1' }])[0]).toMatchObject({
        sourceBedLabel: name,
        modality: 'cma',
      });
    }
  );
  it('retains a stale nested assignment as historical evidence without claiming current occupancy', () => {
    expect(api.buildPlacements([{ ...bed, encounterId: 0 }])[0].currentAssignment).toBe(false);
  });
  it.each(['CMA R1', 'CMA Pabellón', 'CMAPR1'])('preserves the CMA modality for %s', label => {
    expect(api.buildPlacements([{ ...bed, name: label, shortName: label }])[0].modality).toBe(
      'cma'
    );
  });
  it('distinguishes NEO physical hospital beds from source cribs', () => {
    expect(api.buildPlacements([{ ...bed, name: 'Neo 1', shortName: 'NEO1' }])[0]).toMatchObject({
      modality: 'hospitalizacion',
      bedId: 'NEO1',
    });
  });
  it('does not collapse different bed contexts of the same episode', () => {
    expect(api.buildPlacements([bed, bed, { ...bed, name: 'R1', shortName: 'R1' }])).toHaveLength(
      2
    );
  });
});
