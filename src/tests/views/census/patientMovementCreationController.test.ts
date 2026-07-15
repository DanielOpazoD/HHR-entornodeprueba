import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BEDS } from '@/constants/beds';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
import type { PatientData } from '@/types/domain/patient';
import {
  resolveAddDischargeMovement,
  resolveAddTransferMovement,
} from '@/features/census/controllers/patientMovementCreationController';

const expectAvailableCensusBed = (patient: PatientData): void => {
  expect(patient).toEqual(
    expect.objectContaining({
      patientName: '',
      rut: '',
      pathology: '',
      specialty: Specialty.EMPTY,
      status: PatientStatus.EMPTY,
      admissionDate: '',
      admissionTime: '',
      firstSeenDate: undefined,
      devices: [],
      handoffNote: '',
      handoffNoteDayShift: '',
      handoffNoteNightShift: '',
      medicalHandoffNote: '',
      medicalHandoffEntries: [],
      medicalHandoffAudit: undefined,
      clinicalCrib: undefined,
      clinicalEvents: [],
      hasCompanionCrib: false,
    })
  );
};

describe('patientMovementCreationController', () => {
  it('fails discharge creation when source bed is empty', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        time: '',
        dischargeTarget: 'both',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SOURCE_BED_EMPTY');
    }
  });

  it('creates mother+baby discharges and clears bed', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre A',
      rut: '11-1',
      clinicalEpisodeId: 'ep-mother',
      admissionDate: '2024-12-31',
      admissionTime: '23:10',
      firstSeenDate: '2024-12-31',
      devices: ['VVP'],
      handoffNoteDayShift: 'Nota anterior',
      handoffNoteNightShift: 'Nota anterior noche',
      medicalHandoffNote: 'Evolución previa',
      clinicalEvents: [
        {
          id: 'ev-1',
          name: 'Evento previo',
          date: '2024-12-31T12:00:00.000Z',
          createdAt: '2024-12-31T12:00:00.000Z',
        },
      ],
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN A',
        rut: '22-2',
        clinicalEpisodeId: 'ep-baby',
      }),
    });

    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        cribStatus: 'Vivo',
        time: '',
        dischargeTarget: 'both',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
      createId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      provenance: {
        source: 'manual',
        actor: 'enfermera@hospital.cl',
        at: '2025-01-01T12:00:00.000Z',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.discharges).toHaveLength(2);
      expect(result.value.updatedRecord.discharges[0].clinicalEpisodeId).toBe('ep-mother');
      expect(result.value.updatedRecord.discharges[1].clinicalEpisodeId).toBe('ep-baby');
      expect(result.value.updatedRecord.discharges[0].movementProvenance).toEqual({
        source: 'manual',
        lineageId: 'id-1',
        classifiedAt: '2025-01-01T12:00:00.000Z',
        classifiedBy: 'enfermera@hospital.cl',
      });
      expect(result.value.updatedRecord.discharges[1].movementProvenance?.lineageId).toBe('id-2');
      expect(result.value.updatedRecord.discharges[0].originalData?.clinicalEpisodeId).toBe(
        'ep-mother'
      );
      expect(result.value.updatedRecord.beds.R1.patientName).toBe('');
      expect(result.value.updatedRecord.beds.R1.admissionDate).toBe('');
      expect(result.value.updatedRecord.beds.R1.admissionTime).toBe('');
      expect(result.value.updatedRecord.beds.R1.firstSeenDate).toBeUndefined();
      expect(result.value.updatedRecord.beds.R1.devices).toEqual([]);
      expect(result.value.updatedRecord.beds.R1.handoffNote).toBe('');
      expect(result.value.updatedRecord.beds.R1.handoffNoteDayShift).toBe('');
      expect(result.value.updatedRecord.beds.R1.handoffNoteNightShift).toBe('');
      expect(result.value.updatedRecord.beds.R1.medicalHandoffNote).toBe('');
      expect(result.value.updatedRecord.beds.R1.medicalHandoffEntries).toEqual([]);
      expect(result.value.updatedRecord.beds.R1.medicalHandoffAudit).toBeUndefined();
      expect(result.value.updatedRecord.beds.R1.clinicalCrib).toBeUndefined();
      expect(result.value.updatedRecord.beds.R1.clinicalEvents).toEqual([]);
      expect(result.value.updatedRecord.beds.R1.hasCompanionCrib).toBe(false);
      expectAvailableCensusBed(result.value.updatedRecord.beds.R1);
      expect(result.value.auditEntries).toHaveLength(2);
    }
  });

  it('promotes clinical crib when discharge target is mother', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre A',
      rut: '11-1',
      admissionDate: '2024-12-28',
      admissionTime: '08:00',
      firstSeenDate: '2024-12-28',
      pathology: 'Puerperio',
      specialty: 'Ginecobstetricia',
      location: 'Sala 1',
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN A',
        firstName: 'RN',
        lastName: 'A',
        rut: '22-2',
        clinicalEpisodeId: 'ep-baby',
        admissionDate: '2024-12-31',
        admissionTime: '23:10',
        firstSeenDate: '2024-12-31',
        pathology: 'RN sano',
        specialty: 'Pediatría',
        status: PatientStatus.ESTABLE,
        age: '1d',
        devices: ['Incubadora', 'VVP'],
        handoffNote: 'Nota RN',
        handoffNoteDayShift: 'Nota día RN',
        handoffNoteNightShift: 'Nota noche RN',
        medicalHandoffNote: 'Evolución RN',
        clinicalEvents: [
          {
            id: 'ev-rn-1',
            name: 'Control neonatal',
            date: '2024-12-31T23:30:00.000Z',
            createdAt: '2024-12-31T23:30:00.000Z',
          },
        ],
      }),
    });

    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        time: '',
        dischargeTarget: 'mother',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.discharges).toHaveLength(1);
      expect(result.value.updatedRecord.discharges[0]).toMatchObject({
        patientName: 'Madre A',
        rut: '11-1',
        admissionDate: '2024-12-28',
        isNested: false,
      });
      expect(result.value.updatedRecord.beds.R1).toMatchObject({
        patientName: 'RN A',
        firstName: 'RN',
        lastName: 'A',
        rut: '22-2',
        clinicalEpisodeId: 'ep-baby',
        admissionDate: '2024-12-31',
        admissionTime: '23:10',
        firstSeenDate: '2024-12-31',
        pathology: 'RN sano',
        specialty: 'Pediatría',
        status: PatientStatus.ESTABLE,
        age: '1d',
        devices: ['Incubadora', 'VVP'],
        handoffNote: 'Nota RN',
        handoffNoteDayShift: 'Nota día RN',
        handoffNoteNightShift: 'Nota noche RN',
        medicalHandoffNote: 'Evolución RN',
        clinicalEvents: [
          {
            id: 'ev-rn-1',
            name: 'Control neonatal',
            date: '2024-12-31T23:30:00.000Z',
            createdAt: '2024-12-31T23:30:00.000Z',
          },
        ],
        location: 'Sala 1',
        bedMode: 'Cuna',
        hasCompanionCrib: false,
      });
      expect(result.value.updatedRecord.beds.R1.clinicalCrib).toBeUndefined();
    }
  });

  it('creates transfer entries for mother and clinical crib and clears bed', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre A',
      rut: '11-1',
      clinicalEpisodeId: 'ep-mother',
      admissionDate: '2024-12-31',
      admissionTime: '23:10',
      firstSeenDate: '2024-12-31',
      devices: ['CVC'],
      handoffNoteNightShift: 'Nota antigua',
      medicalHandoffNote: 'Evolución previa',
      clinicalEvents: [
        {
          id: 'ev-1',
          name: 'Evento previo',
          date: '2024-12-31T12:00:00.000Z',
          createdAt: '2024-12-31T12:00:00.000Z',
        },
      ],
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN A',
        rut: '22-2',
        clinicalEpisodeId: 'ep-baby',
      }),
    });

    const result = resolveAddTransferMovement({
      record,
      bedId: 'R1',
      payload: {
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital Base',
        receivingCenterOther: '',
        transferEscort: '',
        time: '',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
      createId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
      provenance: {
        source: 'manual',
        actor: 'enfermera@hospital.cl',
        at: '2025-01-01T12:00:00.000Z',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.transfers).toHaveLength(2);
      expect(result.value.updatedRecord.transfers[0].clinicalEpisodeId).toBe('ep-mother');
      expect(result.value.updatedRecord.transfers[1].clinicalEpisodeId).toBe('ep-baby');
      expect(result.value.updatedRecord.transfers[0].movementProvenance).toEqual({
        source: 'manual',
        lineageId: 'id-1',
        classifiedAt: '2025-01-01T12:00:00.000Z',
        classifiedBy: 'enfermera@hospital.cl',
      });
      expect(result.value.updatedRecord.transfers[0].originalData?.clinicalEpisodeId).toBe(
        'ep-mother'
      );
      expect(result.value.updatedRecord.beds.R1.patientName).toBe('');
      expect(result.value.updatedRecord.beds.R1.admissionDate).toBe('');
      expect(result.value.updatedRecord.beds.R1.admissionTime).toBe('');
      expect(result.value.updatedRecord.beds.R1.firstSeenDate).toBeUndefined();
      expect(result.value.updatedRecord.beds.R1.devices).toEqual([]);
      expect(result.value.updatedRecord.beds.R1.handoffNote).toBe('');
      expect(result.value.updatedRecord.beds.R1.handoffNoteDayShift).toBe('');
      expect(result.value.updatedRecord.beds.R1.handoffNoteNightShift).toBe('');
      expect(result.value.updatedRecord.beds.R1.medicalHandoffNote).toBe('');
      expect(result.value.updatedRecord.beds.R1.medicalHandoffEntries).toEqual([]);
      expect(result.value.updatedRecord.beds.R1.medicalHandoffAudit).toBeUndefined();
      expect(result.value.updatedRecord.beds.R1.clinicalCrib).toBeUndefined();
      expect(result.value.updatedRecord.beds.R1.clinicalEvents).toEqual([]);
      expect(result.value.updatedRecord.beds.R1.hasCompanionCrib).toBe(false);
      expectAvailableCensusBed(result.value.updatedRecord.beds.R1);
      expect(result.value.auditEntry.patientName).toBe('Madre A');
    }
  });

  it('respects explicit movementDate when creating a discharge movement', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente A',
      rut: '11-1',
    });

    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        time: '10:00',
        movementDate: '2025-01-02',
        dischargeTarget: 'mother',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.discharges).toHaveLength(1);
      expect(result.value.updatedRecord.discharges[0].movementDate).toBe('2025-01-02');
    }
  });

  it('returns discharge audit entries with enough movement metadata to reconstruct the daily discharge row', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Bernardo Orrego Llanos',
      rut: '17.274.300-5',
      pathology: 'Neumonía adquirida en la comunidad',
      clinicalEpisodeId: 'episode-bernardo',
    });

    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        type: 'Domicilio (Habitual)',
        time: '13:24',
        movementDate: '2025-01-02',
        dischargeTarget: 'mother',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
      createId: () => 'discharge-bernardo',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.auditEntries).toEqual([
        expect.objectContaining({
          movementId: 'discharge-bernardo',
          bedId: 'R1',
          patientName: 'Bernardo Orrego Llanos',
          rut: '17.274.300-5',
          status: 'Vivo',
          diagnosis: 'Neumonía adquirida en la comunidad',
          movementDate: '2025-01-02',
          time: '13:24',
          dischargeType: 'Domicilio (Habitual)',
          clinicalEpisodeId: 'episode-bernardo',
        }),
      ]);
    }
  });

  it('respects explicit movementDate when creating a transfer movement', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente A',
      rut: '11-1',
    });

    const result = resolveAddTransferMovement({
      record,
      bedId: 'R1',
      payload: {
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital Base',
        receivingCenterOther: '',
        transferEscort: '',
        time: '10:00',
        movementDate: '2025-01-02',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.transfers).toHaveLength(1);
      expect(result.value.updatedRecord.transfers[0].movementDate).toBe('2025-01-02');
    }
  });
});
