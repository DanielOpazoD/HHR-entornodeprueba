import { describe, expect, it } from 'vitest';
import {
  analyzeDailyRecordRestoreImpact,
  type DailyRecordRestoreImpactKind,
} from '@/services/repositories/dailyRecordRestoreImpactAnalyzer';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const buildPatient = (overrides: Partial<PatientData>): PatientData =>
  ({
    bedId: 'H1',
    bedName: 'H1',
    patientName: 'Paciente Base',
    rut: '11.111.111-1',
    pathology: 'Diagnostico base',
    specialty: 'Medicina Interna',
    status: 'Estable',
    age: '65',
    admissionDate: '2026-07-01',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    handoffNoteDayShift: '',
    handoffNoteNightShift: '',
    medicalHandoffEntries: [],
    ...overrides,
  }) as PatientData;

const buildRecord = (overrides: Partial<DailyRecord> = {}): DailyRecord =>
  ({
    date: '2026-07-01',
    beds: {
      H1: buildPatient({}),
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    medicalHandoffBySpecialty: {},
    lastUpdated: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }) as DailyRecord;

const expectImpactKinds = (
  result: ReturnType<typeof analyzeDailyRecordRestoreImpact>,
  kinds: DailyRecordRestoreImpactKind[]
) => {
  expect(result.impacts.map(impact => impact.kind)).toEqual(expect.arrayContaining(kinds));
};

describe('dailyRecordRestoreImpactAnalyzer', () => {
  it('blocks restoring a snapshot that would remove current discharges, transfers or CMA rows', () => {
    const current = buildRecord({
      discharges: [
        {
          id: 'd-1',
          bedId: 'H2',
          bedName: 'H2',
          bedType: 'Cama',
          patientName: 'Alta Posterior',
          rut: '22.222.222-2',
          diagnosis: 'Alta clinica',
          time: '13:00',
          status: 'Vivo',
        },
      ],
      transfers: [
        {
          id: 't-1',
          bedId: 'H3',
          bedName: 'H3',
          bedType: 'Cama',
          patientName: 'Traslado Posterior',
          rut: '33.333.333-3',
          diagnosis: 'Traslado',
          time: '14:00',
          evacuationMethod: 'Aereo',
          receivingCenter: 'Hospital receptor',
        },
      ],
      cma: [
        {
          id: 'cma-1',
          bedName: 'CMA',
          patientName: 'CMA Posterior',
          rut: '44.444.444-4',
          age: '41',
          diagnosis: 'CMA',
          specialty: 'Cirugia',
          interventionType: 'Cirugía Mayor Ambulatoria',
        },
      ],
      lastUpdated: '2026-07-01T18:00:00.000Z',
    });
    const selectedSnapshot = buildRecord({ lastUpdated: '2026-07-01T10:00:00.000Z' });

    const result = analyzeDailyRecordRestoreImpact({
      current,
      selectedSnapshot,
      date: '2026-07-01',
    });

    expect(result.status).toBe('blocked');
    expect(result.risk).toBe('high');
    expect(result.blockingImpactCount).toBe(3);
    expectImpactKinds(result, ['movement_loss']);
    expect(result.impactedModules).toEqual(expect.arrayContaining(['movements']));
  });

  it('blocks restoring a stale snapshot that would roll back a current internal bed move', () => {
    const current = buildRecord({
      beds: {
        H1: buildPatient({ patientName: '', rut: '', bedId: 'H1', bedName: 'H1' }),
        H2: buildPatient({
          bedId: 'H2',
          bedName: 'H2',
          patientName: 'Paciente Movido',
          rut: '55.555.555-5',
          clinicalEpisodeId: 'episode-current',
        }),
      },
      lastUpdated: '2026-07-01T18:00:00.000Z',
    });
    const selectedSnapshot = buildRecord({
      beds: {
        H1: buildPatient({
          bedId: 'H1',
          bedName: 'H1',
          patientName: 'Paciente Movido',
          rut: '55.555.555-5',
          clinicalEpisodeId: 'episode-current',
        }),
        H2: buildPatient({ patientName: '', rut: '', bedId: 'H2', bedName: 'H2' }),
      },
      lastUpdated: '2026-07-01T10:00:00.000Z',
    });

    const result = analyzeDailyRecordRestoreImpact({
      current,
      selectedSnapshot,
      date: '2026-07-01',
    });

    expect(result.status).toBe('blocked');
    expect(result.risk).toBe('high');
    expectImpactKinds(result, ['active_bed_rollback']);
    expect(result.impactedModules).toEqual(expect.arrayContaining(['census']));
  });

  it('blocks restoring a snapshot that would revive a tombstoned movement', () => {
    const current = buildRecord({
      discharges: [
        {
          id: 'd-deleted',
          bedId: 'H2',
          bedName: 'H2',
          bedType: 'Cama',
          patientName: 'Alta Eliminada',
          rut: '77.777.777-7',
          diagnosis: 'Alta anulada',
          time: '12:00',
          status: 'Vivo',
          deletedAt: '2026-07-01T18:00:00.000Z',
        },
      ],
      lastUpdated: '2026-07-01T18:00:00.000Z',
    });
    const selectedSnapshot = buildRecord({
      discharges: [
        {
          id: 'd-deleted',
          bedId: 'H2',
          bedName: 'H2',
          bedType: 'Cama',
          patientName: 'Alta Eliminada',
          rut: '77.777.777-7',
          diagnosis: 'Alta anulada',
          time: '12:00',
          status: 'Vivo',
        },
      ],
      lastUpdated: '2026-07-01T10:00:00.000Z',
    });

    const result = analyzeDailyRecordRestoreImpact({
      current,
      selectedSnapshot,
      date: '2026-07-01',
    });

    expect(result.status).toBe('blocked');
    expect(result.risk).toBe('high');
    expect(result.blockingImpactCount).toBe(1);
    expectImpactKinds(result, ['movement_tombstone_revived']);
    expect(result.impactedModules).toEqual(expect.arrayContaining(['movements']));
  });

  it('blocks restoring a snapshot that would create duplicate active patients', () => {
    const current = buildRecord({
      beds: {
        H1: buildPatient({ patientName: '', rut: '', bedId: 'H1', bedName: 'H1' }),
        H2: buildPatient({ patientName: '', rut: '', bedId: 'H2', bedName: 'H2' }),
      },
      lastUpdated: '2026-07-01T18:00:00.000Z',
    });
    const duplicatePatient = buildPatient({
      patientName: 'Paciente Duplicado',
      rut: '88.888.888-8',
      clinicalEpisodeId: 'episode-duplicate',
    });
    const selectedSnapshot = buildRecord({
      beds: {
        H1: buildPatient({ ...duplicatePatient, bedId: 'H1', bedName: 'H1' }),
        H2: buildPatient({ ...duplicatePatient, bedId: 'H2', bedName: 'H2' }),
      },
      lastUpdated: '2026-07-01T10:00:00.000Z',
    });

    const result = analyzeDailyRecordRestoreImpact({
      current,
      selectedSnapshot,
      date: '2026-07-01',
    });

    expect(result.status).toBe('blocked');
    expect(result.risk).toBe('high');
    expect(result.blockingImpactCount).toBe(1);
    expectImpactKinds(result, ['duplicate_active_patient']);
    expect(result.impactedModules).toEqual(expect.arrayContaining(['census']));
  });

  it('requires review when restore would hide newer nursing and medical handoff content', () => {
    const current = buildRecord({
      beds: {
        H1: buildPatient({
          handoffNoteDayShift: 'Control de enfermeria posterior',
          medicalHandoffEntries: [
            { id: 'mh-2', specialty: 'cirugia', note: 'Nota medica posterior' },
          ],
        }),
      },
      handoffNovedadesDayShift: 'Novedad posterior de enfermeria',
      medicalHandoffBySpecialty: {
        cirugia: {
          note: 'Plan medico posterior',
          createdAt: '2026-07-01T17:00:00.000Z',
          updatedAt: '2026-07-01T17:00:00.000Z',
          version: 1,
          author: { uid: 'doc-1', displayName: 'Dr Uno', email: 'doc@example.com' },
        },
      },
      lastUpdated: '2026-07-01T18:00:00.000Z',
    });
    const selectedSnapshot = buildRecord({
      beds: {
        H1: buildPatient({
          handoffNoteDayShift: '',
          medicalHandoffEntries: [],
        }),
      },
      handoffNovedadesDayShift: '',
      medicalHandoffBySpecialty: {},
      lastUpdated: '2026-07-01T10:00:00.000Z',
    });

    const result = analyzeDailyRecordRestoreImpact({
      current,
      selectedSnapshot,
      date: '2026-07-01',
    });

    expect(result.status).toBe('review_required');
    expect(result.risk).toBe('medium');
    expect(result.blockingImpactCount).toBe(0);
    expectImpactKinds(result, ['nursing_handoff_loss', 'medical_handoff_loss']);
    expect(result.impactedModules).toEqual(
      expect.arrayContaining(['nursing_handoff', 'medical_handoff'])
    );
  });

  it('keeps safe restores low risk when the selected snapshot still contains current clinical facts', () => {
    const current = buildRecord({
      discharges: [
        {
          id: 'd-1',
          bedId: 'H2',
          bedName: 'H2',
          bedType: 'Cama',
          patientName: 'Alta Conservada',
          rut: '66.666.666-6',
          diagnosis: 'Alta',
          time: '13:00',
          status: 'Vivo',
        },
      ],
      beds: {
        H1: buildPatient({
          handoffNoteDayShift: 'Nota conservada',
          medicalHandoffEntries: [
            { id: 'mh-1', specialty: 'medicinaInterna', note: 'Nota medica conservada' },
          ],
        }),
      },
      lastUpdated: '2026-07-01T18:00:00.000Z',
    });
    const selectedSnapshot = buildRecord({
      discharges: current.discharges,
      beds: current.beds,
      lastUpdated: '2026-07-01T10:00:00.000Z',
    });

    const result = analyzeDailyRecordRestoreImpact({
      current,
      selectedSnapshot,
      date: '2026-07-01',
    });

    expect(result).toMatchObject({
      status: 'safe',
      risk: 'low',
      blockingImpactCount: 0,
      impactedModules: [],
      impacts: [],
    });
  });
});
