import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';

const date = '2026-10-10';
const createPatient = (episode: string, rut = '') =>
  DataFactory.createMockPatient('R1', {
    patientName: 'Paciente Sintetico',
    rut,
    clinicalEpisodeId: episode,
    admissionDate: date,
    firstSeenDate: date,
    admissionTime: '09:00',
  });

const createRecord = (
  kind: 'discharge' | 'transfer' | 'cma',
  episode = 'ep-prior',
  rut = '',
  nested = false
) => {
  const patient = createPatient('ep-current', rut);
  const movement = {
    clinicalEpisodeId: episode,
    bedId: 'R1',
    bedName: 'R1',
    patientName: patient.patientName,
    rut,
    admissionDate: date,
    movementDate: date,
    isNested: nested,
  };
  const movements: Partial<DailyRecord> =
    kind === 'discharge'
      ? { discharges: [DataFactory.createMockDischarge(movement)] }
      : kind === 'transfer'
        ? { transfers: [DataFactory.createMockTransfer(movement)] }
        : {
            cma: [
              DataFactory.createMockCMA({
                clinicalEpisodeId: episode,
                patientName: patient.patientName,
                rut,
                originalBedId: 'R1',
                originalData: createPatient(episode, rut),
              }),
            ],
          };
  return DataFactory.createMockDailyRecord(date, {
    beds: {
      R1: nested
        ? DataFactory.createMockPatient('R1', {
            patientName: 'Madre Sintetica',
            clinicalEpisodeId: 'ep-mother',
            admissionDate: date,
            firstSeenDate: date,
            hasCompanionCrib: true,
            clinicalCrib: patient,
          })
        : patient,
    },
    ...movements,
  });
};

describe('movement episode isolation through persistence preparation', () => {
  it.each(['discharge', 'transfer', 'cma'] as const)(
    'preserves an undocumented readmission when a prior %s has the same name and date',
    kind => {
      const current = createRecord(kind);
      const { record, mergedPatches } = preparePatchedRecordPersistence(current, date, {
        nursesDayShift: ['Enfermera Sintetica'],
      });

      expect(record.beds.R1).toMatchObject({
        patientName: 'Paciente Sintetico',
        clinicalEpisodeId: 'ep-current',
        admissionDate: date,
        rut: '',
      });
      expect(mergedPatches).not.toHaveProperty('beds.R1');
      expect(record.nursesDayShift).toEqual(['Enfermera Sintetica']);
    }
  );

  it.each(['discharge', 'transfer'] as const)(
    'preserves mother and crib when a nested %s belongs to another episode',
    kind => {
      const current = createRecord(kind, 'ep-prior', '', true);
      const { record, mergedPatches } = preparePatchedRecordPersistence(current, date, {
        nursesDayShift: ['Enfermera Sintetica'],
      });

      expect(record.beds.R1).toMatchObject({
        patientName: 'Madre Sintetica',
        clinicalEpisodeId: 'ep-mother',
        clinicalCrib: {
          patientName: 'Paciente Sintetico',
          clinicalEpisodeId: 'ep-current',
          admissionDate: date,
          rut: '',
        },
      });
      expect(record.beds.R1.hasCompanionCrib).toBe(true);
      expect(mergedPatches).not.toHaveProperty('beds.R1');
    }
  );

  it.each(['discharge', 'transfer', 'cma'] as const)(
    'still clears the same episode after a confirmed %s without a document',
    kind => {
      const { record } = normalizeMovementBedConsistency(createRecord(kind, 'ep-current'));
      expect(record.beds.R1.patientName).toBe('');
    }
  );

  it.each(['discharge', 'transfer', 'cma'] as const)(
    'still preserves distinct episodes when a %s carries a matching document',
    kind => {
      const current = createRecord(kind, 'ep-prior', '11.111.111-1');
      const { record, patches } = normalizeMovementBedConsistency(current);
      expect(record.beds.R1).toEqual(current.beds.R1);
      expect(patches).toEqual({});
    }
  );
});
