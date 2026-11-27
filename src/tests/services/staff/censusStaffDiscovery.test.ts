// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  collectCensusStaff,
  collectClinicalDerivedStaff,
} from '@/features/census/services/censusStaffDiscovery';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
import { asStoredDailyRecordShape } from '@/tests/factories/DataFactory';
import type { ClinicalDerivedEpisodeDoc } from '@/types/domain/clinicalDerived';
describe('census staff discovery', () => {
  it('reads current and historical attributable fields without changing clinical records', () => {
    const record = asStoredDailyRecordShape({
      date: '2026-09-01',
      nursesDayShift: ['Ana Antigua', 'Vacante'],
      tensNightShift: ['Bruno Anterior'],
      beds: {
        R1: {
          patientName: 'No Extraer Paciente',
          handoffNote: 'No Extraer Doctor',
          evaluationScores: {
            history: [
              {
                author: 'Camila Historica',
                authorRole: 'Enfermera',
                recordedAt: '2026-08-01T12:00:00',
                archived: true,
              },
            ],
            braden: { author: 'Sin Rol', recordedAt: '2026-08-01T12:00:00' },
          },
          clinicalCrib: {
            vitalSigns: {
              author: 'Carla Cuna',
              authorRole: 'Paramédico',
              recordedAt: '2026-08-01T12:00:00',
            },
          },
          upcChecklist: {
            responsibleNurse: { name: 'Daniela Perez' },
            evaluatedAt: '2026-09-01T12:00:00',
          },
        },
      },
      discharges: [
        {
          originalData: {
            vitalSignsHistory: [
              { author: 'Diego Egresado', authorRole: 'TENS', recordedAt: '2026-08-01T12:00:00' },
            ],
          },
        },
      ],
    });
    const before = JSON.stringify(record);
    const found = mergeEloisaStaff([], collectCensusStaff(record));
    expect(found.map(entry => entry.name).sort()).toEqual(
      [
        'Camila Historica',
        'Daniela Perez',
        'Ana Antigua',
        'Bruno Anterior',
        'Carla Cuna',
        'Diego Egresado',
      ].sort()
    );
    expect(JSON.stringify(record)).toBe(before);
    expect(JSON.stringify(found)).not.toContain('Extraer');
  });

  it('converts stored Braden and Downton stamps to Rapa Nui without mutating source records', () => {
    const record = asStoredDailyRecordShape({
      date: '2026-10-01',
      beds: {
        R1: {
          evaluationScores: {
            braden: {
              author: 'Elena Historial',
              authorRole: 'Enfermera',
              recordedAt: '2026-10-02T00:30:00',
              latestApplication: {
                author: 'Fernanda Ultima',
                authorRole: 'Enfermera',
                recordedAt: '01-10-2026 9:05:00 -03:00',
              },
            },
            downton: {
              author: 'Gabriela Informe',
              authorRole: 'Enfermera',
              recordedAt: '01-10-2026 10:15:00 -03:00',
            },
            history: [
              {
                author: 'Hilda Isla',
                authorRole: 'Enfermera',
                recordedAt: '01-10-2026 08:15:00 -05:00',
              },
              {
                author: 'Ines SinHora',
                authorRole: 'Enfermera',
                recordedAt: '2026-10-01',
              },
            ],
          },
        },
      },
    });
    const before = JSON.stringify(record);
    const observations = collectCensusStaff(record);

    expect(observations).toEqual([
      { author: 'Elena Historial', role: 'Enfermera', recordedAt: '2026-10-01T22:30:00' },
      { author: 'Gabriela Informe', role: 'Enfermera', recordedAt: '2026-10-01T08:15:00' },
      { author: 'Hilda Isla', role: 'Enfermera', recordedAt: '2026-10-01T08:15:00' },
      { author: 'Fernanda Ultima', role: 'Enfermera', recordedAt: '2026-10-01T07:05:00' },
    ]);
    expect(
      mergeEloisaStaff([], observations)
        .map(entry => entry.name)
        .sort()
    ).toEqual(['Elena Historial', 'Fernanda Ultima', 'Gabriela Informe', 'Hilda Isla']);
    expect(JSON.stringify(record)).toBe(before);
  });

  it('converts stored scale timestamps in clinicalDerived episode documents too', () => {
    const doc = {
      schemaVersion: 1,
      date: '2026-10-01',
      clinicalEpisodeId: 'ep_scale_clock',
      layoutGeneration: 'gen_scale_clock',
      dayRevision: 1,
      vitalSignsHistory: null,
      evaluationScores: {
        braden: {
          code: 'BRADEN',
          name: 'Braden',
          encounterEventId: 20261001101500,
          total: 18,
          severity: 'Riesgo bajo',
          recordedDate: '2026-10-01',
          recordedAt: '01-10-2026 10:15:00 -03:00',
          author: 'Jimena Derivada',
          authorRole: 'Enfermera',
        },
      },
    } as unknown as ClinicalDerivedEpisodeDoc;

    const observations = collectClinicalDerivedStaff([doc]);
    expect(observations).toEqual([
      { author: 'Jimena Derivada', role: 'Enfermera', recordedAt: '2026-10-01T08:15:00' },
    ]);
    expect(mergeEloisaStaff([], observations).map(entry => entry.name)).toEqual([
      'Jimena Derivada',
    ]);
  });

  it('tolerates missing legacy lists and does not infer an unknown author role', () => {
    expect(collectCensusStaff({})).toEqual([]);
    expect(
      mergeEloisaStaff(
        [],
        collectCensusStaff({ date: '2026-09-01', nurses: ['Enfermero/a 1', 'No informado'] })
      )
    ).toEqual([]);
  });
});
