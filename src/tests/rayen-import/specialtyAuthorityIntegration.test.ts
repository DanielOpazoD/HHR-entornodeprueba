import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  applyCensusImportDiff,
  rayenToPatientData,
  reconcileCensus,
} from '@/features/rayen-import';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { getRayenImportErrorMessage } from '@/features/rayen-import/hooks/rayenImportState';

const require = createRequire(import.meta.url);
const {
  protectSpecialtyDecisions,
} = require('../../../functions/lib/specialtyDecisionContract.js');
const reference = new Date('2026-09-28T16:00:00Z');
const encounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'synthetic-episode',
  run: '111111111',
  firstGivenName: 'Synthetic',
  firstFamilyName: 'Patient',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-09-27T10:00:00-05:00',
  diagnosis: 'Updated diagnosis',
  treatingPhysicianId: 'synthetic-physician',
  treatingPhysicianSpecialty: 'Med Interna',
  ...overrides,
});
const patient = (source: RayenEncounter, overrides: Partial<PatientData> = {}): PatientData => ({
  ...rayenToPatientData(source, reference).patient,
  pathology: 'Previous diagnosis',
  specialty: '',
  ...overrides,
});
const record = (beds: Record<string, PatientData>): DailyRecord => ({
  date: '2026-09-28',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '',
  activeExtraBeds: [],
});
const preview = (current: DailyRecord, encounters: RayenEncounter[]) =>
  reconcileCensus(
    current,
    { capturedAt: reference.toISOString(), facilityId: 1342, encounters },
    { reference }
  );
const apply = (current: DailyRecord, diff: ReturnType<typeof preview>) =>
  applyCensusImportDiff(current, diff, {
    idFactory: () => 'synthetic-id',
    now: reference,
    syncRunId: 'synthetic-run',
  }).record;
const authorize = (remoteRecord: DailyRecord, candidate: DailyRecord) =>
  protectSpecialtyDecisions({
    remoteRecord,
    candidate,
    guardScalarChanges: true,
    actorUid: 'synthetic-user',
    mutationId: 'synthetic-mutation',
    now: reference.toISOString(),
  });
const manual = (episodeId: string): NonNullable<PatientData['specialtyAssignment']> => ({
  schemaVersion: 3,
  episodeId,
  decisionId: 'synthetic-decision',
  recordDate: '2026-09-28',
  source: 'manual',
  actorUid: 'synthetic-user',
  decidedAt: reference.toISOString(),
});

