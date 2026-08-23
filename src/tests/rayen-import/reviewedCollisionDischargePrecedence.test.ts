import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import { applyCensusImportDiff } from '@/features/rayen-import';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { RayenEncounter } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

const encounter = (encounterId: string, run: string, bed: string): RayenEncounter => ({
  encounterId,
  run,
  firstGivenName: encounterId,
  firstFamilyName: 'Paciente',
  admissionDatetime: '2026-08-21T08:00:00-06:00',
  service: 'Área Médico Quirúrgica Indiferenciada',
  room: bed,
  bed,
});

const patient = (bedId: string, source: RayenEncounter): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  patientName: `${source.encounterId} Paciente`,
  rut: source.run ?? '',
  clinicalEpisodeId: source.encounterId,
  admissionDate: '2026-08-21',
  admissionTime: '08:00',
});

describe('reviewed collision and discharge precedence', () => {
  it('does not let stale discharge evidence remove the reviewed retained episode', () => {
    const selectedSource = encounter('CMA-R1', '11.111.111-1', 'R1');
    const otherSource = encounter('MQ-R1', '22.222.222-2', 'H2C1');
    const selected = patient('R1', selectedSource);
    const other = patient('H2C1', otherSource);
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: { R1: { ...selected, clinicalEpisodeId: undefined }, H2C1: other },
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [],
      moves: [],
      discharges: [
        {
          bedId: 'R1',
          rut: selected.rut,
          patientName: selected.patientName,
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          expectedOccupant: {
            rut: selected.rut,
            admissionDate: selected.admissionDate,
            admissionTime: selected.admissionTime,
          },
        },
        {
          bedId: 'H2C1',
          rut: other.rut,
          patientName: other.patientName,
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          encounterId: other.clinicalEpisodeId,
          expectedOccupant: {
            clinicalEpisodeId: other.clinicalEpisodeId,
            rut: other.rut,
          },
        },
      ],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      bedOccupancyCollisions: [
        {
          id: 'collision-R1',
          bedId: 'R1',
          candidates: [
            {
              clinicalEpisodeId: 'CMA-R1',
              sourceKind: 'cma',
              patient: selected,
              source: selectedSource,
              currentBedId: 'R1',
            },
            {
              clinicalEpisodeId: 'MQ-R1',
              sourceKind: 'medical-surgical',
              patient: other,
              source: otherSource,
              currentBedId: 'H2C1',
            },
          ],
          availableAlternativeBedIds: ['H3C1'],
        },
      ],
      bedOccupancyCollisionResolutions: [
        {
          collisionId: 'collision-R1',
          selectedEpisodeId: 'CMA-R1',
          otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
        },
      ],
      unchangedCount: 0,
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 2,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    };

    const result = applyCensusImportDiff(current, diff, {
      idFactory: () => 'movement-1',
      now: new Date('2026-08-21T12:30:00-06:00'),
      actor: 'Nurse Test',
      syncRunId: 'run-collision-discharge-precedence',
    });

    expect(result.record.beds.R1.clinicalEpisodeId).toBe('CMA-R1');
    expect(result.record.beds.H3C1.clinicalEpisodeId).toBe('MQ-R1');
    expect(result.record.discharges).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('applies valid discharge evidence when the reviewed collision can no longer be applied', () => {
    const selectedSource = encounter('CMA-R1', '11.111.111-1', 'R1');
    const otherSource = encounter('MQ-R1', '22.222.222-2', 'H2C1');
    const selected = patient('R1', selectedSource);
    const other = patient('H2C1', otherSource);
    const blockingSource = encounter('BLOCKING', '33.333.333-3', 'H3C1');
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: {
        R1: selected,
        H2C1: other,
        H3C1: patient('H3C1', blockingSource),
      },
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [],
      moves: [],
      discharges: [
        {
          bedId: 'R1',
          rut: selected.rut,
          patientName: selected.patientName,
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          encounterId: selected.clinicalEpisodeId,
          expectedOccupant: {
            clinicalEpisodeId: selected.clinicalEpisodeId,
            rut: selected.rut,
          },
        },
      ],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      bedOccupancyCollisions: [
        {
          id: 'collision-R1',
          bedId: 'R1',
          candidates: [
            {
              clinicalEpisodeId: 'CMA-R1',
              sourceKind: 'cma',
              patient: selected,
              source: selectedSource,
              currentBedId: 'R1',
            },
            {
              clinicalEpisodeId: 'MQ-R1',
              sourceKind: 'medical-surgical',
              patient: other,
              source: otherSource,
              currentBedId: 'H2C1',
            },
          ],
          availableAlternativeBedIds: ['H3C1'],
        },
      ],
      bedOccupancyCollisionResolutions: [
        {
          collisionId: 'collision-R1',
          selectedEpisodeId: 'CMA-R1',
          otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
        },
      ],
      unchangedCount: 0,
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 1,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    };

    const result = applyCensusImportDiff(current, diff, {
      idFactory: () => 'movement-2',
      now: new Date('2026-08-21T12:30:00-06:00'),
      actor: 'Nurse Test',
      syncRunId: 'run-rejected-collision-discharge',
    });

    expect(result.record.beds.R1).toBeUndefined();
    expect(result.record.beds.H2C1.clinicalEpisodeId).toBe('MQ-R1');
    expect(result.record.beds.H3C1.clinicalEpisodeId).toBe('BLOCKING');
    expect(result.record.discharges).toHaveLength(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({ kind: 'bed-collision', bedId: 'R1' }),
    ]);
  });

  it('vacates an unrelated reviewed discharge before placing the collision winner', () => {
    const selectedSource = encounter('CMA-R1', '11.111.111-1', 'R1');
    const otherSource = encounter('MQ-R1', '22.222.222-2', 'H2C1');
    const blockingSource = encounter('BLOCKING', '33.333.333-3', 'R1');
    const selected = patient('R4', selectedSource);
    const other = patient('H2C1', otherSource);
    const blocker = patient('R1', blockingSource);
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: { R1: blocker, R4: selected, H2C1: other },
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const diff: CensusImportDiff = {
      admissions: [],
      updates: [],
      moves: [],
      discharges: [
        {
          bedId: 'R1',
          rut: blocker.rut,
          patientName: blocker.patientName,
          kind: 'alta',
          status: 'Vivo',
          reason: 'administrative-discharge',
          encounterId: blocker.clinicalEpisodeId,
          expectedOccupant: {
            clinicalEpisodeId: blocker.clinicalEpisodeId,
            rut: blocker.rut,
          },
        },
      ],
      pendingAdministrativeDischarges: [],
      conflicts: [],
      bedOccupancyCollisions: [
        {
          id: 'collision-R1-turnover',
          bedId: 'R1',
          candidates: [
            {
              clinicalEpisodeId: 'CMA-R1',
              sourceKind: 'cma',
              patient: selected,
              source: selectedSource,
              currentBedId: 'R4',
            },
            {
              clinicalEpisodeId: 'MQ-R1',
              sourceKind: 'medical-surgical',
              patient: other,
              source: otherSource,
              currentBedId: 'H2C1',
            },
          ],
          availableAlternativeBedIds: [],
        },
      ],
      bedOccupancyCollisionResolutions: [
        {
          collisionId: 'collision-R1-turnover',
          selectedEpisodeId: 'CMA-R1',
          otherDisposition: { kind: 'remove' },
        },
      ],
      unchangedCount: 0,
      summary: {
        admissions: 0,
        updates: 0,
        moves: 0,
        discharges: 1,
        pendingAdministrativeDischarges: 0,
        conflicts: 0,
        unchanged: 0,
      },
    };

    const result = applyCensusImportDiff(current, diff, {
      idFactory: () => 'movement-turnover',
      now: new Date('2026-08-21T12:30:00-06:00'),
      actor: 'Nurse Test',
      syncRunId: 'run-collision-turnover',
    });

    expect(result.record.beds.R1.clinicalEpisodeId).toBe('CMA-R1');
    expect(result.record.beds.R4).toBeUndefined();
    expect(result.record.beds.H2C1).toBeUndefined();
    expect(result.record.discharges).toEqual([
      expect.objectContaining({ clinicalEpisodeId: 'BLOCKING' }),
    ]);
    expect(result.applied).toEqual({ admissions: 0, updates: 0, moves: 1, discharges: 1 });
    expect(result.skipped).toEqual([]);
  });
});
