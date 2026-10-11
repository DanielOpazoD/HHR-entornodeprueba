import { describe, expect, it } from 'vitest';
import {
  cudyrSourceInstant,
  resolveCudyrPlacementAt,
  type ObservedCudyrPlacement,
} from '@/domain/cudyr/cudyrPlacementTimeline';

const placement = (
  bedId: string,
  modality: 'cuna' | 'hospitalizacion',
  start: string,
  end: string
): ObservedCudyrPlacement => ({
  censusDate: '2026-10-03',
  observedAt: '2026-10-04T10:00:00-05:00',
  captureId: 'capture-test',
  placement: {
    clinicalEpisodeId: 'episode-test',
    sourceMappingId: bedId,
    sourceBedId: bedId,
    sourceBedLabel: bedId,
    sourceDepartmentId: '',
    sourceDepartmentLabel: '',
    sourceVersion: 'opaque-token',
    bedId,
    modality,
    sourceStartAt: start,
    sourceEndAt: end,
    currentAssignment: true,
    isDeleted: false,
  },
});
const crib = placement('H1C1', 'cuna', '2026-10-01T10:00:00-05:00', '2026-10-03T15:00:00-05:00');
const media = placement(
  'NEO1',
  'hospitalizacion',
  '2026-10-03T15:00:00-05:00',
  '0001-01-01T00:00:00Z'
);
describe('effective CUDYR placement intervals', () => {
  it('does not choose an opaque assignment revision whose effective bounds contradict another', () => {
    const changed = {
      ...media,
      placement: {
        ...media.placement,
        sourceStartAt: '2026-10-04T10:00:00-05:00',
        sourceVersion: 'other-token',
      },
    };
    expect(
      resolveCudyrPlacementAt('episode-test', '2026-10-03T20:00:00Z', [media, changed]).status
    ).toBe('conflicto');
  });
  it.each(['2026-02-30T10:00:00Z', '2026-10-01T24:00:00Z', '2026-10-01T10:00:00'])(
    'rejects an invalid or unzoned instant: %s',
    value => {
      expect(cudyrSourceInstant(value)).toBeNull();
    }
  );
  it('does not revive an annulled assignment through an older observation', () => {
    const deleted = { ...media, placement: { ...media.placement, isDeleted: true } };
    expect(
      resolveCudyrPlacementAt('episode-test', '2026-10-03T20:00:00Z', [media, deleted]).status
    ).toBe('sin_evidencia');
  });
  it('resolves each side of a newborn’s transfer without reclassifying previous crib days', () => {
    const before = resolveCudyrPlacementAt('episode-test', '2026-10-03T14:59:00-05:00', [
      media,
      crib,
    ]);
    const after = resolveCudyrPlacementAt('episode-test', '2026-10-03T15:00:00-05:00', [
      media,
      crib,
    ]);
    expect(before.status).toBe('resuelta');
    expect(before.evidence[0].placement.modality).toBe('cuna');
    expect(after.status).toBe('resuelta');
    expect(after.evidence[0].placement.modality).toBe('hospitalizacion');
  });
  it('compares instants with their original offsets', () => {
    expect(
      resolveCudyrPlacementAt('episode-test', '2026-10-03T20:00:00Z', [media, crib]).evidence[0]
        .placement.bedId
    ).toBe('NEO1');
  });
  it('does not turn a missing end into a discharge or extrapolate past the last source observation', () => {
    expect(cudyrSourceInstant(media.placement.sourceEndAt)).toBeNull();
    expect(
      resolveCudyrPlacementAt('episode-test', '2026-10-05T10:00:00-05:00', [media]).status
    ).toBe('sin_evidencia');
  });
  it('does not place another episode in a reused physical bed', () => {
    expect(resolveCudyrPlacementAt('new-episode', '2026-10-03T20:00:00Z', [media]).status).toBe(
      'sin_evidencia'
    );
  });
  it('does not infer a missing movement time from the sync time', () => {
    const unknown = { ...media, placement: { ...media.placement, sourceStartAt: '' } };
    expect(resolveCudyrPlacementAt('episode-test', '2026-10-03T20:00:00Z', [unknown]).status).toBe(
      'sin_evidencia'
    );
  });
  it('flags simultaneous conflicting locations and ignores stale unbounded nested assignments', () => {
    const overlappingCrib = { ...crib, placement: { ...crib.placement, sourceEndAt: '' } };
    expect(
      resolveCudyrPlacementAt('episode-test', '2026-10-03T20:00:00Z', [media, overlappingCrib])
        .status
    ).toBe('conflicto');
    expect(
      resolveCudyrPlacementAt('episode-test', '2026-10-03T20:00:00Z', [
        {
          ...overlappingCrib,
          placement: { ...overlappingCrib.placement, currentAssignment: false },
        },
      ]).status
    ).toBe('sin_evidencia');
  });
});
