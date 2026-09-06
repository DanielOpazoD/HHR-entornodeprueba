import { describe, expect, it } from 'vitest';
import { collectCensusStaff } from '@/services/staff/censusStaffDiscovery';
import { mergeEloisaStaff } from '@/services/staff/eloisaStaffDiscovery';
import type { DailyRecord } from '@/types/domain/dailyRecord';
describe('census staff discovery', () => {
  it('reads current and historical attributable fields without changing clinical records', () => {
    const record = {
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
    } as unknown as DailyRecord;
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
