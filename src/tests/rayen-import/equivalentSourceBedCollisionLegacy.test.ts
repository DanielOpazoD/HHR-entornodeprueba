import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCensusImportDiff,
  reconcileCensus,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { resolveBedOccupancyCollisions } from '@/features/rayen-import/domain/bedOccupancyCollisionPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const encounter = (
  encounterId: string,
  run: string,
  firstGivenName: string,
  source: 'cma' | 'physical'
): RayenEncounter => ({
  encounterId,
  run,
  firstGivenName,
  firstFamilyName: 'Paciente',
  admissionDatetime: '2026-08-21T08:00:00-06:00',
  service:
    source === 'cma' ? 'Área quirúrgica indiferenciada' : 'Área Médico Quirúrgica Indiferenciada',
  room: source === 'cma' ? 'CMA R2' : 'Recuperación 2',
  bed: source === 'cma' ? 'CMAR2' : 'R2',
});

describe('legacy equivalent-bed collision occupants', () => {
  it('offers the proven current bed so a legacy occupant can remain there', () => {
    const cma = encounter('CMA-R2', '111111111', 'Camila', 'cma');
    const physical = encounter('MQ-R2', '222222222', 'Mario', 'physical');
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: {
        R2: {
          ...EMPTY_PATIENT,
          bedId: 'R2',
          patientName: 'Camila Paciente',
          rut: cma.run,
          admissionDate: '2026-08-21',
          admissionTime: '08:00',
        },
        H2C1: {
          ...EMPTY_PATIENT,
          bedId: 'H2C1',
          patientName: 'Mario Paciente',
          rut: physical.run,
          admissionDate: '2026-08-21',
          admissionTime: '08:00',
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const diff = reconcileCensus(current, {
      capturedAt: '2026-08-21T12:00:00-06:00',
      facilityId: 1342,
      encounters: [cma, physical],
      isComplete: true,
    });
    const collision = diff.bedOccupancyCollisions?.[0];
    if (!collision) throw new Error('Expected R2 source collision');

    expect(collision.availableAlternativeBedIds).toContain('H2C1');
    const reviewedDiff = resolveBedOccupancyCollisions(diff, [
      {
        collisionId: collision.id,
        selectedEpisodeId: cma.encounterId,
        otherDisposition: { kind: 'move', targetBedId: 'H2C1' },
      },
    ]);
    const result = applyCensusImportDiff(current, reviewedDiff, {
      idFactory: () => 'movement-stay',
      now: new Date('2026-08-21T12:30:00-06:00'),
      actor: 'Nurse Test',
      syncRunId: 'run-legacy-stay',
    });

    expect(result.record.beds.R2.clinicalEpisodeId).toBe(cma.encounterId);
    expect(result.record.beds.H2C1.clinicalEpisodeId).toBe(physical.encounterId);
    expect(result.skipped).toEqual([]);
  });

  it('removes the legacy source bed and backfills both authoritative episode IDs', () => {
    const cma = encounter('CMA-R2', '111111111', 'Camila', 'cma');
    const physical = encounter('MQ-R2', '222222222', 'Mario', 'physical');
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: {
        R2: {
          ...EMPTY_PATIENT,
          bedId: 'R2',
          patientName: 'Camila Paciente',
          rut: cma.run,
          admissionDate: '2026-08-21',
          admissionTime: '08:00',
        },
        H2C1: {
          ...EMPTY_PATIENT,
          bedId: 'H2C1',
          patientName: 'Mario Paciente',
          rut: physical.run,
          admissionDate: '2026-08-21',
          admissionTime: '08:00',
        },
      },
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const snapshot: RayenCensusSnapshot = {
      capturedAt: '2026-08-21T12:00:00-06:00',
      facilityId: 1342,
      encounters: [cma, physical],
      isComplete: true,
    };
    const diff = reconcileCensus(current, snapshot);
    const collision = diff.bedOccupancyCollisions?.[0];
    if (!collision) throw new Error('Expected R2 source collision');
    const reviewedDiff = resolveBedOccupancyCollisions(diff, [
      {
        collisionId: collision.id,
        selectedEpisodeId: cma.encounterId,
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
    ]);

    const result = applyCensusImportDiff(current, reviewedDiff, {
      idFactory: () => 'movement-1',
      now: new Date('2026-08-21T12:30:00-06:00'),
      actor: 'Nurse Test',
      syncRunId: 'run-legacy-collision',
    });

    expect(result.record.beds.R2.clinicalEpisodeId).toBe(cma.encounterId);
    expect(result.record.beds.H3C1.clinicalEpisodeId).toBe(physical.encounterId);
    expect(result.record.beds.H2C1).toBeUndefined();
    expect(result.skipped).toHaveLength(0);
  });

  it('fails closed when the legacy admission timestamp cannot prove the reviewed episode', () => {
    const cma = encounter('CMA-R2', '111111111', 'Camila', 'cma');
    const physical = encounter('MQ-R2', '222222222', 'Mario', 'physical');
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: {
        R2: { ...EMPTY_PATIENT, bedId: 'R2', patientName: 'Camila Paciente', rut: cma.run },
        H2C1: { ...EMPTY_PATIENT, bedId: 'H2C1', patientName: 'Mario Paciente', rut: physical.run },
      },
      discharges: [],
      transfers: [],
      cma: [],
      activeExtraBeds: [],
      lastUpdated: '',
    };
    const snapshot: RayenCensusSnapshot = {
      capturedAt: '2026-08-21T12:00:00-06:00',
      facilityId: 1342,
      encounters: [cma, physical],
      isComplete: true,
    };
    const diff = reconcileCensus(current, snapshot);
    const collision = diff.bedOccupancyCollisions?.[0];
    if (!collision) throw new Error('Expected R2 source collision');
    const reviewedDiff = resolveBedOccupancyCollisions(diff, [
      {
        collisionId: collision.id,
        selectedEpisodeId: cma.encounterId,
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
    ]);

    const result = applyCensusImportDiff(current, reviewedDiff, {
      idFactory: () => 'movement-1',
      now: new Date('2026-08-21T12:30:00-06:00'),
      actor: 'Nurse Test',
      syncRunId: 'run-legacy-collision',
    });

    expect(result.record.beds.H2C1.patientName).toBe('Mario Paciente');
    expect(result.record.beds.H3C1).toBeUndefined();
    expect(result.skipped).toEqual([
      expect.objectContaining({ kind: 'bed-collision', bedId: 'R2' }),
    ]);
  });
});
