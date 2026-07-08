import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
  calculateMinsalStatistics,
} = require('../../../functions/lib/minsal/minsalStatsCalculator.js');

describe('functions minsalStatsCalculator', () => {
  it('returns empty statistics when records are missing', () => {
    const result = calculateMinsalStatistics({
      records: [],
      hospitalCapacity: 12,
      startDate: '2026-02-01',
      endDate: '2026-02-07',
    });

    expect(result.totalDays).toBe(0);
    expect(result.camasDisponibles).toBe(12);
    expect(result.message).toContain('No records');
  });

  it('aggregates occupancy and specialties including clinical cribs', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-02-01',
      endDate: '2026-02-02',
      records: [
        {
          beds: {
            b1: {
              patientName: 'Paciente',
              pathology: 'Diagnóstico cama',
              specialty: 'Obstetricia',
              clinicalCrib: {
                patientName: 'RN',
                pathology: 'Diagnóstico RN',
                specialty: 'Obstetricia',
              },
            },
            b2: { isBlocked: true },
          },
          discharges: [
            {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico egreso',
              status: 'Fallecido',
              originalData: { specialty: 'Obstetricia' },
            },
          ],
          transfers: [
            {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico traslado',
              originalData: { specialty: 'Obstetricia' },
            },
          ],
        },
      ],
    });

    expect(result.diasCamaOcupados).toBe(2);
    expect(result.diasCamaDisponibles).toBe(9);
    expect(result.egresosFallecidos).toBe(1);
    expect(result.egresosTraslados).toBe(1);
    expect(result.porEspecialidad[0]).toMatchObject({
      specialty: 'Ginecobstetricia',
      diasOcupados: 2,
      fallecidos: 1,
      traslados: 1,
    });
    expect(result.porEspecialidad[0].fallecidosList?.[0]?.diagnosis).toBe('Diagnóstico egreso');
    expect(result.porEspecialidad[0].trasladosList?.[0]?.diagnosis).toBe('Diagnóstico traslado');
  });

  it('prefers the corrected admission date observed in the census over stale discharge data', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-01',
      endDate: '2026-03-03',
      records: [
        {
          date: '2026-03-01',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2025-01-01',
            },
          },
        },
        {
          date: '2026-03-02',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-03',
          beds: {
            b1: { patientName: '', rut: '', pathology: '', specialty: '' },
          },
          discharges: [
            {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico egreso',
              status: 'Vivo',
              originalData: { specialty: 'Cirugía', admissionDate: '2025-01-01' },
            },
          ],
        },
      ],
    });

    expect(result.porEspecialidad[0].promedioDiasEstadaMinima).toBe(2);
    expect(result.porEspecialidad[0].promedioDiasEstadaMaxima).toBe(2);
    expect(result.porEspecialidad[0].promedioDiasEstada).toBe(2);
    expect(result.porEspecialidad[0].egresosList?.[0]?.admissionDate).toBe('2026-03-01');
  });

  it('keeps separate episodes for the same RUT when rehospitalized later in the same month', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      records: [
        {
          date: '2026-03-01',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-02',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-03',
          beds: {
            b1: { patientName: '', rut: '', pathology: '', specialty: '' },
          },
          discharges: [
            {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico egreso',
              status: 'Vivo',
              originalData: { specialty: 'Cirugía', admissionDate: '2025-01-01' },
            },
          ],
        },
        {
          date: '2026-03-18',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-18',
            },
          },
        },
        {
          date: '2026-03-19',
          beds: {
            b1: { patientName: '', rut: '', pathology: '', specialty: '' },
          },
          discharges: [
            {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico egreso',
              status: 'Vivo',
              originalData: { specialty: 'Cirugía', admissionDate: '2025-01-01' },
            },
          ],
        },
      ],
    });

    expect(result.egresosTotal).toBe(2);
    expect(result.porEspecialidad[0].promedioDiasEstadaMinima).toBe(1);
    expect(result.porEspecialidad[0].promedioDiasEstadaMaxima).toBe(2);
    expect(result.porEspecialidad[0].egresosList?.[0]?.admissionDate).toBe('2026-03-01');
    expect(result.porEspecialidad[0].egresosList?.[1]?.admissionDate).toBe('2026-03-18');
  });

  it('uses resolved exit stays for DEIS average stay instead of occupied bed-days', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-01',
      endDate: '2026-03-05',
      records: [
        {
          date: '2026-03-01',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-02',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-03',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-04',
          beds: {
            b1: {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              pathology: 'Diagnóstico',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-05',
          beds: {
            b1: { patientName: '', rut: '', pathology: '', specialty: '' },
          },
          discharges: [
            {
              patientName: 'Paciente',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico egreso',
              status: 'Vivo',
              originalData: { specialty: 'Cirugía', admissionDate: '2026-03-01' },
            },
          ],
        },
      ],
    });

    expect(result.diasCamaOcupados).toBe(4);
    expect(result.egresosTotal).toBe(1);
    expect(result.promedioDiasEstada).toBe(4);
    expect(result.porEspecialidad[0].promedioDiasEstada).toBe(4);
  });

  it('does not count tombstoned movements in function-side MINSAL statistics', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-05',
      endDate: '2026-03-05',
      records: [
        {
          date: '2026-03-05',
          beds: {
            b1: { patientName: '', rut: '', pathology: '', specialty: '' },
          },
          discharges: [
            {
              patientName: 'Paciente Eliminado',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico eliminado',
              status: 'Vivo',
              deletedAt: '2026-03-05T12:00:00.000Z',
              originalData: { specialty: 'Cirugía', admissionDate: '2026-03-01' },
            },
          ],
          transfers: [
            {
              patientName: 'Traslado Eliminado',
              rut: '22.222.222-2',
              diagnosis: 'Diagnóstico traslado eliminado',
              deletedAt: '2026-03-05T12:00:00.000Z',
              originalData: { specialty: 'Cirugía', admissionDate: '2026-03-01' },
            },
          ],
        },
      ],
    });

    expect(result.egresosTotal).toBe(0);
    expect(result.egresosVivos).toBe(0);
    expect(result.egresosTraslados).toBe(0);
    expect(result.porEspecialidad).toEqual([]);
  });

  it('excludes invalid discharge chronology from DEIS stay indicators', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-05',
      endDate: '2026-03-05',
      records: [
        {
          date: '2026-03-05',
          beds: {
            b1: { patientName: '', rut: '', pathology: '', specialty: '' },
          },
          discharges: [
            {
              patientName: 'Paciente Inconsistente',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico egreso',
              status: 'Vivo',
              originalData: { specialty: 'Cirugía', admissionDate: '2026-03-07' },
            },
          ],
        },
      ],
    });

    expect(result.egresosTotal).toBe(1);
    expect(result.promedioDiasEstada).toBe(0);
    expect(result.promedioDiasEstadaMinima).toBe(0);
    expect(result.promedioDiasEstadaMaxima).toBe(0);
    expect(result.porEspecialidad[0].promedioDiasEstada).toBe(0);
  });

  it('prefers movement specialty and admissionDate snapshots over stale originalData fields', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-03-01',
      endDate: '2026-03-02',
      records: [
        {
          date: '2026-03-01',
          beds: {
            b1: {
              patientName: 'Paciente Movimiento',
              rut: '8.888.888-8',
              pathology: 'Diagnóstico actual',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
            },
          },
        },
        {
          date: '2026-03-02',
          beds: {
            b1: { patientName: '', rut: '', pathology: '', specialty: '' },
          },
          discharges: [
            {
              patientName: 'Paciente Movimiento',
              rut: '8.888.888-8',
              diagnosis: 'Diagnóstico actual',
              status: 'Vivo',
              specialty: 'Cirugía',
              admissionDate: '2026-03-01',
              originalData: { specialty: 'Medicina', admissionDate: '2025-01-01' },
            },
          ],
        },
      ],
    });

    expect(result.porEspecialidad[0]).toMatchObject({
      specialty: 'Cirugía',
    });
    expect(result.porEspecialidad[0].egresosList?.[0]?.admissionDate).toBe('2026-03-01');
    expect(result.porEspecialidad[0].egresosList?.[0]?.diagnosis).toBe('Diagnóstico actual');
  });
});
