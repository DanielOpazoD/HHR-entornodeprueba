import { describe, expect, it, vi } from 'vitest';
import {
  cancelRayenSyncBundleRequest,
  isRayenCensusSnapshot,
  requestRayenSyncBundle,
  subscribeToRayenSnapshots,
} from '@/features/rayen-import/bridge/rayenSnapshotBridge';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

const snapshot: RayenCensusSnapshot = {
  facilityId: 1342,
  capturedAt: '2026-07-24T10:00:01.000Z',
  isComplete: true,
  clinicalCoverage: {
    total: 1,
    completed: 1,
    errors: 0,
    headerErrors: 0,
    diagnosisErrors: 0,
    isolationErrors: 0,
  },
  encounters: [
    {
      encounterId: 'episode-synthetic',
      run: 'TEST-0001',
      firstGivenName: 'Caso',
      firstFamilyName: 'Sintético',
    },
  ],
};
const bundle = {
  id: 'sync-synthetic',
  startedAt: '2026-07-24T10:00:00.000Z',
  completedAt: '2026-07-24T10:00:05.000Z',
  facilityId: 1342,
  dateStart: '2026-07-24',
  dateEnd: '2026-07-25',
  fichaMedicoCapturedAt: snapshot.capturedAt,
  gestionCamasCapturedAt: '2026-07-24T10:00:04.000Z',
  sourceSkewMs: 3000,
  egresoRows: [],
};
const failedCoverage = {
  total: 1,
  completed: 0,
  errors: 1,
  headerErrors: 0,
  diagnosisErrors: 0,
  isolationErrors: 1,
};

describe('snapshot contract before clinical mapping', () => {
  it('accepts error-free coverage and a deliberately partial legacy snapshot', () => {
    expect(isRayenCensusSnapshot(snapshot)).toBe(true);
    expect(
      isRayenCensusSnapshot({ ...snapshot, isComplete: false, clinicalCoverage: undefined })
    ).toBe(true);
    expect(
      isRayenCensusSnapshot({ ...snapshot, isComplete: undefined, clinicalCoverage: undefined })
    ).toBe(true);
    expect(
      isRayenCensusSnapshot({ ...snapshot, isComplete: false, clinicalCoverage: failedCoverage })
    ).toBe(true);
  });

  it.each([
    { ...snapshot, clinicalCoverage: undefined },
    { ...snapshot, clinicalCoverage: failedCoverage },
    {
      ...snapshot,
      clinicalCoverage: { ...failedCoverage, isolationErrors: 0, diagnosisErrors: 1 },
    },
    { ...snapshot, clinicalCoverage: { ...failedCoverage, isolationErrors: 0, headerErrors: 1 } },
    { ...snapshot, clinicalCoverage: { ...snapshot.clinicalCoverage, total: 0, completed: 0 } },
    { ...snapshot, isComplete: 'true' },
    { ...snapshot, capturedAt: '2026-02-31T10:00:00Z' },
    { ...snapshot, facilityId: Number.NaN },
  ])('rejects inconsistent completeness or capture metadata (%#)', candidate => {
    expect(isRayenCensusSnapshot(candidate)).toBe(false);
  });

  it.each([
    'nextGivenNames',
    'secondFamilyName',
    'birthDate',
    'administrativeSex',
    'gender',
    'service',
    'room',
    'bed',
    'clinicalCribParentBedId',
    'admissionDatetime',
    'diagnosis',
    'diagnosisCode',
    'diagnosisDescription',
    'dischargeDatetime',
    'isolationType',
    'isolationMicroorganism',
    'treatingPhysicianId',
    'treatingPhysicianName',
    'hasMedicalDischarge',
    'hasNurseDischarge',
    'isDead',
    'isIsolated',
    'isGes',
  ])('rejects a non-contract type for %s', field => {
    for (const value of [42, null, {}, []]) {
      expect(
        isRayenCensusSnapshot({
          ...snapshot,
          encounters: [{ ...snapshot.encounters[0], [field]: value }],
        })
      ).toBe(false);
    }
  });

  it.each(['birthDate', 'admissionDatetime', 'dischargeDatetime'])(
    'rejects impossible %s',
    field => {
      expect(
        isRayenCensusSnapshot({
          ...snapshot,
          encounters: [{ ...snapshot.encounters[0], [field]: '2026-02-31T10:00:00Z' }],
        })
      ).toBe(false);
    }
  );

  it('rejects a string pretending to be an isolation boolean', () => {
    expect(
      isRayenCensusSnapshot({
        ...snapshot,
        encounters: [{ ...snapshot.encounters[0], isIsolated: 'false' }],
      })
    ).toBe(false);
  });

  it.each([
    { ...snapshot, clinicalCoverage: failedCoverage },
    { ...snapshot, clinicalCoverage: undefined },
    { ...snapshot, encounters: [{ ...snapshot.encounters[0], diagnosisCode: 42 }] },
    { ...snapshot, isComplete: false, clinicalCoverage: failedCoverage },
  ])('blocks invalid capture before the mapper and preserves request correlation (%#)', invalid => {
    const mapper = vi.fn(rayenToPatientData);
    const handler = vi.fn((capture: RayenCensusSnapshot) => mapper(capture.encounters[0]));
    const unsubscribe = subscribeToRayenSnapshots(handler);
    const requestId = requestRayenSyncBundle(bundle.dateStart, bundle.dateEnd);
    const deliver = (capture: unknown) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window,
          origin: window.location.origin,
          data: { type: 'HHR_RAYEN_CENSUS_SNAPSHOT', requestId, snapshot: capture, bundle },
        })
      );
    try {
      deliver(invalid);
      expect(handler).not.toHaveBeenCalled();
      expect(mapper).not.toHaveBeenCalled();
      deliver(snapshot);
      expect(handler).toHaveBeenCalledOnce();
      expect(mapper).toHaveBeenCalledOnce();
    } finally {
      unsubscribe();
      cancelRayenSyncBundleRequest(requestId);
    }
  });
});
