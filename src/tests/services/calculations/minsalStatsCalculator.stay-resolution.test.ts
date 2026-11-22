// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { BEDS } from '@/constants/beds';
import { calculateMinsalStats } from '@/features/analytics/services/minsalStatsCalculator';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

import { createMockRecord } from './minsalStatsCalculatorTestSupport';

describe('minsalStatsCalculator stay resolution', () => {
  describe('calculateMinsalStats', () => {
    it('should calculate DEIS average stay from resolved discharge stays instead of occupied bed-days', () => {
      const day1 = createMockRecord('2026-03-01', 1);
      const day2 = createMockRecord('2026-03-02', 1);
      const day3 = createMockRecord('2026-03-03', 1);
      const day4 = createMockRecord('2026-03-04', 1);
      const day5 = createMockRecord('2026-03-05', 0);

      const bedId = BEDS[0].id;
      const patient = {
        ...day1.beds[bedId],
        patientName: 'Paciente DEIS',
        rut: '7.777.777-7',
        specialty: Specialty.CIRUGIA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-03-01',
        admissionTime: '08:00',
      } as PatientData;

      day1.beds[bedId] = patient;
      day2.beds[bedId] = patient;
      day3.beds[bedId] = patient;
      day4.beds[bedId] = patient;
      day5.discharges = [
        {
          id: 'deis-1',
          patientName: 'Paciente DEIS',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '7.777.777-7',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-03-01',
          } as never,
        },
      ];

      const stats = calculateMinsalStats(
        [day1, day2, day3, day4, day5],
        '2026-03-01',
        '2026-03-05'
      );

      expect(stats.diasCamaOcupados).toBe(4);
      expect(stats.egresosTotal).toBe(1);
      expect(stats.promedioDiasEstada).toBe(4);
    });

    it('should exclude invalid discharge chronology from DEIS stay indicators', () => {
      const record = createMockRecord('2026-03-05', 0);
      record.discharges = [
        {
          id: 'invalid-chronology',
          patientName: 'Paciente Inconsistente',
          status: 'Vivo',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '1.111.111-1',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-03-07',
          } as never,
        },
      ];

      const stats = calculateMinsalStats([record], '2026-03-05', '2026-03-05');
      const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

      expect(stats.egresosTotal).toBe(1);
      expect(stats.promedioDiasEstada).toBe(0);
      expect(stats.promedioDiasEstadaMinima).toBe(0);
      expect(stats.promedioDiasEstadaMaxima).toBe(0);
      expect(cirugia?.promedioDiasEstada).toBe(0);
      expect(cirugia?.promedioDiasEstadaMinima).toBe(0);
      expect(cirugia?.promedioDiasEstadaMaxima).toBe(0);
    });

    it('should prefer the corrected admission date observed in the census over stale discharge data', () => {
      const bedId = BEDS[0].id;
      const day1 = createMockRecord('2026-03-01', 0);
      const day2 = createMockRecord('2026-03-02', 0);
      const day3 = createMockRecord('2026-03-03', 0);

      const basePatient = {
        ...day1.beds[bedId],
        patientName: 'Paciente Cambio',
        rut: '9.999.999-9',
        specialty: Specialty.CIRUGIA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2025-01-01',
        admissionTime: '08:00',
      } as PatientData;

      day1.beds[bedId] = basePatient;
      day2.beds[bedId] = {
        ...basePatient,
        admissionDate: '2026-03-01',
      };
      day3.discharges = [
        {
          id: '1',
          patientName: 'Paciente Cambio',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '9.999.999-9',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2025-01-01',
          } as never,
        },
      ];

      const stats = calculateMinsalStats([day1, day2, day3], '2026-03-01', '2026-03-03');
      const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

      expect(cirugia?.promedioDiasEstadaMinima).toBe(2);
      expect(cirugia?.promedioDiasEstadaMaxima).toBe(2);
      expect(stats.promedioDiasEstadaMinima).toBe(2);
      expect(stats.promedioDiasEstadaMaxima).toBe(2);
      expect(cirugia?.egresosList?.[0]?.admissionDate).toBe('2026-03-01');
    });

    it('should measure stay range from a consistent admission snapshot when no correction is needed', () => {
      const day1 = createMockRecord('2026-01-01', 1);
      const day2 = createMockRecord('2026-01-02', 1);
      const day3 = createMockRecord('2026-01-03', 1);

      const bedId = BEDS[0].id;
      const basePatient = {
        ...day1.beds[bedId],
        patientName: 'Paciente Cambio',
        rut: '9.999.999-9',
        admissionDate: '2026-01-01',
      } as PatientData;

      day1.beds[bedId] = { ...basePatient, specialty: Specialty.MEDICINA };
      day2.beds[bedId] = { ...basePatient, specialty: Specialty.CIRUGIA };
      day3.beds[bedId] = { ...basePatient, specialty: Specialty.CIRUGIA };
      day3.discharges = [
        {
          id: 'x1',
          patientName: 'Paciente Cambio',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '9.999.999-9',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2026-01-01',
          } as never,
        },
      ];

      const stats = calculateMinsalStats([day1, day2, day3], '2026-01-01', '2026-01-03');
      const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

      expect(cirugia?.promedioDiasEstadaMinima).toBe(2);
      expect(cirugia?.promedioDiasEstadaMaxima).toBe(2);
    });

    it('should close one episode and reopen a new one when the same RUT re-enters after discharge', () => {
      const bedId = BEDS[0].id;
      const day1 = createMockRecord('2026-03-01', 1);
      const day2 = createMockRecord('2026-03-02', 1);
      const day3 = createMockRecord('2026-03-03', 0);
      const day4 = createMockRecord('2026-03-04', 1);
      const day5 = createMockRecord('2026-03-05', 0);

      const firstEpisodePatient = {
        ...day1.beds[bedId],
        patientName: 'Paciente Reingreso',
        rut: '9.999.999-9',
        specialty: Specialty.CIRUGIA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-03-01',
        admissionTime: '08:00',
      } as PatientData;

      const secondEpisodePatient = {
        ...firstEpisodePatient,
        admissionDate: '2026-03-04',
      } as PatientData;

      day1.beds[bedId] = firstEpisodePatient;
      day2.beds[bedId] = firstEpisodePatient;
      day3.discharges = [
        {
          id: 'd1',
          patientName: 'Paciente Reingreso',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '9.999.999-9',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2025-01-01',
          } as never,
        },
      ];
      day4.beds[bedId] = secondEpisodePatient;
      day5.discharges = [
        {
          id: 'd2',
          patientName: 'Paciente Reingreso',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '9.999.999-9',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2025-01-01',
          } as never,
        },
      ];

      const stats = calculateMinsalStats(
        [day1, day2, day3, day4, day5],
        '2026-03-01',
        '2026-03-05'
      );
      const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

      expect(cirugia?.egresos).toBe(2);
      expect(cirugia?.promedioDiasEstadaMinima).toBe(1);
      expect(cirugia?.promedioDiasEstadaMaxima).toBe(2);
      expect(cirugia?.egresosList?.[0]?.admissionDate).toBe('2026-03-01');
      expect(cirugia?.egresosList?.[1]?.admissionDate).toBe('2026-03-04');
    });

    it('should keep separate episodes for the same RUT when rehospitalized later in the same month', () => {
      const bedId = BEDS[0].id;
      const day1 = createMockRecord('2026-03-01', 1);
      const day2 = createMockRecord('2026-03-02', 1);
      const day3 = createMockRecord('2026-03-03', 0);
      const day4 = createMockRecord('2026-03-18', 1);
      const day5 = createMockRecord('2026-03-19', 0);

      const firstEpisodePatient = {
        ...day1.beds[bedId],
        patientName: 'Paciente Reingreso',
        rut: '9.999.999-9',
        specialty: Specialty.CIRUGIA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-03-01',
        admissionTime: '08:00',
      } as PatientData;

      const secondEpisodePatient = {
        ...firstEpisodePatient,
        admissionDate: '2026-03-18',
      } as PatientData;

      day1.beds[bedId] = firstEpisodePatient;
      day2.beds[bedId] = firstEpisodePatient;
      day3.discharges = [
        {
          id: 'd1',
          patientName: 'Paciente Reingreso',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '9.999.999-9',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2025-01-01',
          } as never,
        },
      ];
      day4.beds[bedId] = secondEpisodePatient;
      day5.discharges = [
        {
          id: 'd2',
          patientName: 'Paciente Reingreso',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '9.999.999-9',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.CIRUGIA,
            admissionDate: '2025-01-01',
          } as never,
        },
      ];

      const stats = calculateMinsalStats(
        [day1, day2, day3, day4, day5],
        '2026-03-01',
        '2026-03-31'
      );
      const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

      expect(cirugia?.egresos).toBe(2);
      expect(cirugia?.promedioDiasEstadaMinima).toBe(1);
      expect(cirugia?.promedioDiasEstadaMaxima).toBe(2);
      expect(cirugia?.egresosList?.[0]?.admissionDate).toBe('2026-03-01');
      expect(cirugia?.egresosList?.[1]?.admissionDate).toBe('2026-03-18');
    });

    it('should prefer movement specialty and admissionDate snapshots over stale originalData fields', () => {
      const bedId = BEDS[0].id;
      const day1 = createMockRecord('2026-03-01', 1);
      const day2 = createMockRecord('2026-03-02', 0);

      day1.beds[bedId] = {
        ...day1.beds[bedId],
        patientName: 'Paciente Movimiento',
        rut: '8.888.888-8',
        specialty: Specialty.CIRUGIA,
        pathology: 'Diagnóstico actual',
        admissionDate: '2026-03-01',
        admissionTime: '08:00',
        status: PatientStatus.ESTABLE,
      } as PatientData;

      day2.discharges = [
        {
          id: 'd-top-level',
          patientName: 'Paciente Movimiento',
          status: 'Vivo',
          bedName: '',
          bedId,
          bedType: '',
          rut: '8.888.888-8',
          diagnosis: 'Diagnóstico actual',
          specialty: Specialty.CIRUGIA,
          admissionDate: '2026-03-01',
          time: '',
          originalData: {
            specialty: Specialty.MEDICINA,
            admissionDate: '2025-01-01',
            pathology: 'Diagnóstico legacy',
          } as never,
        },
      ];

      const stats = calculateMinsalStats([day1, day2], '2026-03-01', '2026-03-02');
      const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);

      expect(cirugia?.egresos).toBe(1);
      expect(cirugia?.egresosList?.[0]?.admissionDate).toBe('2026-03-01');
      expect(cirugia?.egresosList?.[0]?.diagnosis).toBe('Diagnóstico actual');
    });
  });
});
