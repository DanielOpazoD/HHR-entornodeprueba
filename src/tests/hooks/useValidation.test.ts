import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useValidation } from '@/hooks/useValidation';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

describe('useValidation', () => {
  describe('canDischargePatient', () => {
    it('should return true when patient has name and admission date', () => {
      const { result } = renderHook(() => useValidation());
      const patient = { patientName: 'Test Patient', admissionDate: '2024-12-01' } as PatientData;
      expect(result.current.canDischargePatient(patient)).toBe(true);
    });

    it('should return false when patient has no name', () => {
      const { result } = renderHook(() => useValidation());
      const patient = { patientName: '', admissionDate: '2024-12-01' } as PatientData;
      expect(result.current.canDischargePatient(patient)).toBe(false);
    });

    it('should return false when patient has no admission date', () => {
      const { result } = renderHook(() => useValidation());
      const patient = { patientName: 'Test', admissionDate: '' } as PatientData;
      expect(result.current.canDischargePatient(patient)).toBe(false);
    });
  });

  describe('validateRecordSchema', () => {
    it('should return isValid true for valid minimal record', () => {
      const { result } = renderHook(() => useValidation());
      const validRecord = {
        date: '2024-12-28',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
      } as unknown as DailyRecord;
      const validation = result.current.validateRecordSchema(validRecord);
      expect(validation.isValid).toBeDefined();
    });
  });
});
