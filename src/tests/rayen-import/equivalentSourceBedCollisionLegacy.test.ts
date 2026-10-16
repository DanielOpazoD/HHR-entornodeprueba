import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCensusImportDiff,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const fixture = () => {
  const encounters: RayenEncounter[] = ['CMA-R2', 'MQ-R2'].map((encounterId, index) => ({
    encounterId,
    run: index ? '222222222' : '111111111',
    firstGivenName: index ? 'Paciente Hospitalizado' : 'Paciente CMA',
    firstFamilyName: 'Prueba',
    admissionDatetime: '2026-08-21T08:00:00-06:00',
    service: index ? 'Área Médico Quirúrgica Indiferenciada' : 'Área quirúrgica indiferenciada',
    room: index ? 'R2' : 'CMA R2',
    bed: index ? 'R2' : 'CMAR2',
  }));
  const current: DailyRecord = {
    date: '2026-08-21',
    beds: Object.fromEntries(
      encounters.map((entry, index) => {
        const bedId = index ? 'H2C1' : 'R2';
        return [
          bedId,
          {
            ...EMPTY_PATIENT,
            bedId,
            patientName: `${entry.firstGivenName} Prueba`,
            rut: entry.run,
            admissionDate: '2026-08-21',
            admissionTime: '08:00',
            handoffNote: `nota-${index}`,
          },
        ];
      })
    ),
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated: '',
  };
  const snapshot: RayenCensusSnapshot = {
    capturedAt: '2026-08-21T12:00:00-06:00',
    facilityId: 1342,
    encounters,
    isComplete: true,
  };
  return { current, snapshot };
};
const apply = (current: DailyRecord, snapshot: RayenCensusSnapshot) =>
  applyCensusImportDiff(current, reconcileCensus(current, snapshot), {
    idFactory: () => 'movement-legacy',
    now: new Date('2026-08-21T12:30:00-06:00'),
    syncRunId: 'legacy-test',
  });

describe('legacy occupants before CMA assignments were separated', () => {
  it('uses a matching complete admission stamp to keep both patients and their notes', () => {
    const { current, snapshot } = fixture();
    const result = apply(current, snapshot);
    expect(result.skipped).toEqual([]);
    expect(result.record.beds.CMA_R2).toMatchObject({
      clinicalEpisodeId: 'CMA-R2',
      handoffNote: 'nota-0',
    });
    expect(result.record.beds.R2).toMatchObject({
      clinicalEpisodeId: 'MQ-R2',
      handoffNote: 'nota-1',
    });
    expect(result.record.beds.H2C1).toBeUndefined();
    expect(result.record.discharges).toEqual([]);
  });

  it('does not repeat legacy moves or duplicate patients on the next sync', () => {
    const { current, snapshot } = fixture();
    const first = apply(current, snapshot);
    const diff = reconcileCensus(first.record, snapshot);
    expect(diff.moves).toEqual([]);
    expect(diff.admissions).toEqual([]);
    expect(diff.conflicts).toEqual([]);
    expect(Object.values(first.record.beds).filter(patient => patient.patientName)).toHaveLength(2);
  });

  it.each(['missing', 'different'] as const)(
    'keeps both existing occupants when the admission stamp is %s',
    kind => {
      const { current, snapshot } = fixture();
      current.beds.R2.admissionTime = kind === 'missing' ? '' : '09:00';
      const diff = reconcileCensus(current, snapshot);
      const result = apply(current, snapshot);
      expect(diff.conflicts.length).toBeGreaterThan(0);
      expect(result.record.beds.R2).toMatchObject({ rut: '111111111', handoffNote: 'nota-0' });
      expect(result.record.beds.H2C1).toMatchObject({ rut: '222222222', handoffNote: 'nota-1' });
      expect(result.record.beds.CMA_R2).toBeUndefined();
      expect(result.record.discharges).toEqual([]);
    }
  );
});
