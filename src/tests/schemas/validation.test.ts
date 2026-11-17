// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  CudyrScoreSchema,
  DailyRecordSchema,
  PatientDataSchema,
  SpecialtySchema,
  parseDailyRecordWithDefaults,
} from '@/schemas/zodSchemas';
import { Specialty } from '@/types/domain/patientClassification';

describe('validation schemas', () => {
  describe('PatientDataSchema', () => {
    it('should validate valid patient data', () => {
      const validData = {
        bedId: 'R1',
        isBlocked: false,
        patientName: 'Test',
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
        bedMode: 'Cama',
      };
      const result = PatientDataSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should return errors for invalid patient data', () => {
      const invalidData = {
        bedId: '', // error: min 1
        isBlocked: 'not-a-boolean', // error: expected boolean
      };
      const result = PatientDataSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      expect(result.error?.issues.length).toBeGreaterThan(0);
    });
  });

  describe('DailyRecordSchema', () => {
    it('should validate valid daily record', () => {
      const validData = {
        date: '2025-01-01',
        beds: {},
        discharges: [],
        transfers: [],
        lastUpdated: '2025-01-01T00:00:00.000Z',
      };
      const result = DailyRecordSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should return errors for invalid daily record', () => {
      const invalidData = {
        date: 'invalid-date',
        beds: 'not-an-object',
      };
      const result = DailyRecordSchema.safeParse(invalidData);
      expect(result.success).toBe(false);
      expect(result.error?.issues.length).toBeGreaterThan(0);
    });
  });

  describe('CudyrScoreSchema', () => {
    it('should validate valid score', () => {
      const validScore = {
        changeClothes: 1,
        mobilization: 2,
        feeding: 3,
        elimination: 4,
        psychosocial: 0,
        surveillance: 1,
        vitalSigns: 2,
        fluidBalance: 3,
        oxygenTherapy: 4,
        airway: 0,
        proInterventions: 1,
        skinCare: 2,
        pharmacology: 3,
        invasiveElements: 4,
      };
      const result = CudyrScoreSchema.safeParse(validScore);
      expect(result.success).toBe(true);
    });

    it('should handle out of bounds values gracefully (resilience)', () => {
      const invalidScore = {
        changeClothes: 5, // max 4
        mobilization: -1, // min 0
      };
      const result = CudyrScoreSchema.safeParse(invalidScore);
      // Schema now uses .catch(0), so it should succeed and replace with 0
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.changeClothes).toBe(0); // 5 -> 0
        expect(result.data.mobilization).toBe(0); // -1 -> 0
      }
    });

    it('should handle missing fields gracefully (resilience)', () => {
      const incompleteScore = {
        changeClothes: 1,
      };
      const result = CudyrScoreSchema.safeParse(incompleteScore);
      expect(result.success).toBe(true);
      if (result.success && result.data) {
        expect(result.data.changeClothes).toBe(1);
        // Missing fields defaulted to 0
        expect(result.data.mobilization).toBe(0);
      }
    });
  });

  describe('Edge Cases for Branch Coverage', () => {
    it('PatientDataSchema should handle nested clinicalCrib', () => {
      const patientWithCrib = {
        bedId: 'M1',
        isBlocked: false,
        hasWristband: true,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
        bedMode: 'Cama',
        clinicalCrib: {
          bedId: 'M1-Crib',
          isBlocked: false,
          hasWristband: false,
          devices: [],
          surgicalComplication: false,
          isUPC: false,
          bedMode: 'Cuna',
        },
      };
      const result = PatientDataSchema.safeParse(patientWithCrib);
      expect(result.success).toBe(true);
    });

    it('DailyRecordSchema should handle all optional fields', () => {
      const recordWithOptionals = {
        date: '2025-01-01',
        beds: {},
        discharges: [],
        transfers: [],
        lastUpdated: '2025-01-01T00:00:00.000Z',
        nurseName: 'Test Nurse',
        nursesDayShift: ['Ana', 'Pedro'],
        nursesNightShift: ['Luis'],
        tensDayShift: ['Maria'],
        tensNightShift: [],
        handoffDayChecklist: { item1: true },
        handoffNovedadesDayShift: 'Sin novedades',
        handoffNightChecklist: { item2: false },
        handoffNovedadesNightShift: 'Paciente estable',
        medicalHandoffDoctor: 'Dr. Test',
        medicalHandoffSentAt: '10:00',
        medicalSignature: {
          doctorName: 'Dr. Test',
          signedAt: '10:05',
          userAgent: 'Chrome',
        },
      };
      const result = DailyRecordSchema.safeParse(recordWithOptionals);
      expect(result.success).toBe(true);
    });

    it('should migrate legacy specialties', () => {
      // Testing the Zod preprocess in SpecialtySchema (indirectly via PatientDataSchema or directly if exported)
      expect(SpecialtySchema.parse('Ginecología')).toBe(Specialty.GINECOBSTETRICIA);
      expect(SpecialtySchema.parse('Obstetricia')).toBe(Specialty.GINECOBSTETRICIA);
      expect(SpecialtySchema.parse(Specialty.CIRUGIA)).toBe(Specialty.CIRUGIA);
    });

    it('should accept custom free-text specialties', () => {
      expect(SpecialtySchema.parse('ORL')).toBe('ORL');
      expect(SpecialtySchema.parse('Cardiología')).toBe('Cardiología');
    });

    it('should salvage partially corrupted records', () => {
      const corrupted = {
        date: '2025-01-01',
        beds: 'this-should-be-an-object', // Corrupted
        nurses: null,
      };
      const result = parseDailyRecordWithDefaults(corrupted, '2025-01-01');
      expect(result.date).toBe('2025-01-01');
      expect(result.beds).toEqual({});
      expect(result.nurses).toEqual(['', '']);
    });
  });
});
