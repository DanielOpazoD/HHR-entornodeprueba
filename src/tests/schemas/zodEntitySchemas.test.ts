import { describe, expect, it } from 'vitest';
import {
  BedTypeSchema,
  CMADataSchema,
  CudyrScoreSchema,
  DeviceDetailsSchema,
  DeviceInfoSchema,
  DischargeDataSchema,
  IeehDataSchema,
  PatientDataSchema,
  TransferDataSchema,
} from '@/schemas/zodSchemas';

describe('zod entity schemas', () => {
  describe('BedTypeSchema', () => {
    it('should reject invalid bed types', () => {
      expect(() => BedTypeSchema.parse('INVALID')).toThrow();
    });

    it('should tolerate every supported bed type used in clinical flows', () => {
      const parsed = ['UTI', 'UCI', 'MEDIA'].map(value => BedTypeSchema.parse(value));
      expect(parsed).toEqual(['UTI', 'UCI', 'MEDIA']);
    });
  });

  describe('CudyrScoreSchema', () => {
    it('should parse valid CUDYR scores', () => {
      const score = CudyrScoreSchema.parse({
        changeClothes: 2,
        mobilization: 3,
        feeding: 1,
        elimination: 0,
        psychosocial: 0,
        surveillance: 0,
        vitalSigns: 0,
        fluidBalance: 0,
        oxygenTherapy: 0,
        airway: 0,
        proInterventions: 0,
        skinCare: 0,
        pharmacology: 0,
        invasiveElements: 0,
      });
      expect(score.changeClothes).toBe(2);
      expect(score.mobilization).toBe(3);
      expect(score.feeding).toBe(1);
    });

    it('should handle missing fields gracefully (resilience)', () => {
      const score = CudyrScoreSchema.parse({});
      expect(score.changeClothes).toBe(0);
      expect(score.mobilization).toBe(0);
    });

    it('should handle partial scores gracefully', () => {
      const score = CudyrScoreSchema.parse({ feeding: 2 });
      expect(score.feeding).toBe(2);
      expect(score.changeClothes).toBe(0);
    });
  });

  describe('DeviceInfoSchema', () => {
    it('should parse valid device info', () => {
      const info = DeviceInfoSchema.parse({
        installationDate: '2026-01-15',
        note: 'CVC inserted',
      });
      expect(info.installationDate).toBe('2026-01-15');
      expect(info.note).toBe('CVC inserted');
    });

    it('should accept empty object', () => {
      const info = DeviceInfoSchema.parse({});
      expect(info).toEqual({});
    });
  });

  describe('DeviceDetailsSchema', () => {
    it('should parse valid device details', () => {
      const details = DeviceDetailsSchema.parse({
        CUP: { installationDate: '2026-01-10' },
        CVC: { note: 'Right subclavian' },
      });
      expect(details.CUP?.installationDate).toBe('2026-01-10');
      expect(details.CVC?.note).toBe('Right subclavian');
    });

    it('should accept empty object', () => {
      const details = DeviceDetailsSchema.parse({});
      expect(details).toEqual({});
    });
  });

  describe('PatientDataSchema', () => {
    it('should parse valid patient data', () => {
      const patient = PatientDataSchema.parse({
        bedId: 'UTI-01',
        clinicalEpisodeId: 'episode-persisted-1',
        patientName: 'Juan Pérez',
        rut: '12.345.678-9',
        pathology: 'Neumonía',
        specialty: 'Med Interna',
        status: 'Estable',
        admissionDate: '2026-01-15',
        admissionTime: '10:00',
        isIsolated: true,
        isolationType: 'Contacto',
        isolationMicroorganism: 'Virus Influenza B',
      });
      expect(patient.patientName).toBe('Juan Pérez');
      expect(patient.specialty).toBe('Med Interna');
      expect(patient.clinicalEpisodeId).toBe('episode-persisted-1');
      expect(patient.isolationType).toBe('Contacto');
      expect(patient.isolationMicroorganism).toBe('Virus Influenza B');
    });

    it('should preserve a custom free-text specialty', () => {
      const patient = PatientDataSchema.parse({
        bedId: 'R1',
        patientName: 'Paciente ORL',
        pathology: 'Otitis media',
        specialty: 'ORL',
      });

      expect(patient.specialty).toBe('ORL');
    });

    it('should derive split name fields from legacy patientName', () => {
      const patient = PatientDataSchema.parse({
        patientName: 'Juan Carlos Pérez Soto',
      });

      expect(patient.firstName).toBe('Juan Carlos');
      expect(patient.lastName).toBe('Pérez');
      expect(patient.secondLastName).toBe('Soto');
    });

    it('should preserve explicit split fields when provided', () => {
      const patient = PatientDataSchema.parse({
        patientName: 'Nombre Antiguo',
        firstName: 'Ana',
        lastName: 'Roa',
        secondLastName: 'Tuki',
      });

      expect(patient.firstName).toBe('Ana');
      expect(patient.lastName).toBe('Roa');
      expect(patient.secondLastName).toBe('Tuki');
    });

    it('should apply defaults for missing fields', () => {
      const patient = PatientDataSchema.parse({});
      expect(patient.bedId).toBe('');
      expect(patient.isBlocked).toBe(false);
      expect(patient.patientName).toBe('');
      expect(patient.devices).toEqual([]);
    });

    it('should parse patient with clinicalCrib', () => {
      const patient = PatientDataSchema.parse({
        bedId: 'M-01',
        patientName: 'Madre',
        clinicalCrib: {
          bedId: 'M-01-CRIB',
          patientName: 'Bebé',
        },
      });
      expect(patient.clinicalCrib?.patientName).toBe('Bebé');
    });

    it('should infer provisional identity for crib data without official identity', () => {
      const patient = PatientDataSchema.parse({
        bedMode: 'Cuna',
        patientName: 'RN de Madre',
        rut: '',
      });
      expect(patient.identityStatus).toBe('provisional');
    });

    it('should default to official identity for standard patients', () => {
      const patient = PatientDataSchema.parse({
        patientName: 'Juan Perez',
        rut: '12.345.678-9',
      });
      expect(patient.identityStatus).toBe('official');
    });

    it('should allow additional fields (passthrough)', () => {
      const patient = PatientDataSchema.parse({
        customField: 'custom value',
      });
      expect((patient as unknown as { customField?: string }).customField).toBe('custom value');
    });

    it('should coerce legacy null clinical event notes to undefined', () => {
      const patient = PatientDataSchema.parse({
        bedId: 'R1',
        patientName: 'Juan Perez',
        clinicalEvents: [
          {
            id: 'event-1',
            name: 'Cirugia',
            date: '2026-03-03',
            note: null,
            createdAt: '2026-03-03T20:30:00.000Z',
          },
        ],
      });

      expect(patient.clinicalEvents).toHaveLength(1);
      expect(patient.clinicalEvents?.[0]?.note).toBeUndefined();
    });

    it('should normalize empty-string legacy enums to undefined', () => {
      const patient = PatientDataSchema.parse({
        patientName: 'Paciente Legacy',
        documentType: '',
        biologicalSex: '',
        insurance: '',
        admissionOrigin: '',
        origin: '',
      });

      expect(patient.documentType).toBeUndefined();
      expect(patient.biologicalSex).toBeUndefined();
      expect(patient.insurance).toBeUndefined();
      expect(patient.admissionOrigin).toBeUndefined();
      expect(patient.origin).toBeUndefined();
    });

    it('should normalize legacy null arrays and nested optional objects', () => {
      const patient = PatientDataSchema.parse({
        bedId: 'R1',
        patientName: 'Paciente Legacy',
        devices: null,
        clinicalEvents: null,
        medicalHandoffEntries: null,
        deviceDetails: {
          CUP: null,
          CVC: {
            installationDate: null,
            removalDate: null,
            note: null,
          },
        },
        medicalHandoffAudit: {
          lastSpecialistUpdateAt: null,
          lastSpecialistUpdateBy: null,
          currentStatusDate: null,
          currentStatusAt: null,
          currentStatusBy: null,
        },
      });

      expect(patient.devices).toEqual([]);
      expect(patient.clinicalEvents).toEqual([]);
      expect(patient.medicalHandoffEntries).toBeUndefined();
      expect(patient.deviceDetails?.CUP).toBeUndefined();
      expect(patient.deviceDetails?.CVC?.installationDate).toBeUndefined();
      expect(patient.deviceDetails?.CVC?.removalDate).toBeUndefined();
      expect(patient.deviceDetails?.CVC?.note).toBeUndefined();
      expect(patient.medicalHandoffAudit?.lastSpecialistUpdateAt).toBeUndefined();
      expect(patient.medicalHandoffAudit?.lastSpecialistUpdateBy).toBeUndefined();
      expect(patient.medicalHandoffAudit?.currentStatusDate).toBeUndefined();
      expect(patient.medicalHandoffAudit?.currentStatusAt).toBeUndefined();
      expect(patient.medicalHandoffAudit?.currentStatusBy).toBeUndefined();
    });
  });

  describe('IeehDataSchema', () => {
    it('should parse an empty object due to nullableOptional', () => {
      const parsed = IeehDataSchema.parse({});
      expect(parsed).toEqual({});
    });

    it('should parse valid strings normally', () => {
      const parsed = IeehDataSchema.parse({
        diagnosticoPrincipal: 'Neumonía',
        procedimiento: 'Cirugía menor',
      });
      expect(parsed.diagnosticoPrincipal).toBe('Neumonía');
      expect(parsed.procedimiento).toBe('Cirugía menor');
    });

    it('should drop null values and proceed without throwing', () => {
      const parsed = IeehDataSchema.parse({
        diagnosticoPrincipal: 'Neumonía',
        procedimiento: null,
        intervencionQuirurgica: null,
      });
      expect(parsed.diagnosticoPrincipal).toBe('Neumonía');
      expect(parsed.procedimiento).toBeUndefined();
      expect(parsed.intervencionQuirurgica).toBeUndefined();
    });
  });

  describe('DischargeDataSchema', () => {
    it('should parse valid discharge data', () => {
      const discharge = DischargeDataSchema.parse({
        id: 'discharge-1',
        bedName: 'UTI-01',
        bedId: 'uti_01',
        patientName: 'Juan Pérez',
        status: 'Vivo',
        dischargeType: 'Domicilio (Habitual)',
      });
      expect(discharge.id).toBe('discharge-1');
      expect(discharge.status).toBe('Vivo');
    });

    it('should apply defaults for missing fields', () => {
      const discharge = DischargeDataSchema.parse({
        id: 'discharge-1',
      });
      expect(discharge.bedName).toBe('');
      expect(discharge.patientName).toBe('');
    });

    it('should accept both discharge statuses', () => {
      expect(DischargeDataSchema.parse({ id: '1', status: 'Vivo' }).status).toBe('Vivo');
      expect(DischargeDataSchema.parse({ id: '2', status: 'Fallecido' }).status).toBe('Fallecido');
    });

    it('should preserve movement tombstone metadata', () => {
      const discharge = DischargeDataSchema.parse({
        id: 'discharge-1',
        clinicalEpisodeId: 'episode-discharge-1',
        deletedAt: '2026-05-12T10:00:00.000Z',
        deletedBy: 'tester',
        deletedReason: 'manual_delete',
      });

      expect(discharge.clinicalEpisodeId).toBe('episode-discharge-1');
      expect(discharge.deletedAt).toBe('2026-05-12T10:00:00.000Z');
      expect(discharge.deletedBy).toBe('tester');
      expect(discharge.deletedReason).toBe('manual_delete');
    });
  });

  describe('TransferDataSchema', () => {
    it('should parse valid transfer data', () => {
      const transfer = TransferDataSchema.parse({
        id: 'transfer-1',
        bedName: 'M-05',
        patientName: 'María López',
        receivingCenter: 'Hospital Regional',
        evacuationMethod: 'Ambulancia',
      });
      expect(transfer.receivingCenter).toBe('Hospital Regional');
    });

    it('should apply defaults', () => {
      const transfer = TransferDataSchema.parse({ id: 'transfer-1' });
      expect(transfer.evacuationMethod).toBe('');
      expect(transfer.receivingCenter).toBe('');
    });
  });

  describe('CMADataSchema', () => {
    it('should parse valid CMA data', () => {
      const cma = CMADataSchema.parse({
        id: 'cma-1',
        patientName: 'Pedro García',
        diagnosis: 'Hernia inguinal',
        interventionType: 'Cirugía Mayor Ambulatoria',
      });
      expect(cma.interventionType).toBe('Cirugía Mayor Ambulatoria');
    });

    it('should apply defaults', () => {
      const cma = CMADataSchema.parse({ id: 'cma-1' });
      expect(cma.patientName).toBe('');
      expect(cma.diagnosis).toBe('');
    });

    it('should preserve custom free-text specialties', () => {
      const cma = CMADataSchema.parse({
        id: 'cma-1',
        patientName: 'Paciente CMA',
        specialty: 'Urología',
      });

      expect(cma.specialty).toBe('Urología');
    });
  });
});
