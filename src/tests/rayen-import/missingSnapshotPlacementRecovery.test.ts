import { describe, expect, it, vi } from 'vitest';
import {
  rayenToPatientData,
  reconcileCensus,
  recoverMissingSnapshotPlacements,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const reference = new Date(2026, 6, 24);
const encounter: RayenEncounter = {
  encounterId: '142040',
  run: '111111111',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Anterior',
  service: 'Área quirúrgica indiferenciada',
  room: 'Neo 1',
  bed: 'Neo1',
  admissionDatetime: '2026-07-23T13:21:41-06:00',
};
const patient = { ...rayenToPatientData(encounter, reference).patient, bedId: 'NEO1' };
const current = {
  date: '2026-07-24',
  beds: { NEO1: patient },
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
} as DailyRecord;
const snapshot: RayenCensusSnapshot = {
  capturedAt: '2026-07-24T12:30:00-06:00',
  facilityId: 1342,
  encounters: [],
  isComplete: true,
};
const flowText = [
  'Paciente: Paciente Anterior RUN: 111111111',
  '23/07/2026 13:21:41 Servicio Sala Básica Neo1',
  '23/07/2026 23:10:09 Servicio Sala Básica H2C2',
].join('\n');

describe('missing snapshot placement recovery', () => {
  it('recovers an exact active episode omitted after a CMA-to-ward correction', async () => {
    const initialDiff = reconcileCensus(current, snapshot, { reference });
    const recovered = await recoverMissingSnapshotPlacements(
      current,
      snapshot,
      initialDiff,
      [
        {
          run: '111111111',
          encounterId: '142040',
          egreso: {
            id: '142040',
            hasAdministrativeDischarge: false,
            hasMedicalDischarge: false,
            hasNurseDischarge: false,
          },
        },
      ],
      {
        fetchReport: async () => ({ base64: 'JVBERg==' }),
        extractText: async () => flowText,
      },
      verified => reconcileCensus(current, verified, { reference })
    );

    expect(recovered.diff.pendingAdministrativeDischarges).toHaveLength(0);
    expect(recovered.diff.moves).toEqual([
      expect.objectContaining({ fromBedId: 'NEO1', toBedId: 'H2C2' }),
    ]);
    expect(recovered.snapshot.encounters).toEqual([
      expect.objectContaining({
        encounterId: '142040',
        verifiedBedPlacement: expect.objectContaining({ bedId: 'H2C2' }),
      }),
    ]);
  });

  it('does not recover an episode without explicit current administrative evidence', async () => {
    const initialDiff = reconcileCensus(current, snapshot, { reference });
    const fetchReport = vi.fn();
    const recovered = await recoverMissingSnapshotPlacements(
      current,
      snapshot,
      initialDiff,
      [{ encounterId: '142040', run: '111111111', egreso: { id: '142040' } }],
      { fetchReport },
      verified => reconcileCensus(current, verified, { reference })
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(recovered.diff.pendingAdministrativeDischarges).toEqual(
      initialDiff.pendingAdministrativeDischarges
    );
  });

  it('does not revive an episode that only awaits administrative discharge', async () => {
    const initialDiff = reconcileCensus(current, snapshot, { reference });
    const fetchReport = vi.fn();
    const recovered = await recoverMissingSnapshotPlacements(
      current,
      snapshot,
      initialDiff,
      [
        {
          encounterId: '142040',
          run: '111111111',
          egreso: {
            id: '142040',
            hasAdministrativeDischarge: false,
            hasMedicalDischarge: true,
            hasNurseDischarge: true,
          },
        },
      ],
      { fetchReport },
      verified => reconcileCensus(current, verified, { reference })
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(recovered.diff.pendingAdministrativeDischarges).toEqual(
      initialDiff.pendingAdministrativeDischarges
    );
  });

  it('fails closed when nursing-discharge aliases contradict each other', async () => {
    const initialDiff = reconcileCensus(current, snapshot, { reference });
    const fetchReport = vi.fn();
    const recovered = await recoverMissingSnapshotPlacements(
      current,
      snapshot,
      initialDiff,
      [
        {
          encounterId: '142040',
          run: '111111111',
          egreso: {
            id: '142040',
            hasAdministrativeDischarge: false,
            hasMedicalDischarge: false,
            hasNurseDischarge: true,
            hasNursingDischarge: false,
          },
        },
      ],
      { fetchReport },
      verified => reconcileCensus(current, verified, { reference })
    );

    expect(fetchReport).not.toHaveBeenCalled();
    expect(recovered.diff.pendingAdministrativeDischarges).toEqual(
      initialDiff.pendingAdministrativeDischarges
    );
  });
});
