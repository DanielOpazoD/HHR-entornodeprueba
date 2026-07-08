import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  calculateMinsalStatistics,
} = require('../../../functions/lib/minsal/minsalStatsCalculator.js');

describe('functions minsalStatsCalculator CMA and specialty reporting', () => {
  it('keeps CMA outside hospital indicators and exposes function-side CMA breakdown', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-05',
      endDate: '2026-03-05',
      records: [
        {
          date: '2026-03-05',
          beds: {
            b1: {
              patientName: 'Paciente Hospitalizado',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
            },
          },
          cma: [
            {
              id: 'cma-1',
              patientName: 'Paciente CMA',
              rut: '22.222.222-2',
              bedName: 'CMA 1',
              diagnosis: 'Diagnóstico CMA',
              specialty: 'Traumatología',
              interventionType: 'Cirugía Mayor Ambulatoria',
            },
          ],
        },
      ],
    });

    expect(result.diasCamaOcupados).toBe(1);
    expect(result.egresosTotal).toBe(0);
    expect(result.promedioDiasEstada).toBe(0);
    expect(result.cma.total).toBe(1);
    expect(result.cma.porEspecialidad[0]).toMatchObject({
      specialty: 'Traumatología',
      total: 1,
      cirugiaMayorAmbulatoria: 1,
    });
  });

  it('groups and reclassifies movement specialties for function-side reporting only', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-05',
      endDate: '2026-03-05',
      options: {
        specialtyGroupingMode: 'group-other',
        specialtyReclassifications: [
          {
            date: '2026-03-05',
            movementKind: 'discharge',
            movementId: 'd-1',
            specialty: 'Cirugía',
          },
          {
            date: '2026-03-05',
            movementKind: 'cma',
            movementId: 'cma-1',
            specialty: 'Med Interna',
          },
        ],
      },
      records: [
        {
          date: '2026-03-05',
          beds: {
            b1: {
              patientName: 'Paciente Libre',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cardiología',
            },
          },
          discharges: [
            {
              id: 'd-1',
              patientName: 'Alta Reclasificada',
              rut: '22.222.222-2',
              diagnosis: 'Diagnóstico alta',
              status: 'Vivo',
              specialty: 'Oftalmología',
            },
          ],
          cma: [
            {
              id: 'cma-1',
              patientName: 'CMA Reclasificada',
              rut: '33.333.333-3',
              bedName: 'CMA 1',
              diagnosis: 'Diagnóstico CMA',
              specialty: 'Dermatología',
              interventionType: 'Procedimiento Médico Ambulatorio',
            },
          ],
        },
      ],
    });

    expect(
      result.porEspecialidad.find((item: { specialty: string }) => item.specialty === 'Cardiología')
    ).toBeUndefined();
    expect(
      result.porEspecialidad.find(
        (item: { specialty: string }) => item.specialty === 'Oftalmología'
      )
    ).toBeUndefined();
    expect(
      result.porEspecialidad.find((item: { specialty: string }) => item.specialty === 'Otro')
        ?.diasOcupados
    ).toBe(1);
    expect(
      result.porEspecialidad.find((item: { specialty: string }) => item.specialty === 'Cirugía')
        ?.egresos
    ).toBe(1);
    expect(
      result.porEspecialidad.find((item: { specialty: string }) => item.specialty === 'Cirugía')
        ?.egresosList[0]
    ).toMatchObject({
      originalSpecialty: 'Oftalmología',
      reportingSpecialty: 'Cirugía',
      reportingSpecialtySource: 'manual',
    });
    expect(result.cma.porEspecialidad[0]).toMatchObject({
      specialty: 'Med Interna',
      total: 1,
    });
    expect(result.cma.porEspecialidad[0].pacientesList[0]).toMatchObject({
      originalSpecialty: 'Dermatología',
      reportingSpecialty: 'Med Interna',
      reportingSpecialtySource: 'manual',
    });
  });
});
