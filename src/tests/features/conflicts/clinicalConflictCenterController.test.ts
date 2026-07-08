import { describe, expect, it } from 'vitest';
import {
  buildClinicalConflictCenterModel,
  classifyClinicalConflictPath,
} from '@/application/clinical-conflicts/clinicalConflictCenterController';
import type { ConflictVersionSnapshot } from '@/application/ports/dailyRecordConflictRecoveryPort';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { canManageClinicalConflictCenter } from '@/shared/access/operationalAccessPolicy';

const buildRecord = (overrides: Partial<DailyRecord>): DailyRecord =>
  ({
    date: '2026-07-01',
    beds: {
      H1: {
        bedId: 'H1',
        bedName: 'H1',
        patientName: 'Pierre Jean',
        rut: '25DF52626',
        pathology: 'Neumonia',
        handoffNoteDayShift: 'Control estable',
        medicalHandoffEntries: [{ id: 'mh-1', specialty: 'cirugia', note: 'Control basal' }],
      },
    },
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    handoffNovedadesDayShift: 'Sin novedades',
    medicalHandoffBySpecialty: {
      cirugia: {
        note: 'Pendiente visita',
        createdAt: '2026-07-01T10:00:00.000Z',
        updatedAt: '2026-07-01T10:00:00.000Z',
        version: 1,
        author: { uid: 'doc-1', displayName: 'Dr Uno', email: 'doc@example.com' },
      },
    },
    lastUpdated: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }) as DailyRecord;

const buildSnapshot = (
  id: string,
  origin: ConflictVersionSnapshot['origin'],
  record: DailyRecord
): ConflictVersionSnapshot => ({
  id,
  origin,
  conflictId: 'conflict-1',
  sourceLastUpdated: record.lastUpdated,
  record,
});

const buildManyBeds = (count: number, pathologyPrefix: string): DailyRecord['beds'] =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => {
      const bedId = `H${String(index).padStart(2, '0')}`;
      return [
        bedId,
        {
          bedId,
          bedName: bedId,
          patientName: `Paciente ${index}`,
          rut: `RUT-${index}`,
          pathology: `${pathologyPrefix} ${index}`,
        },
      ];
    })
  ) as DailyRecord['beds'];

