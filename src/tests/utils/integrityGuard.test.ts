import { describe, it, expect } from 'vitest';
import { calculateDensity, checkRegression } from '@/utils/integrityGuard';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('IntegrityGuard', () => {
  type BedValue = DailyRecord['beds'][string];

  const createEmptyRecord = (date: string): DailyRecord => ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: ['', ''],
    activeExtraBeds: [],
    lastUpdated: `${date}T00:00:00.000Z`,
  });

  const createDenseRecord = (date: string): DailyRecord =>
    ({
      date,
      beds: {
        BED_01: {
          bedId: 'BED_01',
          patientName: 'John Doe',
          handoffNote: 'Stable patient',
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
          rut: '123-4',
          age: '40',
          status: 'Estable',
          admissionDate: '2024-01-01',
          admissionTime: '10:00',
          hasWristband: true,
          devices: [],
        } as unknown as BedValue,
        BED_02: {
          bedId: 'BED_02',
          patientName: 'Jane Smith',
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
          rut: '567-8',
          age: '30',
          status: 'Grave',
          admissionDate: '2024-01-01',
          admissionTime: '11:00',
          hasWristband: true,
          devices: [],
        } as unknown as BedValue,
      },
      discharges: [],
      transfers: [],
      cma: [],
      nurses: ['', ''],
      activeExtraBeds: [],
      lastUpdated: `${date}T00:00:00.000Z`,
      novedadesDayShift: 'Some news',
    }) as unknown as DailyRecord;

  describe('calculateDensity', () => {
    it('should return 0 for null/undefined', () => {
      expect(calculateDensity(null)).toBe(0);
    });

    it('should return low score for empty record', () => {
      const empty = createEmptyRecord('2024-01-01');
      expect(calculateDensity(empty)).toBe(0);
    });

    it('should return high score for dense record', () => {
      const dense = createDenseRecord('2024-01-01');
      const density = calculateDensity(dense);
      expect(density).toBeGreaterThan(20);
    });
  });

  describe('checkRegression', () => {
    it('should NOT flag regression when oldRecord is null', () => {
      const newRecord = createDenseRecord('2024-01-01');
      const result = checkRegression(null, newRecord);
      expect(result.isSuspicious).toBe(false);
    });

    it('should flag regression when dense record is overwritten by empty one', () => {
      const oldRecord = createDenseRecord('2024-01-01');
      const newRecord = createEmptyRecord('2024-01-01');

      const result = checkRegression(oldRecord, newRecord);
      expect(result.isSuspicious).toBe(true);
      expect(result.dropPercentage).toBe(100);
    });

    it('should NOT flag regression when drop is minimal', () => {
      const oldRecord = createDenseRecord('2024-01-01');
      const newRecord = { ...oldRecord, beds: { ...oldRecord.beds } };
      // Remove one minor field
      delete (newRecord.beds['BED_01'] as unknown as Record<string, unknown>).handoffNote;

      const result = checkRegression(oldRecord, newRecord);
      expect(result.isSuspicious).toBe(false);
    });

    it('should flag regression when losing a substantial number of patients', () => {
      // Create a very dense record with 10 patients
      const oldRecord = createEmptyRecord('2024-01-01');
      for (let i = 0; i < 10; i++) {
        oldRecord.beds[`BED_${i}`] = { patientName: `Patient ${i}` } as unknown as BedValue;
      }

      // New record only has 2 patients
      const newRecord = createEmptyRecord('2024-01-01');
      newRecord.beds['BED_0'] = { patientName: 'Patient 0' } as unknown as BedValue;
      newRecord.beds['BED_1'] = { patientName: 'Patient 1' } as unknown as BedValue;

      const result = checkRegression(oldRecord, newRecord);
      expect(result.isSuspicious).toBe(true);
      expect(result.dropPercentage).toBe(80);
    });

    it('accepts several discharges when each vacated patient is preserved in its movement', () => {
      const patient = (index: number): BedValue =>
        ({
          bedId: `BED_${index}`,
          patientName: `Patient ${index}`,
          rut: `${index + 1}`,
          handoffNote: 'Evolución vigente',
          handoffNoteDayShift: 'Turno día',
          handoffNoteNightShift: 'Turno noche',
        }) as unknown as BedValue;
      const oldRecord = createEmptyRecord('2024-01-01');
      for (let index = 0; index < 10; index += 1) {
        oldRecord.beds[`BED_${index}`] = patient(index);
      }

      const newRecord = createEmptyRecord('2024-01-01');
      for (let index = 0; index < 6; index += 1) {
        newRecord.beds[`BED_${index}`] = patient(index);
      }
      newRecord.discharges = [6, 7, 8, 9].map(
        index =>
          ({
            id: `discharge-${index}`,
            bedId: `BED_${index}`,
            patientName: `Patient ${index}`,
            originalData: patient(index),
          }) as unknown as DailyRecord['discharges'][number]
      );

      expect(checkRegression(oldRecord, newRecord).isSuspicious).toBe(false);
    });

    it('still flags the same bed loss when movements do not preserve patient snapshots', () => {
      const oldRecord = createEmptyRecord('2024-01-01');
      const newRecord = createEmptyRecord('2024-01-01');
      for (let index = 0; index < 10; index += 1) {
        const bed = {
          patientName: `Patient ${index}`,
          handoffNote: 'Evolución vigente',
          handoffNoteDayShift: 'Turno día',
          handoffNoteNightShift: 'Turno noche',
        } as unknown as BedValue;
        oldRecord.beds[`BED_${index}`] = bed;
        if (index < 6) newRecord.beds[`BED_${index}`] = bed;
      }
      newRecord.discharges = [6, 7, 8, 9].map(
        index =>
          ({
            id: `discharge-${index}`,
            bedId: `BED_${index}`,
            patientName: `Patient ${index}`,
          }) as unknown as DailyRecord['discharges'][number]
      );

      expect(checkRegression(oldRecord, newRecord).isSuspicious).toBe(true);
    });

    it('does not let unrelated new movement snapshots compensate removed patients', () => {
      const oldRecord = createEmptyRecord('2024-01-01');
      const newRecord = createEmptyRecord('2024-01-01');
      for (let index = 0; index < 10; index += 1) {
        const bed = {
          bedId: `BED_${index}`,
          patientName: `Patient ${index}`,
          rut: `${index + 1}`,
          handoffNote: 'Evolución vigente',
          handoffNoteDayShift: 'Turno día',
          handoffNoteNightShift: 'Turno noche',
        } as unknown as BedValue;
        oldRecord.beds[`BED_${index}`] = bed;
        if (index < 6) newRecord.beds[`BED_${index}`] = bed;
      }
      newRecord.discharges = [6, 7, 8, 9].map(
        index =>
          ({
            id: `unrelated-${index}`,
            bedId: `OTHER_${index}`,
            patientName: `Other ${index}`,
            rut: `OTHER-${index}`,
            originalData: {
              bedId: `OTHER_${index}`,
              patientName: `Other ${index}`,
              rut: `OTHER-${index}`,
              handoffNote: 'Registro ajeno',
            },
          }) as unknown as DailyRecord['discharges'][number]
      );

      expect(checkRegression(oldRecord, newRecord).isSuspicious).toBe(true);
    });

    it('does not let accumulated movement history hide a new destructive bed loss', () => {
      const oldRecord = createEmptyRecord('2024-01-01');
      const newRecord = createEmptyRecord('2024-01-01');
      for (let index = 0; index < 10; index += 1) {
        const bed = {
          patientName: `Patient ${index}`,
          handoffNote: 'Evolución vigente',
        } as unknown as BedValue;
        oldRecord.beds[`BED_${index}`] = bed;
        if (index < 2) newRecord.beds[`BED_${index}`] = bed;
      }
      const historical = Array.from({ length: 60 }, (_, index) => ({
        id: `historical-${index}`,
        bedId: `OLD_${index}`,
        patientName: `Historical ${index}`,
        originalData: { patientName: `Historical ${index}` },
      })) as unknown as DailyRecord['discharges'];
      oldRecord.discharges = historical;
      newRecord.discharges = historical;

      expect(checkRegression(oldRecord, newRecord).isSuspicious).toBe(true);
    });

    it('does not credit retained legacy movements without ids as new persistence evidence', () => {
      const oldRecord = createEmptyRecord('2024-01-01');
      const newRecord = createEmptyRecord('2024-01-01');
      for (let index = 0; index < 10; index += 1) {
        const bed = { patientName: `Patient ${index}` } as unknown as BedValue;
        oldRecord.beds[`BED_${index}`] = bed;
        if (index < 2) newRecord.beds[`BED_${index}`] = bed;
      }
      const legacy = Array.from({ length: 60 }, (_, index) => ({
        bedId: `OLD_${index}`,
        patientName: `Legacy ${index}`,
        originalData: { patientName: `Legacy ${index}` },
      })) as unknown as DailyRecord['discharges'];
      oldRecord.discharges = legacy;
      newRecord.discharges = legacy;

      expect(checkRegression(oldRecord, newRecord).isSuspicious).toBe(true);
    });

    it('allows editing mutable fields on a legacy movement without an id', () => {
      const oldRecord = createDenseRecord('2024-01-01');
      const newRecord = createDenseRecord('2024-01-01');
      oldRecord.discharges = [
        {
          bedId: 'BED_01',
          patientName: 'Nombre anterior',
          time: '08:00',
          originalData: { patientName: 'Nombre anterior' },
        },
      ] as unknown as DailyRecord['discharges'];
      newRecord.discharges = [
        {
          bedId: 'BED_02',
          patientName: 'Nombre corregido',
          time: '08:15',
          originalData: { patientName: 'Nombre anterior' },
        },
      ] as unknown as DailyRecord['discharges'];

      expect(checkRegression(oldRecord, newRecord).isSuspicious).toBe(false);
    });

    it('flags deletion of historical movements even when current beds are preserved', () => {
      const oldRecord = createDenseRecord('2024-01-01');
      const newRecord = createDenseRecord('2024-01-01');
      oldRecord.discharges = Array.from({ length: 10 }, (_, index) => ({
        id: `movement-${index}`,
        bedId: `OLD_${index}`,
        patientName: `Historical ${index}`,
      })) as unknown as DailyRecord['discharges'];

      expect(checkRegression(oldRecord, newRecord).isSuspicious).toBe(true);
    });
  });
});
