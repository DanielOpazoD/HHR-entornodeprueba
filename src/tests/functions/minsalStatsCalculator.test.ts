// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { BEDS, HOSPITAL_CAPACITY } from '@/constants/beds';
import { calculateMinsalStats } from '@/features/analytics/services/minsalStatsCalculator';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { DailyRecordMovementState } from '@/types/domain/dailyRecordSlices';
import type { PatientData } from '@/types/domain/patient';

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

  it('aggregates occupancy and specialties without double-counting nested clinical cribs', () => {
    const result = calculateMinsalStatistics({
      hospitalCapacity: 10,
      startDate: '2026-02-01',
      endDate: '2026-02-02',
      records: [
        {
          date: '2026-02-01',
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

    expect(result.diasCamaOcupados).toBe(1);
    expect(result.diasCamaDisponibles).toBe(9);
    expect(result.egresosFallecidos).toBe(1);
    expect(result.egresosTraslados).toBe(1);
    expect(result.porEspecialidad[0]).toMatchObject({
      specialty: 'Ginecobstetricia',
      diasOcupados: 1,
      fallecidos: 1,
      traslados: 1,
    });
    expect(result.porEspecialidad[0].diasOcupadosList).toHaveLength(1);
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

  it('matches browser MINSAL totals for nested cribs, crib discharges, and newborns in their own bed', () => {
    const motherBed = BEDS[0];
    const newbornOwnBed = BEDS[1];
    const makePatient = (overrides: Partial<PatientData>): PatientData => ({
      bedId: motherBed.id,
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      patientName: '',
      rut: '',
      age: '',
      pathology: '',
      specialty: Specialty.EMPTY,
      status: PatientStatus.EMPTY,
      admissionDate: '',
      hasWristband: false,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
      ...overrides,
    });

    const motherWithNestedCribRecord: DailyRecordMovementState = {
      date: '2026-03-10',
      beds: {
        [motherBed.id]: makePatient({
          bedId: motherBed.id,
          patientName: 'Madre Sintética',
          rut: '12.345.678-9',
          age: '29',
          pathology: 'Puerperio fisiológico',
          specialty: Specialty.GINECOBSTETRICIA,
          status: PatientStatus.ESTABLE,
          admissionDate: '2026-03-09',
          clinicalCrib: makePatient({
            bedId: `${motherBed.id}-crib`,
            bedMode: 'Cuna',
            patientName: 'RN Sintético Anidado',
            rut: '99.111.222-3',
            age: '0',
            pathology: 'Recién nacido sano',
            specialty: Specialty.PEDIATRIA,
            status: PatientStatus.ESTABLE,
            admissionDate: '2026-03-09',
          }),
        }),
      },
      discharges: [
        {
          id: 'd-nested-crib',
          movementDate: '2026-03-10',
          bedName: motherBed.name,
          bedId: motherBed.id,
          bedType: 'Cuna',
          patientName: 'RN Sintético Anidado',
          rut: '99.111.222-3',
          diagnosis: 'Recién nacido sano',
          time: '11:00',
          status: 'Vivo',
          isNested: true,
          specialty: Specialty.PEDIATRIA,
          admissionDate: '2026-03-09',
        },
        {
          id: 'd-standalone-crib',
          movementDate: '2026-03-10',
          bedName: newbornOwnBed.name,
          bedId: newbornOwnBed.id,
          bedType: 'Cuna',
          patientName: 'RN Cuna Independiente',
          rut: '99.333.444-5',
          diagnosis: 'Observación neonatal',
          time: '12:00',
          status: 'Vivo',
          isNested: false,
          specialty: Specialty.PEDIATRIA,
          admissionDate: '2026-03-09',
        },
      ],
      transfers: [],
      cma: [],
    };

    const clientMotherStats = calculateMinsalStats(
      [motherWithNestedCribRecord],
      '2026-03-10',
      '2026-03-10'
    );
    const serverMotherStats = calculateMinsalStatistics({
      records: [motherWithNestedCribRecord],
      hospitalCapacity: HOSPITAL_CAPACITY,
      startDate: '2026-03-10',
      endDate: '2026-03-10',
    });

    // Census keeps the crib departures visible, while MINSAL counts 1 bed-day and 0 statistical discharges.
    expect(motherWithNestedCribRecord.discharges).toHaveLength(2);
    expect(clientMotherStats.diasCamaOcupados).toBe(1);
    expect(serverMotherStats.diasCamaOcupados).toBe(1);
    expect(clientMotherStats.egresosTotal).toBe(0);
    expect(serverMotherStats.egresosTotal).toBe(0);
    expect(clientMotherStats.egresosVivos).toBe(0);
    expect(serverMotherStats.egresosVivos).toBe(0);
    expect(serverMotherStats.porEspecialidad).toHaveLength(1);
    expect(serverMotherStats.porEspecialidad[0]).toMatchObject({
      specialty: Specialty.GINECOBSTETRICIA,
      diasOcupados: 1,
      egresos: 0,
    });

    // A newborn hospitalized in its own bed (bedMode: 'Cama') counts in both routes.
    const newbornOwnBedRecord: DailyRecordMovementState = {
      date: '2026-03-11',
      beds: {
        [newbornOwnBed.id]: makePatient({
          bedId: newbornOwnBed.id,
          bedMode: 'Cama',
          patientName: 'RN Hospitalizado Cama Propia',
          rut: '99.555.666-7',
          age: '0',
          pathology: 'Ictericia neonatal',
          specialty: Specialty.PEDIATRIA,
          status: PatientStatus.ESTABLE,
          admissionDate: '2026-03-10',
        }),
      },
      discharges: [
        {
          id: 'd-newborn-own-bed',
          movementDate: '2026-03-11',
          bedName: newbornOwnBed.name,
          bedId: newbornOwnBed.id,
          bedType: 'Básica',
          patientName: 'RN Hospitalizado Cama Propia',
          rut: '99.555.666-7',
          diagnosis: 'Ictericia neonatal',
          time: '15:00',
          status: 'Vivo',
          isNested: false,
          specialty: Specialty.PEDIATRIA,
          admissionDate: '2026-03-10',
          originalData: makePatient({
            bedId: newbornOwnBed.id,
            bedMode: 'Cama',
            patientName: 'RN Hospitalizado Cama Propia',
            rut: '99.555.666-7',
            age: '0',
            pathology: 'Ictericia neonatal',
            specialty: Specialty.PEDIATRIA,
            status: PatientStatus.ESTABLE,
            admissionDate: '2026-03-10',
          }),
        },
      ],
      transfers: [],
      cma: [],
    };

    const clientNewbornStats = calculateMinsalStats(
      [newbornOwnBedRecord],
      '2026-03-11',
      '2026-03-11'
    );
    const serverNewbornStats = calculateMinsalStatistics({
      records: [newbornOwnBedRecord],
      hospitalCapacity: HOSPITAL_CAPACITY,
      startDate: '2026-03-11',
      endDate: '2026-03-11',
    });

    expect(clientNewbornStats.diasCamaOcupados).toBe(1);
    expect(serverNewbornStats.diasCamaOcupados).toBe(1);
    expect(clientNewbornStats.egresosTotal).toBe(1);
    expect(serverNewbornStats.egresosTotal).toBe(1);
    expect(clientNewbornStats.egresosVivos).toBe(1);
    expect(serverNewbornStats.egresosVivos).toBe(1);
    expect(serverNewbornStats.porEspecialidad[0]).toMatchObject({
      specialty: Specialty.PEDIATRIA,
      diasOcupados: 1,
      egresos: 1,
    });
  });
});