describe('Rayen import against specialty server authority', () => {
  it.each(['pending', 'manually-unassigned', 'assigned'] as const)(
    'syncs other fields with a %s specialty',
    state => {
      const source = encounter();
      const existing = patient(source, {
        specialty: state === 'assigned' ? 'Cirugía' : '',
        ...(state !== 'pending' ? { specialtyAssignment: manual(source.encounterId) } : {}),
      });
      const remote = record({ H5C1: existing });
      const diff = preview(remote, [source]);
      expect(
        diff.updates.flatMap(entry => entry.changes).some(change => change.field === 'specialty')
      ).toBe(false);
      const next = apply(remote, diff);
      expect(() => authorize(remote, next)).not.toThrow();
      expect(next.beds.H5C1.pathology).toBe(source.diagnosis);
      expect(next.beds.H5C1.specialty).toBe(existing.specialty);
      expect(next.beds.H5C1.specialtyAssignment).toEqual(existing.specialtyAssignment);
      expect(remote.beds.H5C1.pathology).toBe('Previous diagnosis');
    }
  );

  it.each(['', 'Cirugía'])(
    'ignores specialty changes in an older preview, including manual blank (%s)',
    specialty => {
      const source = encounter();
      const remote = record({
        H5C1: patient(source, { specialty, specialtyAssignment: manual(source.encounterId) }),
      });
      const diff = preview(remote, [source]);
      diff.updates[0].changes.push({ field: 'specialty', from: '', to: 'Med Interna' });
      const next = apply(remote, diff);
      expect(() => authorize(remote, next)).not.toThrow();
      expect(next.beds.H5C1.specialty).toBe(specialty);
      expect(next.beds.H5C1.pathology).toBe(source.diagnosis);
    }
  );

  it.each(['', 'Otro'])('preserves an existing clinical crib specialty (%s)', specialty => {
    const mother = encounter();
    const child = encounter({
      encounterId: 'synthetic-child',
      run: '222222222',
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const crib = patient(child, { specialty, specialtyAssignment: manual(child.encounterId) });
    const remote = record({
      H5C1: patient(mother, { biologicalSex: 'Femenino', clinicalCrib: crib }),
    });
    const next = apply(remote, preview(remote, [mother, child]));
    expect(() => authorize(remote, next)).not.toThrow();
    expect(next.beds.H5C1.clinicalCrib?.pathology).toBe(child.diagnosis);
    expect(next.beds.H5C1.clinicalCrib?.specialty).toBe(specialty);
    expect(next.beds.H5C1.clinicalCrib?.specialtyAssignment).toEqual(crib.specialtyAssignment);
  });

  it('preserves a crib decision made after preview, while applying its other changes', () => {
    const mother = encounter();
    const child = encounter({
      encounterId: 'synthetic-child',
      run: '222222222',
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const before = record({
      H5C1: patient(mother, { biologicalSex: 'Femenino', clinicalCrib: patient(child) }),
    });
    const diff = preview(before, [mother, child]);
    const fresh = structuredClone(before);
    Object.assign(fresh.beds.H5C1.clinicalCrib!, {
      specialty: '',
      specialtyAssignment: manual(child.encounterId),
    });
    const next = apply(fresh, diff);
    expect(() => authorize(fresh, next)).not.toThrow();
    expect(next.beds.H5C1.clinicalCrib?.specialtyAssignment).toEqual(manual(child.encounterId));
    expect(next.beds.H5C1.clinicalCrib?.pathology).toBe(child.diagnosis);
  });

  it('preserves a legacy crib scalar selected after preview when RUN and admission match', () => {
    const mother = encounter();
    const child = encounter({
      encounterId: 'synthetic-child',
      run: '222222222',
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const before = record({
      H5C1: patient(mother, {
        biologicalSex: 'Femenino',
        clinicalCrib: patient(child, { clinicalEpisodeId: undefined }),
      }),
    });
    const diff = preview(before, [mother, child]);
    const fresh = structuredClone(before);
    fresh.beds.H5C1.clinicalCrib!.specialty = 'Otro';
    const next = apply(fresh, diff);
    expect(next.beds.H5C1.clinicalCrib?.specialty).toBe('Otro');
    expect(() => authorize(fresh, next)).not.toThrow();
    expect(next.beds.H5C1.clinicalCrib?.specialty).toBe('Otro');
    expect(next.beds.H5C1.clinicalCrib?.pathology).toBe(child.diagnosis);
  });

  it('does not carry a previous crib decision into a replacement episode', () => {
    const mother = encounter();
    const child = encounter({
      encounterId: 'synthetic-child',
      run: '222222222',
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const remote = record({
      H5C1: patient(mother, {
        biologicalSex: 'Femenino',
        clinicalCrib: patient(child, {
          specialty: 'Otro',
          specialtyAssignment: manual(child.encounterId),
        }),
      }),
    });
    const diff = preview(remote, [mother, child]);
    const replacement = patient({ ...child, encounterId: 'replacement-episode' });
    const change = diff.updates
      .flatMap(entry => entry.changes)
      .find(entry => entry.field === 'clinicalCrib')!;
    change.to = replacement;
    const next = apply(remote, diff);
    expect(next.beds.H5C1.clinicalCrib?.specialtyAssignment).toBeUndefined();
    expect(() => authorize(remote, next)).not.toThrow();
    expect(next.beds.H5C1.clinicalCrib?.specialty).toBe('');
  });

  it('leaves new admission specialty decisions to the server', () => {
    const remote = record({});
    const next = apply(remote, preview(remote, [encounter()]));
    expect(() => authorize(remote, next)).not.toThrow();
    expect(next.beds.H5C1.specialty).toBe('');
    expect(next.beds.H5C1.pathology).toBe('Updated diagnosis');
  });

  it('explains the specialty conflict without suggesting an arbitrary assignment', () => {
    expect(
      getRayenImportErrorMessage(new Error('Specialty change requires explicit intent.'))
    ).toBe(
      'No se pudo completar la sincronización porque se intentó modificar una especialidad protegida. Actualiza la aplicación y vuelve a capturar el censo. No necesitas asignar una especialidad para sincronizar.'
    );
    expect(getRayenImportErrorMessage(new Error('Other failure'))).toBe('Other failure');
  });
});
