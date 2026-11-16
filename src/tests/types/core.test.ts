// @vitest-environment node
/**
 * Tests for core contracts that still add behavioral signal.
 * Avoids trivial enum/constant assertions.
 */

import { describe, it, expect } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { Statistics } from '@/types/domain/statistics';

describe('core contracts', () => {
  describe('PatientData interface structure', () => {
    it('should allow creating valid patient data', () => {
      const patient: PatientData = {
        bedId: 'R1',
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: 'Juan Pérez',
        rut: '12.345.678-9',
        pathology: 'Neumonía',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2026-01-15',
        admissionTime: '10:00',
        age: '45',
        hasWristband: false,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
      };
      expect(patient.patientName).toBe('Juan Pérez');
      expect(patient.specialty).toBe('Med Interna');
    });

    it('should allow blocked bed configuration', () => {
      const bed: PatientData = {
        bedId: 'R2',
        isBlocked: true,
        blockedReason: 'Mantención',
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: '',
        rut: '',
        pathology: '',
        specialty: Specialty.EMPTY,
        status: PatientStatus.EMPTY,
        admissionDate: '',
        admissionTime: '',
        age: '',
        hasWristband: false,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
      };
      expect(bed.isBlocked).toBe(true);
      expect(bed.blockedReason).toBe('Mantención');
    });

    it('should allow patient with CUDYR score and invasive devices', () => {
      const patient: PatientData = {
        bedId: 'H1C1',
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: 'María López',
        rut: '11.111.111-1',
        pathology: 'Test',
        specialty: Specialty.CIRUGIA,
        status: PatientStatus.DE_CUIDADO,
        admissionDate: '2026-01-10',
        admissionTime: '08:00',
        age: '60',
        cudyr: {
          changeClothes: 2,
          mobilization: 3,
          feeding: 1,
          elimination: 2,
          psychosocial: 1,
          surveillance: 2,
          vitalSigns: 2,
          fluidBalance: 1,
          oxygenTherapy: 0,
          airway: 0,
          proInterventions: 1,
          skinCare: 2,
          pharmacology: 2,
          invasiveElements: 1,
        },
        hasWristband: true,
        devices: ['CVC'],
        surgicalComplication: false,
        isUPC: true,
      };
      expect(patient.cudyr?.mobilization).toBe(3);
      expect(patient.devices).toContain('CVC');
    });
  });

  describe('movement-related structures', () => {
    it('should allow discharge records with operational status', () => {
      const discharge: DischargeData = {
        id: 'discharge-1',
        bedName: 'R1',
        bedId: 'R1',
        bedType: 'UTI',
        patientName: 'Test Patient',
        rut: '12.345.678-9',
        diagnosis: 'Recuperado',
        time: '10:00',
        status: 'Vivo',
      };
      expect(discharge.status).toBe('Vivo');
    });

    it('should allow transfer records with destination metadata', () => {
      const transfer: TransferData = {
        id: 'transfer-1',
        bedName: 'UTI-01',
        bedId: 'R1',
        bedType: 'UTI',
        patientName: 'Transfer Patient',
        rut: '12.345.678-9',
        diagnosis: 'Requiere cirugía mayor',
        time: '12:00',
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital Regional',
      };
      expect(transfer.receivingCenter).toBe('Hospital Regional');
      expect(transfer.evacuationMethod).toBe('Ambulancia');
    });

    it('should allow CMA records with intervention metadata', () => {
      const cma: CMAData = {
        id: 'cma-1',
        bedName: 'CMA',
        patientName: 'CMA Patient',
        rut: '12.345.678-9',
        age: '50',
        diagnosis: 'Hernia inguinal',
        specialty: 'Cirugía',
        interventionType: 'Cirugía Mayor Ambulatoria',
      };
      expect(cma.interventionType).toBe('Cirugía Mayor Ambulatoria');
    });
  });

  describe('DailyRecord and Statistics contracts', () => {
    it('should support canonical staff contracts for day and night shifts', () => {
      const record: DailyRecord = {
        date: '2026-01-15',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-01-15T00:00:00.000Z',
        nursesDayShift: ['Enfermera 1', 'Enfermera 2'],
        nursesNightShift: ['Enfermera 3', 'Enfermera 4'],
        activeExtraBeds: [],
      };
      expect(record.nursesDayShift).toHaveLength(2);
      expect(record.nursesNightShift).toContain('Enfermera 4');
    });

    it('should include service capacity metrics', () => {
      const stats: Statistics = {
        occupiedBeds: 15,
        occupiedCribs: 2,
        clinicalCribsCount: 1,
        companionCribs: 1,
        totalCribsUsed: 2,
        totalHospitalized: 17,
        blockedBeds: 1,
        serviceCapacity: 18,
        availableCapacity: 2,
      };
      expect(stats.totalHospitalized).toBe(17);
      expect(stats.availableCapacity).toBe(2);
    });
  });
});