describe('clinicalConflictCenterController', () => {
  it('allows only admin to manage clinical conflicts', () => {
    expect(canManageClinicalConflictCenter('admin')).toBe(true);
    expect(canManageClinicalConflictCenter('nurse_hospital')).toBe(false);
    expect(canManageClinicalConflictCenter('doctor_urgency')).toBe(false);
    expect(canManageClinicalConflictCenter('doctor_specialist')).toBe(false);
    expect(canManageClinicalConflictCenter('viewer')).toBe(false);
  });

  it('classifies census, movement, nursing handoff and medical handoff paths with clinical labels', () => {
    expect(classifyClinicalConflictPath('beds.H1.pathology')).toMatchObject({
      module: 'census',
      label: 'Diagnóstico',
    });
    expect(classifyClinicalConflictPath('discharges.0.rut')).toMatchObject({
      module: 'movements',
      label: 'Altas',
    });
    expect(classifyClinicalConflictPath('cma.0.patientName')).toMatchObject({
      module: 'movements',
      label: 'CMA',
    });
    expect(classifyClinicalConflictPath('beds.H1.handoffNoteDayShift')).toMatchObject({
      module: 'nursing_handoff',
      label: 'Nota enfermería turno largo',
    });
    expect(classifyClinicalConflictPath('medicalHandoffBySpecialty.cirugia.note')).toMatchObject({
      module: 'medical_handoff',
      label: 'Entrega médica por especialidad',
    });
    expect(classifyClinicalConflictPath('beds.H1.medicalHandoffEntries.0.note')).toMatchObject({
      module: 'medical_handoff',
      label: 'Entrada médica por paciente',
    });
  });

  it('builds patient-centered reviewable conflict packages from remote and incoming snapshots', () => {
    const remote = buildRecord({});
    const incoming = buildRecord({
      lastUpdated: '2026-07-01T10:05:00.000Z',
      beds: {
        H1: {
          ...(buildRecord({}).beds.H1 as any),
          pathology: 'ICC',
          handoffNoteDayShift: 'Control estable, avisar fiebre',
          medicalHandoffEntries: [
            { id: 'mh-1', specialty: 'cirugia', note: 'Control basal' },
            { id: 'mh-2', specialty: 'medicinaInterna', note: 'Revisar diuresis' },
          ],
        },
      },
      discharges: [
        {
          id: 'd-1',
          bedName: 'H2',
          bedId: 'H2',
          bedType: 'Cama',
          patientName: 'Bernardo Orrego',
          rut: '17.274.300-5',
          diagnosis: 'Alta clinica',
          time: '13:24',
          status: 'Vivo',
        },
      ],
      handoffNovedadesDayShift: 'Revisar carro de paro',
      medicalHandoffBySpecialty: {
        cirugia: {
          note: 'Pendiente visita y laboratorio',
          createdAt: '2026-07-01T10:00:00.000Z',
          updatedAt: '2026-07-01T10:05:00.000Z',
          version: 2,
          author: { uid: 'doc-1', displayName: 'Dr Uno', email: 'doc@example.com' },
        },
      },
    });

    const model = buildClinicalConflictCenterModel({
      date: '2026-07-01',
      snapshots: [
        buildSnapshot('conflict-1__remote_premerge', 'remote_premerge', remote),
        buildSnapshot('conflict-1__incoming_premerge', 'incoming_premerge', incoming),
      ],
    });

    expect(model.hasReviewableConflicts).toBe(true);
    expect(model.conflicts).toHaveLength(1);
    expect(model.conflicts[0]).toMatchObject({
      id: 'conflict-1',
      status: 'reviewable',
      title: 'Conflicto clínico revisable',
    });
    expect(model.conflicts[0].modules.map(module => module.key)).toEqual(
      expect.arrayContaining(['census', 'movements', 'nursing_handoff', 'medical_handoff'])
    );
    expect(model.conflicts[0].patientContexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          patientName: 'Pierre Jean',
          rut: '25DF52626',
          bedName: 'H1',
        }),
        expect.objectContaining({
          patientName: 'Bernardo Orrego',
          rut: '17.274.300-5',
          bedName: 'H2',
        }),
      ])
    );
    expect(model.conflicts[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'census',
          label: 'Diagnóstico',
          before: 'Neumonia',
          after: 'ICC',
        }),
        expect.objectContaining({
          module: 'nursing_handoff',
          label: 'Novedades enfermería turno largo',
        }),
        expect.objectContaining({
          module: 'medical_handoff',
          label: 'Entrega médica por especialidad',
        }),
      ])
    );
    expect(model.conflicts[0].options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'conflict-1__remote_premerge', label: 'Versión en la nube' }),
        expect.objectContaining({ id: 'conflict-1__incoming_premerge', label: 'Versión local' }),
      ])
    );
  });

  it('keeps modules and counts based on the full diff set when display summaries are large', () => {
    const remote = buildRecord({
      beds: buildManyBeds(35, 'Dx remoto'),
      medicalHandoffBySpecialty: {
        cirugia: {
          note: 'Pendiente visita',
          createdAt: '2026-07-01T10:00:00.000Z',
          updatedAt: '2026-07-01T10:00:00.000Z',
          version: 1,
          author: { uid: 'doc-1', displayName: 'Dr Uno', email: 'doc@example.com' },
        },
      },
    });
    const incoming = buildRecord({
      beds: buildManyBeds(35, 'Dx local'),
      medicalHandoffBySpecialty: {
        cirugia: {
          note: 'Pendiente visita médica actualizada',
          createdAt: '2026-07-01T10:00:00.000Z',
          updatedAt: '2026-07-01T10:05:00.000Z',
          version: 2,
          author: { uid: 'doc-1', displayName: 'Dr Uno', email: 'doc@example.com' },
        },
      },
    });

    const model = buildClinicalConflictCenterModel({
      date: '2026-07-01',
      snapshots: [
        buildSnapshot('conflict-1__remote_premerge', 'remote_premerge', remote),
        buildSnapshot('conflict-1__incoming_premerge', 'incoming_premerge', incoming),
      ],
    });

    const [conflict] = model.conflicts;
    expect(conflict.totalChangeCount).toBeGreaterThan(30);
    expect(conflict.changes).toHaveLength(conflict.totalChangeCount);
    expect(conflict.modules.map(module => module.key)).toEqual(
      expect.arrayContaining(['census', 'medical_handoff'])
    );
    expect(conflict.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          module: 'medical_handoff',
          label: 'Entrega médica por especialidad',
        }),
      ])
    );
  });

  it('keeps empty states explainable when observability saw a conflict but snapshots are unavailable', () => {
    const model = buildClinicalConflictCenterModel({
      date: '2026-07-01',
      snapshots: [],
      snapshotRecovery: {
        status: 'saved',
        snapshotIds: ['conflict-1__remote_premerge'],
        origins: ['remote_premerge'],
        ttlMs: 172800000,
        unavailableReason: 'permission_denied',
      },
    });

    expect(model.hasReviewableConflicts).toBe(false);
    expect(model.emptyState).toMatchObject({
      kind: 'permission_denied',
      title: 'Snapshots sin permiso de lectura',
    });
  });
});
