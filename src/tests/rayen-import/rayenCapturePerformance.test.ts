import { describe, expect, it } from 'vitest';
import { buildRayenCapturePerformance } from '@/features/rayen-import/domain/rayenSyncSourceQuality';
import type {
  RayenCensusSnapshot,
  RayenCaptureTimings,
} from '@/features/rayen-import/contracts/rayenSnapshot';
const snapshot: RayenCensusSnapshot = {
  facilityId: 1,
  capturedAt: '2026-09-28T18:00:00Z',
  encounters: [],
};
describe('source capture performance projection', () => {
  it('retains existing behavior when an older extension has no source timings', () => {
    expect(buildRayenCapturePerformance(snapshot, snapshot, 500).stagesMs).toEqual({
      dualCapture: 500,
    });
  });
  it('records only bounded capture retry counts without changing older-extension telemetry', () => {
    for (const count of [1, 2])
      expect(
        buildRayenCapturePerformance(snapshot, snapshot, 500, undefined, count).counters
      ).toEqual({ retries: count });
    for (const count of [undefined, 0, -1, 3, NaN])
      expect(
        buildRayenCapturePerformance(snapshot, snapshot, 500, undefined, count).counters
      ).toBeUndefined();
  });
  it('copies only known safe durations into persisted telemetry', () => {
    const timings = {
      captureHealthBefore: 0,
      captureFichaMedico: 120,
      fichaContext: 4,
      fichaListsAndCatalog: 10,
      fichaPatientReads: 72,
      fichaDiagnosisCoding: 3,
      captureGestionCamas: 450,
      captureHealthAfter: 20,
      patientName: 'synthetic-do-not-store',
    };
    expect(buildRayenCapturePerformance(snapshot, snapshot, 500, timings).stagesMs).toEqual({
      dualCapture: 500,
      captureHealthBefore: 0,
      captureFichaMedico: 120,
      fichaContext: 4,
      fichaListsAndCatalog: 10,
      fichaPatientReads: 72,
      fichaDiagnosisCoding: 3,
      captureGestionCamas: 450,
      captureHealthAfter: 20,
    });
  });
  it.each([-1, Infinity, NaN, 1.5, '120', null, Number.MAX_SAFE_INTEGER + 1])(
    'ignores invalid diagnostic duration %s',
    value => {
      const timings = { captureFichaMedico: value } as unknown as RayenCaptureTimings;
      expect(buildRayenCapturePerformance(snapshot, snapshot, 500, timings).stagesMs).toEqual({
        dualCapture: 500,
      });
    }
  );
});
