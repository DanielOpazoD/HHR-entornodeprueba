import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const {
  parseSourcePlacements,
  readEpisodeCaptures,
} = require('../../../functions/lib/cudyrPlacementContract.js');
const source = {
  clinicalEpisodeId: 'synthetic-episode',
  sourceMappingId: 'mapping-1',
  sourceBedId: 'bed-1',
  sourceBedLabel: 'CH1C1',
  sourceDepartmentId: 'department-1',
  sourceDepartmentLabel: '',
  sourceVersion: 'opaque',
  sourceStartAt: '2026-10-01T10:00:00-05:00',
  sourceEndAt: '0001-01-01T00:00:00Z',
  currentAssignment: true,
  isDeleted: false,
  modality: 'cuna',
  bedId: 'H1C1',
};
describe('source placement contract', () => {
  it('keeps source values and distinguishes legacy absence from a captured empty list', () => {
    expect(parseSourcePlacements([source], source.clinicalEpisodeId)).toEqual([source]);
    expect(parseSourcePlacements(undefined, source.clinicalEpisodeId)).toBeUndefined();
    expect(parseSourcePlacements([], source.clinicalEpisodeId)).toEqual([]);
  });
  it('rejects cross-episode evidence and oversized source payloads', () => {
    expect(() => parseSourcePlacements([source], 'other')).toThrow();
    expect(() => parseSourcePlacements(Array(33).fill(source), source.clinicalEpisodeId)).toThrow();
    expect(() =>
      parseSourcePlacements(
        [{ ...source, sourceVersion: 'x'.repeat(301) }],
        source.clinicalEpisodeId
      )
    ).toThrow();
  });
  it.each([
    { clinicalEpisodeIds: [] },
    { clinicalEpisodeIds: ['x', 'x'] },
    { clinicalEpisodeIds: Array(31).fill('x') },
    { clinicalEpisodeIds: ['x'], limit: 101 },
    { clinicalEpisodeIds: ['x'], hospitalId: 'other' },
  ])('bounds each episode query before querying storage', async request => {
    await expect(readEpisodeCaptures({}, request)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });
});
