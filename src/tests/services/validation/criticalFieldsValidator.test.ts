// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { validateCriticalFields } from '@/services/validation/criticalFieldsValidator';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

// Mock BEDS
vi.mock('@/constants/beds', () => ({
  BEDS: [
    { id: 'R1', name: 'R1', type: 'UTI', isExtra: false },
    { id: 'M1', name: 'M1', type: 'MEDIA', isExtra: false },
    { id: 'EX1', name: 'EX1', type: 'MEDIA', isExtra: true },
  ],
}));

describe('criticalFieldsValidator', () => {
  const createPatient = (overrides: Partial<PatientData> = {}): PatientData => ({
    bedId: 'R1',
    patientName: 'Test Patient',
    rut: '12345678-9',
    age: '45',
    pathology: 'Test',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '2025-01-01',
    admissionTime: '10:00',
    devices: [],
    isBlocked: false,
    hasWristband: true,
    surgicalComplication: false,
    isUPC: false,
    bedMode: 'Cama' as const,
    hasCompanionCrib: false,
    ...overrides,
  });

  const createRecord = (beds: Record<string, PatientData>): DailyRecord => ({
    date: '2025-01-01',
    beds,
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    lastUpdated: '2025-01-01T00:00:00.000Z',
    activeExtraBeds: [],
  });

  describe('validateCriticalFields', () => {
    it('should return valid for complete patient data', () => {
      const record = createRecord({
        R1: createPatient(),
      });

      const result = validateCriticalFields(record);
      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect missing status', () => {
      const record = createRecord({
        R1: createPatient({ status: PatientStatus.EMPTY }),
      });

      const result = validateCriticalFields(record);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].missingFields).toContain('status');
    });

    it('should detect missing admissionDate', () => {
      const record = createRecord({
        R1: createPatient({ admissionDate: '' }),
      });

      const result = validateCriticalFields(record);
      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].missingFields).toContain('admissionDate');
    });

    it('should detect multiple missing fields', () => {
      const record = createRecord({
        R1: createPatient({ status: PatientStatus.EMPTY, admissionDate: '' }),
      });

      const result = validateCriticalFields(record);
      expect(result.isValid).toBe(false);
      expect(result.issues[0].missingFields).toHaveLength(2);
    });

    it('should ignore empty beds', () => {
      const record = createRecord({
        R1: createPatient({
          patientName: '',
          status: PatientStatus.EMPTY,
          admissionDate: '',
        }),
      });

      const result = validateCriticalFields(record);
      expect(result.isValid).toBe(true);
    });

    it('should ignore blocked beds', () => {
      const record = createRecord({
        R1: createPatient({
          isBlocked: true,
          status: PatientStatus.EMPTY,
          admissionDate: '',
        }),
      });

      const result = validateCriticalFields(record);
      expect(result.isValid).toBe(true);
    });

    it('should validate clinical crib patients', () => {
      const record = createRecord({
        M1: {
          ...createPatient(),
          clinicalCrib: createPatient({
            patientName: 'Baby',
            status: PatientStatus.EMPTY,
            admissionDate: '2025-01-01',
          }),
        },
      });

      const result = validateCriticalFields(record);
      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.isCrib)).toBe(true);
    });

    it('should count total issues', () => {
      const record = createRecord({
        R1: createPatient({ status: PatientStatus.EMPTY }),
        M1: createPatient({ admissionDate: '' }),
      });

      const result = validateCriticalFields(record);
      expect(result.issueCount).toBe(2);
    });
  });
});
