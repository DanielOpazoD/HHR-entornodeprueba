import { describe, it, expect } from 'vitest';
import { calculateStats } from '@/services/calculations/statsCalculator';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import { BEDS, HOSPITAL_CAPACITY } from '@/constants/beds';

describe('statsCalculator', () => {
  type BedValue = PatientData;

  const createEmptyBeds = (): Record<string, PatientData> => ({});

  it('should calculate empty hospital stats', () => {
    const stats = calculateStats(createEmptyBeds());
    expect(stats.occupiedBeds).toBe(0);
    expect(stats.totalHospitalized).toBe(0);
    expect(stats.serviceCapacity).toBe(HOSPITAL_CAPACITY);
    expect(stats.availableCapacity).toBe(HOSPITAL_CAPACITY);
  });

  it('should return zero stats for empty canonical bed map', () => {
    const beds: Record<string, PatientData> = {};
    BEDS.forEach(bed => {
      beds[bed.id] = {
        bedId: bed.id,
        isBlocked: false,
        bedMode: 'Cama',
        hasCompanionCrib: false,
        patientName: '',
        rut: '',
        age: '',
        pathology: '',
        specialty: Specialty.MEDICINA,
        status: PatientStatus.ESTABLE,
        admissionDate: '2025-01-01',
        hasWristband: false,
        devices: [],
        surgicalComplication: false,
        isUPC: false,
      };
    });

    const stats = calculateStats(beds);

    expect(stats.occupiedBeds).toBe(0);
    expect(stats.occupiedCribs).toBe(0);
    expect(stats.totalHospitalized).toBe(0);
    expect(stats.blockedBeds).toBe(0);
    expect(stats.companionCribs).toBe(0);
    expect(stats.clinicalCribsCount).toBe(0);
  });

  it('should count occupied beds and blocked beds', () => {
    const beds: Record<string, PatientData> = {
      R1: {
        patientName: 'John',
        isBlocked: false,
        bedMode: 'Cama',
        status: PatientStatus.ESTABLE,
        specialty: Specialty.MEDICINA,
      } as unknown as BedValue,
      R2: {
        patientName: '',
        isBlocked: true,
        bedMode: 'Cama',
      } as unknown as BedValue,
    };
    const stats = calculateStats(beds);
    expect(stats.occupiedBeds).toBe(1);
    expect(stats.blockedBeds).toBe(1);
    expect(stats.availableCapacity).toBe(HOSPITAL_CAPACITY - 1 - 1);
  });

  it('should handle Cuna mode and nested clinical cribs', () => {
    const beds: Record<string, PatientData> = {
      R1: {
        patientName: 'Mother',
        bedMode: 'Cama',
        clinicalCrib: { patientName: 'Baby' },
        hasCompanionCrib: true,
      } as unknown as BedValue,
      R2: {
        patientName: 'RN Solo',
        bedMode: 'Cuna',
      } as unknown as BedValue,
      R3: {
        patientName: 'Mother 2',
        bedMode: 'Cama',
        hasCompanionCrib: true,
      } as unknown as BedValue,
    };
    const stats = calculateStats(beds);

    // R1: 1 Bed + 1 Nested Crib
    // R2: 1 Bed (Cuna mode)
    // R3: the legacy flag remains a physical-resource fallback until it is migrated.

    expect(stats.occupiedBeds).toBe(3);
    expect(stats.occupiedCribs).toBe(1);
    expect(stats.totalHospitalized).toBe(4);
    expect(stats.clinicalCribsCount).toBe(2); // R1 nested + R2 main
    expect(stats.companionCribs).toBe(0);
    expect(stats.totalCribsUsed).toBe(3); // R1 nested + R2 main + R3 legacy fallback
  });

  it('should count empty beds in Cuna mode as crib usage', () => {
    const beds: Record<string, PatientData> = {
      R1: { patientName: '', bedMode: 'Cuna' } as unknown as BedValue,
    };
    const stats = calculateStats(beds);
    expect(stats.occupiedBeds).toBe(0);
    expect(stats.totalCribsUsed).toBe(1);
  });
});
