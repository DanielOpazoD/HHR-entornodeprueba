import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { planRayenCensusImport } from '@/features/rayen-import/importRayenCensusUseCase';
import { rayenToPatientData } from '@/features/rayen-import/mapping/rayenToPatientData';
import { buildRayenStructuralPersistenceBase } from '@/features/rayen-import/domain/rayenStructuralPersistenceBase';
import {
  applyCensusImportDiff,
  buildDischarge,
} from '@/features/rayen-import/domain/applyCensusImportDiff';
import { ensureDailyRecordClinicalEpisodeIds } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { findPatientErasures } from '@/services/repositories/dailyRecordErasureGuard';

const require = createRequire(import.meta.url);
const serverGuard: typeof findPatientErasures =
  require('../../../functions/lib/dailyRecordErasureGuard.js').findPatientErasures;
const downgradeGuard: (remote: DailyRecord, local: DailyRecord) => unknown[] =
  require('../../../functions/lib/dailyRecordErasureGuard.js').findPersistedEpisodeDowngrades;
const reference = new Date('2026-07-08T20:00:00Z');
const context = {
  idFactory: () => 'synthetic-movement',
  now: reference,
  actor: 'Test sintético',
  syncRunId: 'synthetic-run',
};
const encounter = (extra: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: 'EloisaEncounter',
  run: '111111111',
  firstGivenName: 'Persona',
  firstFamilyName: 'Sintetica',
  birthDate: '1980-01-01',
  administrativeSex: 'Mujer',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: 'H5',
  bed: 'C1',
  admissionDatetime: '2026-07-08T10:00:00-06:00',
  diagnosis: 'Control sintético',
  ...extra,
});
const record = (beds: DailyRecord['beds']): DailyRecord => ({
  date: '2026-07-08',
  lastUpdated: '2026-07-08T19:00:00Z',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
});
const applySnapshot = (current: DailyRecord, encounters: RayenEncounter[]) => {
  const { diff } = planRayenCensusImport({
    current,
    snapshot: { capturedAt: reference.toISOString(), facilityId: 1342, encounters },
    reference,
  });
  const base = buildRayenStructuralPersistenceBase(current, current, diff, {
    localWriteState: 'none',
  });
  const applied = applyCensusImportDiff(base, diff, context);
  return { diff, base, applied, candidate: ensureDailyRecordClinicalEpisodeIds(applied.record) };
};

