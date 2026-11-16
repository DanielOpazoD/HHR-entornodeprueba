// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { BEDS } from '@/constants/beds';
import {
  buildSpecialtyTraceability,
  calculateMinsalStats,
} from '@/services/calculations/minsalStatsCalculator';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

import { createMockRecord } from './minsalStatsCalculatorTestSupport';

describe('minsalStatsCalculator aggregate stats', () => {
  describe('calculateMinsalStats', () => {
    it('should calculate period start and end', () => {
      const records = [createMockRecord('2026-01-01'), createMockRecord('2026-01-02')];
      const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-02');
      expect(stats.periodStart).toBe('2026-01-01');
      expect(stats.periodEnd).toBe('2026-01-02');
    });

    it('should calculate total days with data', () => {
      const records = [
        createMockRecord('2026-01-01'),
        createMockRecord('2026-01-03'),
        createMockRecord('2026-01-05'),
      ];
      const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-05');
      expect(stats.totalDays).toBe(3);
    });

    it('should calculate discharges correctly', () => {
      const record = createMockRecord('2026-01-01', 10);
      record.discharges = [
        {
          id: '1',
          patientName: 'P1',
          status: 'Vivo',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
        },
        {
          id: '2',
          patientName: 'P2',
          status: 'Fallecido',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
        },
      ];
      const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
      expect(stats.egresosVivos).toBe(1);
      expect(stats.egresosFallecidos).toBe(1);
    });

    it('should calculate transfers correctly', () => {
      const record = createMockRecord('2026-01-01', 10);
      record.transfers = [
        {
          id: '1',
          patientName: 'P1',
          receivingCenter: 'Hospital X',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
          evacuationMethod: '',
        },
      ];
      const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
      expect(stats.egresosTraslados).toBe(1);
    });

    it('should include specialty breakdown', () => {
      const records = [createMockRecord('2026-01-01', 10)];
      const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-01');
      expect(stats.porEspecialidad).toBeDefined();
      expect(Array.isArray(stats.porEspecialidad)).toBe(true);
    });

    it('should calculate occupancy rate', () => {
      const records = [createMockRecord('2026-01-01', 12)];
      const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-01');
      expect(stats.tasaOcupacion).toBeGreaterThanOrEqual(0);
      expect(stats.tasaOcupacion).toBeLessThanOrEqual(100);
    });

    it('should calculate mortality rate', () => {
      const record = createMockRecord('2026-01-01', 10);
      record.discharges = [
        {
          id: '1',
          status: 'Vivo',
          patientName: '',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
        },
        {
          id: '2',
          status: 'Fallecido',
          patientName: '',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
        },
      ];
      const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
      expect(stats.mortalidadHospitalaria).toBe(50);
    });

    it('should handle empty records', () => {
      const stats = calculateMinsalStats([], '2026-01-01', '2026-01-01');
      expect(stats.totalDays).toBe(0);
      expect(stats.diasCamaOcupados).toBe(0);
    });

    it('should calculate camasLibres correctly (available - occupied)', () => {
      const record = createMockRecord('2026-01-01', 10, 2);
      const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
      expect(stats.camasLibres).toBe(6);
    });

    it('should select the latest record WITH DATA for "Situación de hoy"', () => {
      const records = [createMockRecord('2026-01-01', 10), createMockRecord('2026-01-02', 0)];
      const stats = calculateMinsalStats(records, '2026-01-01', '2026-01-02');
      expect(stats.pacientesActuales).toBe(10);
      expect(stats.camasLibres).toBe(8);
    });

    it('should calculate rotation index correctly and upscale to 30 days', () => {
      const record = createMockRecord('2026-01-01', 10);
      record.discharges = Array(5).fill({
        id: '1',
        status: 'Vivo',
        patientName: '',
        bedName: '',
        bedId: '',
        bedType: '',
        rut: '',
        diagnosis: '',
        time: '',
      });
      const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
      expect(stats.indiceRotacion).toBeCloseTo(8.3, 1);
    });

    it('should keep period discharges and mortality independent from latest snapshot occupancy', () => {
      const firstRecord = createMockRecord('2026-01-01', 8);
      firstRecord.discharges = [
        {
          id: '1',
          status: 'Vivo',
          patientName: 'Alta 1',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
        },
        {
          id: '2',
          status: 'Fallecido',
          patientName: 'Alta 2',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
        },
      ];

      const latestRecord = createMockRecord('2026-01-02', 12);
      const stats = calculateMinsalStats([firstRecord, latestRecord], '2026-01-01', '2026-01-02');

      expect(stats.egresosTotal).toBe(2);
      expect(stats.egresosVivos).toBe(1);
      expect(stats.egresosFallecidos).toBe(1);
      expect(stats.mortalidadHospitalaria).toBe(50);
      expect(stats.pacientesActuales).toBe(12);
      expect(stats.camasOcupadas).toBe(12);
    });

    it('should keep specialty bed-days aligned with global occupied bed-days when a nested clinical crib exists', () => {
      const record = createMockRecord('2026-01-01', 1);
      const bedId = BEDS[0].id;

      record.beds[bedId].clinicalCrib = {
        bedId,
        isBlocked: false,
        patientName: 'RN Clínico',
        rut: '99.999.999-9',
        pathology: 'Control neonatal',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-01-01',
        admissionTime: '11:00',
        age: '0',
        bedMode: 'Cuna',
        hasCompanionCrib: false,
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
      };

      const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
      const medicina = stats.porEspecialidad.find(item => item.specialty === Specialty.MEDICINA);

      expect(stats.diasCamaOcupados).toBe(1);
      expect(medicina?.diasOcupados).toBe(1);
      expect(medicina?.pacientesActuales).toBe(1);
      expect(medicina?.diasOcupadosList).toHaveLength(1);

      const traceability = buildSpecialtyTraceability([record], Specialty.MEDICINA, 'dias-cama');
      expect(traceability).toHaveLength(1);
      expect(traceability[0]?.name).toBe('Patient 1');
    });

    it('should calculate specialty stay average using all discharge modes', () => {
      const record = createMockRecord('2026-01-01', 4);
      record.discharges = [
        {
          id: '1',
          patientName: 'Alta 1',
          status: 'Vivo',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
          originalData: {
            specialty: Specialty.MEDICINA,
            admissionDate: '2025-12-29',
          } as never,
        },
      ];
      record.transfers = [
        {
          id: '2',
          patientName: 'Traslado 1',
          receivingCenter: 'Hospital X',
          bedName: '',
          bedId: '',
          bedType: '',
          rut: '',
          diagnosis: '',
          time: '',
          evacuationMethod: '',
          originalData: {
            specialty: Specialty.MEDICINA,
            admissionDate: '2025-12-30',
          } as never,
        },
      ];

      const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');
      const medicina = stats.porEspecialidad.find(item => item.specialty === Specialty.MEDICINA);

      expect(medicina?.diasOcupados).toBe(4);
      expect(medicina?.egresos).toBe(1);
      expect(medicina?.traslados).toBe(1);
      expect(medicina?.promedioDiasEstada).toBe(2.5);
      expect(stats.promedioDiasEstada).toBe(2.5);
      expect(medicina?.promedioDiasEstadaMinima).toBe(2);
      expect(medicina?.promedioDiasEstadaMaxima).toBe(3);
      expect(stats.promedioDiasEstadaMinima).toBe(2);
      expect(stats.promedioDiasEstadaMaxima).toBe(3);
    });
  });
});
