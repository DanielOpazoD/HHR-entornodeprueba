import { describe, expect, it, vi } from 'vitest';
import {
  DailyRecordSchema,
  hasStructuralRepairs,
  parseDailyRecordWithDefaults,
  parseDailyRecordWithDefaultsReport,
  safeParseDailyRecord,
} from '@/schemas/zodSchemas';

describe('zod daily record schemas', () => {
  describe('DailyRecordSchema staffing compatibility', () => {
    it('promotes legacy nurses and nurseName into canonical day shift staffing', () => {
      const record = DailyRecordSchema.parse({
        date: '2026-03-06',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: '2026-03-06T10:00:00.000Z',
        nurses: ['Legacy A', 'Legacy B'],
        nurseName: 'Legacy Principal',
        nursesDayShift: ['', ''],
        nursesNightShift: ['', ''],
      });

      expect(record.nursesDayShift).toEqual(['Legacy A', 'Legacy B']);
      expect(record.nurses).toEqual(['Legacy A', 'Legacy B']);
    });
  });

  describe('DailyRecordSchema', () => {
    it('should parse valid daily record', () => {
      const record = DailyRecordSchema.parse({
        date: '2026-01-15',
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
      });
      expect(record.date).toBe('2026-01-15');
    });

    it('should apply defaults for missing arrays', () => {
      const record = DailyRecordSchema.parse({ date: '2026-01-15' });
      expect(record.beds).toEqual({});
      expect(record.discharges).toEqual([]);
      expect(record.transfers).toEqual([]);
      expect(record.nurses).toEqual(['', '']);
    });

    it('should parse record with beds', () => {
      const record = DailyRecordSchema.parse({
        date: '2026-01-15',
        beds: {
          uti_01: {
            bedId: 'uti_01',
            patientName: 'Test Patient',
          },
        },
      });
      expect(record.beds['uti_01'].patientName).toBe('Test Patient');
    });

    it('should preserve CMA records with custom free-text specialty', () => {
      const record = DailyRecordSchema.parse({
        date: '2026-01-15',
        beds: {},
        cma: [
          {
            id: 'cma-1',
            bedName: 'R1',
            patientName: 'Paciente CMA',
            rut: '11111111-1',
            age: '45',
            diagnosis: 'Colelitiasis',
            specialty: 'Urología',
            interventionType: 'Cirugía Mayor Ambulatoria',
          },
        ],
      });

      expect(record.cma).toHaveLength(1);
      expect(record.cma[0]?.specialty).toBe('Urología');
    });

    it('should parse handoff checklists', () => {
      const record = DailyRecordSchema.parse({
        date: '2026-01-15',
        handoffDayChecklist: {
          escalaBraden: true,
          escalaRiesgoCaidas: false,
        },
      });
      expect(record.handoffDayChecklist?.escalaBraden).toBe(true);
    });
  });

  describe('safeParseDailyRecord', () => {
    it('should return parsed data for valid input', () => {
      const result = safeParseDailyRecord({
        date: '2026-01-15',
        beds: {},
      });
      expect(result).not.toBeNull();
      expect(result?.date).toBe('2026-01-15');
    });

    it('should normalize legacy null metadata before parsing', () => {
      const result = safeParseDailyRecord({
        date: '2026-03-04',
        beds: {},
        discharges: null,
        nurses: null,
        handoffNovedadesDayShift: null,
      });

      expect(result).not.toBeNull();
      expect(result?.discharges).toEqual([]);
      expect(result?.nurses).toEqual(['', '']);
      expect(result?.handoffNovedadesDayShift).toBeUndefined();
    });

    it('should return null for invalid input', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = safeParseDailyRecord({
        beds: 'invalid',
      });
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should return null for completely invalid data', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = safeParseDailyRecord('not an object');
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('parseDailyRecordWithDefaults', () => {
    it('should parse valid data normally', () => {
      const result = parseDailyRecordWithDefaults({ date: '2026-01-15', beds: {} }, '2026-01-15');
      expect(result.date).toBe('2026-01-15');
    });

    it('should recover from partially invalid data', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = parseDailyRecordWithDefaults({ beds: 'invalid' }, '2026-01-15');
      expect(result.date).toBe('2026-01-15');
      expect(result.beds).toEqual({});
      consoleSpy.mockRestore();
    });

    it('should use docId as date fallback', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = parseDailyRecordWithDefaults({}, '2026-01-20');
      expect(result.date).toBe('2026-01-20');
      consoleSpy.mockRestore();
    });

    it('should preserve valid arrays', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = parseDailyRecordWithDefaults(
        {
          date: '2026-01-15',
          discharges: [{ id: '1', patientName: 'Test' }],
        },
        '2026-01-15'
      );
      expect(result.discharges).toHaveLength(1);
      consoleSpy.mockRestore();
    });

    it('should handle null input', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = parseDailyRecordWithDefaults(null, '2026-01-15');
      expect(result.date).toBe('2026-01-15');
      expect(result.beds).toEqual({});
      consoleSpy.mockRestore();
    });

    it('should salvage beds with legacy null clinical event notes', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = parseDailyRecordWithDefaults(
        {
          date: '2026-03-04',
          beds: {
            R1: {
              bedId: 'R1',
              patientName: 'Paciente Legacy',
              clinicalEvents: [
                {
                  id: 'event-1',
                  name: 'Cultivo',
                  date: '2026-03-03',
                  note: null,
                  createdAt: '2026-03-03T20:33:00.000Z',
                },
              ],
            },
          },
        },
        '2026-03-04'
      );

      expect(result.beds.R1.clinicalEvents).toHaveLength(1);
      expect(result.beds.R1.clinicalEvents?.[0]?.note).toBeUndefined();
      consoleSpy.mockRestore();
    });

    it('should fallback invalid beds to a safe patient shape instead of preserving raw corruption', () => {
      const result = parseDailyRecordWithDefaults(
        {
          date: '2026-03-04',
          beds: {
            R1: {
              patientName: 'Paciente Irregular',
              status: 'ESTADO_INVALIDO',
              specialty: 'ESPECIALIDAD_INVALIDA',
              devices: [null, 'CVC'],
            },
          },
        },
        '2026-03-04'
      );

      expect(result.beds.R1.patientName).toBe('Paciente Irregular');
      expect(result.beds.R1.bedId).toBe('R1');
      expect(result.beds.R1.devices).toEqual([]);
      expect(result.beds.R1.status).toBeDefined();
    });
  });

  describe('parseDailyRecordWithDefaultsReport', () => {
    it('should report null normalization and salvaged beds', () => {
      const result = parseDailyRecordWithDefaultsReport(
        {
          date: '2026-03-04',
          beds: {
            R1: {
              patientName: 'Paciente Irregular',
              status: 'ESTADO_INVALIDO',
              clinicalEvents: [null],
            },
          },
          discharges: [null],
        },
        '2026-03-04'
      );

      expect(result.report.nullNormalization.replacedNullCount).toBeGreaterThan(0);
      expect(result.report.salvagedBeds).toContain('R1');
      expect(result.report.droppedDischargeItems).toBe(0);
      expect(result.report.nullNormalization.droppedArrayEntriesCount).toBeGreaterThan(0);
    });
  });

  describe('DailyRecordSchema legacy null tolerance', () => {
    it('should normalize null arrays and optional metadata fields', () => {
      const record = DailyRecordSchema.parse({
        date: '2026-03-04',
        beds: {},
        discharges: null,
        transfers: null,
        cma: null,
        nurses: null,
        nurseName: null,
        nursesDayShift: null,
        nursesNightShift: null,
        tensDayShift: null,
        tensNightShift: null,
        activeExtraBeds: null,
        handoffDayChecklist: {
          escalaBraden: null,
        },
        handoffNightChecklist: {
          estadistica: null,
          conteoNoControladosProximaFecha: null,
        },
        handoffNovedadesDayShift: null,
        handoffNovedadesNightShift: null,
        medicalHandoffNovedades: null,
        medicalHandoffBySpecialty: null,
        medicalHandoffDoctor: null,
        medicalHandoffSentAt: null,
        medicalHandoffSentAtByScope: null,
        medicalSignatureLinkTokenByScope: {
          all: null,
          upc: null,
          'no-upc': null,
        },
        medicalSignature: null,
        medicalSignatureByScope: {
          all: null,
          upc: {
            doctorName: 'Dr. Test',
            signedAt: '2026-03-04T10:00:00.000Z',
            userAgent: null,
          },
          'no-upc': null,
        },
        cudyrLocked: null,
        cudyrLockedAt: null,
        cudyrLockedBy: null,
        cudyrUpdatedAt: null,
        handoffNightReceives: null,
      });

      expect(record.discharges).toEqual([]);
      expect(record.transfers).toEqual([]);
      expect(record.cma).toEqual([]);
      expect(record.nurses).toEqual(['', '']);
      expect(record.nurseName).toBeUndefined();
      expect(record.nursesDayShift).toEqual(['', '']);
      expect(record.nursesNightShift).toEqual(['', '']);
      expect(record.tensDayShift).toEqual(['', '', '']);
      expect(record.tensNightShift).toEqual(['', '', '']);
      expect(record.activeExtraBeds).toEqual([]);
      expect(record.handoffDayChecklist?.escalaBraden).toBeUndefined();
      expect(record.handoffNightChecklist?.estadistica).toBeUndefined();
      expect(record.handoffNightChecklist?.conteoNoControladosProximaFecha).toBeUndefined();
      expect(record.handoffNovedadesDayShift).toBeUndefined();
      expect(record.handoffNovedadesNightShift).toBeUndefined();
      expect(record.medicalHandoffNovedades).toBeUndefined();
      expect(record.medicalHandoffBySpecialty).toBeUndefined();
      expect(record.medicalHandoffDoctor).toBeUndefined();
      expect(record.medicalHandoffSentAt).toBeUndefined();
      expect(record.medicalHandoffSentAtByScope).toBeUndefined();
      expect(record.medicalSignatureLinkTokenByScope?.all).toBeUndefined();
      expect(record.medicalSignatureLinkTokenByScope?.upc).toBeUndefined();
      expect(record.medicalSignatureLinkTokenByScope?.['no-upc']).toBeUndefined();
      expect(record.medicalSignature).toBeUndefined();
      expect(record.medicalSignatureByScope?.all).toBeUndefined();
      expect(record.medicalSignatureByScope?.upc?.userAgent).toBeUndefined();
      expect(record.medicalSignatureByScope?.['no-upc']).toBeUndefined();
      expect(record.cudyrLocked).toBeUndefined();
      expect(record.cudyrLockedAt).toBeUndefined();
      expect(record.cudyrLockedBy).toBeUndefined();
      expect(record.cudyrUpdatedAt).toBeUndefined();
      expect(record.handoffNightReceives).toEqual([]);
    });
  });

  describe('repair reports', () => {
    it('detects structural repairs in salvaged daily records', () => {
      const parsed = parseDailyRecordWithDefaultsReport(
        {
          date: '2026-03-04',
          beds: {
            R1: {
              patientName: 'Paciente Legacy',
              status: 'ESTADO_INVALIDO',
              clinicalEvents: [null],
            },
          },
        },
        '2026-03-04'
      );

      expect(hasStructuralRepairs(parsed.report)).toBe(true);
    });

    it('does not mark clean records as repaired', () => {
      const parsed = parseDailyRecordWithDefaultsReport(
        {
          date: '2026-03-04',
          beds: {},
          nurses: ['', ''],
        },
        '2026-03-04'
      );

      expect(hasStructuralRepairs(parsed.report)).toBe(false);
    });
  });
});