describe('current Rayen episode reference compatibility, pure client composition', () => {
  it('conflicts instead of overwriting a principal manual episode at the same admission', () => {
    const incoming = encounter();
    const mapped = rayenToPatientData(incoming, reference).patient;
    const current = record({ H5C1: { ...mapped, clinicalEpisodeId: 'ep_manual' } });
    const { diff, base, applied, candidate } = applySnapshot(current, [incoming]);

    expect(mapped.clinicalEpisodeId).toBe('EloisaEncounter');
    expect(base.beds.H5C1.clinicalEpisodeId).toBe('ep_manual');
    expect(diff.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'occupied-local-bed', bedId: 'H5C1' }),
      ])
    );
    expect(diff.updates).toHaveLength(0);
    expect(diff.admissions).toHaveLength(0);
    expect(applied.applied).toEqual({ admissions: 0, moves: 0, updates: 0, discharges: 0 });
    expect(candidate.beds.H5C1.clinicalEpisodeId).toBe('ep_manual');
    expect(serverGuard(current, candidate)).toEqual([]);
    expect(downgradeGuard(current, candidate)).toEqual([]);
  });

  it('relocates the known episode while retaining its reference and local note', () => {
    const original = rayenToPatientData(encounter(), reference).patient;
    const current = record({ H5C1: { ...original, medicalHandoffNote: 'Nota sintética' } });
    const incoming = encounter({ room: 'H1', bed: 'C2' });
    const { diff, applied, candidate } = applySnapshot(current, [incoming]);

    expect(rayenToPatientData(incoming, reference).patient.clinicalEpisodeId).toBe(
      'EloisaEncounter'
    );
    expect(diff.conflicts).toHaveLength(0);
    expect(applied.applied.moves).toBe(1);
    expect(candidate.beds.H5C1).toBeUndefined();
    expect(candidate.beds.H1C2).toMatchObject({
      clinicalEpisodeId: 'EloisaEncounter',
      medicalHandoffNote: 'Nota sintética',
    });
    expect(serverGuard(current, candidate)).toEqual([]);
    expect(downgradeGuard(current, candidate)).toEqual([]);
  });

  it('admits a later hospitalization after a recorded closure of the manual episode', () => {
    const previous = {
      ...rayenToPatientData(encounter(), reference).patient,
      clinicalEpisodeId: 'ep_manual',
    };
    const current = record({});
    current.discharges = [
      buildDischarge(
        previous,
        {
          bedId: 'H5C1',
          rut: previous.rut,
          patientName: previous.patientName,
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          correctedTime: '11:00',
        },
        current,
        context
      ),
    ];
    const incoming = encounter({
      encounterId: 'EloisaReadmission',
      admissionDatetime: '2026-07-08T12:00:00-06:00',
    });
    const { diff, applied, candidate } = applySnapshot(current, [incoming]);

    expect(rayenToPatientData(incoming, reference).patient.clinicalEpisodeId).toBe(
      'EloisaReadmission'
    );
    expect(diff.conflicts).toHaveLength(0);
    expect(applied.applied.admissions).toBe(1);
    expect(candidate.beds.H5C1).toMatchObject({
      clinicalEpisodeId: 'EloisaReadmission',
      admissionTime: '12:00',
    });
    expect(candidate.discharges[0]).toMatchObject({
      clinicalEpisodeId: 'ep_manual',
      originalData: { clinicalEpisodeId: 'ep_manual' },
    });
    expect(serverGuard(current, candidate)).toEqual([]);
    expect(downgradeGuard(current, candidate)).toEqual([]);
  });

  it('currently replaces an attached newborn manual ID by RUN without a closing movement', () => {
    const mother = encounter({ encounterId: 'EloisaMother' });
    const child = encounter({
      encounterId: 'EloisaNewborn',
      run: '222222222',
      firstGivenName: 'RN de Persona',
      birthDate: '2026-07-08',
      room: 'Cunas',
      bed: 'CH5C1',
      clinicalCribParentBedId: 'H5C1',
    });
    const mappedChild = rayenToPatientData(child, reference).patient;
    const manualChild = {
      ...mappedChild,
      clinicalEpisodeId: 'ep_manual_rn',
      medicalHandoffNote: 'Nota RN sintética',
    };
    const current = record({
      H5C1: { ...rayenToPatientData(mother, reference).patient, clinicalCrib: manualChild },
    });
    const { diff, base, applied, candidate } = applySnapshot(current, [mother, child]);

    expect(mappedChild.clinicalEpisodeId).toBe('EloisaNewborn');
    expect(base.beds.H5C1.clinicalCrib?.clinicalEpisodeId).toBe('ep_manual_rn');
    expect(diff.conflicts).toHaveLength(0);
    expect(diff.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bedId: 'H5C1',
          changes: expect.arrayContaining([
            expect.objectContaining({
              field: 'clinicalCrib',
              from: expect.objectContaining({ clinicalEpisodeId: 'ep_manual_rn' }),
              to: expect.objectContaining({ clinicalEpisodeId: 'EloisaNewborn' }),
            }),
          ]),
        }),
      ])
    );
    expect(applied.applied.updates).toBe(1);
    expect(candidate.beds.H5C1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'EloisaNewborn',
      medicalHandoffNote: 'Nota RN sintética',
      rut: manualChild.rut,
      patientName: manualChild.patientName,
      admissionDate: manualChild.admissionDate,
      admissionTime: manualChild.admissionTime,
    });
    expect(candidate.discharges).toEqual([]);
    expect(candidate.transfers).toEqual([]);
    expect(candidate.cma).toEqual([]);
    expect(serverGuard(current, candidate)).toEqual([]);
    expect(downgradeGuard(current, candidate)).toEqual([]);
  });
});
