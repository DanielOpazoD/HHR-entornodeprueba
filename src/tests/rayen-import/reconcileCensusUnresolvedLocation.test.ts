import { describe, expect, it } from 'vitest';
import {
  rayenToPatientData,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const REFERENCE = new Date('2026-07-25T16:00:00Z');

const encounter: RayenEncounter = {
  encounterId: '111',
  run: '11.111.111-1',
  firstGivenName: 'Paciente',
  firstFamilyName: 'Sintético',
  room: 'H4',
  bed: 'C1',
  admissionDatetime: '2026-07-24T10:00:00-06:00',
};

const snapshot = (encounters: RayenEncounter[]): RayenCensusSnapshot => ({
  capturedAt: '2026-07-25T16:00:00Z',
  facilityId: 1342,
  encounters,
  isComplete: true,
});

describe('reconcileCensus with a source location it cannot resolve', () => {
  it('says the location stayed unconfirmed, without claiming the bed is foreign or the patient unplaced', () => {
    const { patient } = rayenToPatientData(encounter, REFERENCE);
    const record: DailyRecord = {
      date: '2026-07-25',
      beds: { H4C1: { ...patient, bedId: 'H4C1' } },
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '',
      activeExtraBeds: [],
    };

    // The source omits room and bed for an episode that HHR already has in H4C1.
    const diff = reconcileCensus(
      record,
      snapshot([{ ...encounter, room: undefined, bed: undefined }]),
      {
        reference: REFERENCE,
      }
    );

    const conflict = diff.conflicts.find(entry => entry.source?.encounterId === '111');
    expect(conflict?.bedId).toBeNull();
    expect(conflict?.reason).toContain('quedó sin confirmar');
    expect(conflict?.reason).toContain('Revisa la ubicación del paciente en Gestión de Camas.');
    expect(conflict?.reason).not.toMatch(/no corresponde a ninguna|no ubicó|no se pudo/i);
    expect(record.beds.H4C1?.clinicalEpisodeId).toBe('111');
    expect(diff.moves).toHaveLength(0);
    expect(diff.discharges).toHaveLength(0);
  });
});
