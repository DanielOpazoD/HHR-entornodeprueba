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
import type { PatientData } from '@/types/domain/patient';

const encounter = (encounterId: string, source: 'cma' | 'physical'): RayenEncounter => ({
  encounterId,
  run: source === 'cma' ? '11.111.111-1' : '22.222.222-2',
  firstGivenName: source === 'cma' ? 'Camila' : 'Mario',
  firstFamilyName: 'Paciente',
  admissionDatetime: '2026-08-21T08:00:00-06:00',
  service:
    source === 'cma' ? 'Área quirúrgica indiferenciada' : 'Área Médico Quirúrgica Indiferenciada',
  room: source === 'cma' ? 'CMA R3' : 'Recuperación 3',
  bed: source === 'cma' ? 'CMAR3' : 'R3',
});

const patient = (source: RayenEncounter, bedId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  patientName: `${source.firstGivenName} Paciente`,
  rut: source.run ?? '',
  clinicalEpisodeId: source.encounterId,
});

const context = () => ({
  idFactory: () => 'movement-1',
  now: new Date('2026-08-21T12:30:00-06:00'),
  actor: 'Nurse Test',
  syncRunId: 'run-durable-collision-discharge',
});

describe('durable collision decision and discharge precedence', () => {
  it('keeps the active retained episode when a later report repeats a stale discharge', () => {
    const cma = encounter('CMA-R3', 'cma');
    const physical = encounter('MQ-R3', 'physical');
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: { R3: patient(cma, 'R3'), H2C1: patient(physical, 'H2C1') },
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
    const initial = reconcileCensus(current, snapshot);
    const collision = initial.bedOccupancyCollisions?.[0];
    if (!collision) throw new Error('Expected R3 source collision');
    const resolved = resolveBedOccupancyCollisions(initial, [
      {
        collisionId: collision.id,
        selectedEpisodeId: 'CMA-R3',
        otherDisposition: { kind: 'remove' },
      },
    ]);
    const applied = applyCensusImportDiff(current, resolved, context());
    const repeated = reconcileCensus(applied.record, snapshot);
    repeated.discharges.push({
      bedId: 'R3',
      rut: applied.record.beds.R3.rut,
      patientName: applied.record.beds.R3.patientName,
      kind: 'alta',
      status: 'Vivo',
      reason: 'administrative-discharge',
      encounterId: 'CMA-R3',
      expectedOccupant: {
        clinicalEpisodeId: 'CMA-R3',
        rut: applied.record.beds.R3.rut,
      },
    });

    const reapplied = applyCensusImportDiff(applied.record, repeated, context());

    expect(repeated.retainedBedCollisionResolutions).toContainEqual(
      expect.objectContaining({ id: collision.id, selectedEpisodeId: 'CMA-R3' })
    );
    expect(reapplied.record.beds.R3.clinicalEpisodeId).toBe('CMA-R3');
    expect(reapplied.record.discharges).toHaveLength(0);
  });

  it('allows a later discharge once the retained episode is no longer active', () => {
    const cma = encounter('CMA-R3', 'cma');
    const physical = encounter('MQ-R3', 'physical');
    const current: DailyRecord = {
      date: '2026-08-21',
      beds: { R3: patient(cma, 'R3'), H2C1: patient(physical, 'H2C1') },
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
    const initial = reconcileCensus(current, snapshot);
    const collision = initial.bedOccupancyCollisions?.[0];
    if (!collision) throw new Error('Expected R3 source collision');
    const resolved = resolveBedOccupancyCollisions(initial, [
      {
        collisionId: collision.id,
        selectedEpisodeId: 'CMA-R3',
        otherDisposition: { kind: 'remove' },
      },
    ]);
    const applied = applyCensusImportDiff(current, resolved, context());
    const later = reconcileCensus(applied.record, {
      ...snapshot,
      capturedAt: '2026-08-21T18:00:00-06:00',
      encounters: [],
    });
    later.discharges.push({
      bedId: 'R3',
      rut: applied.record.beds.R3.rut,
      patientName: applied.record.beds.R3.patientName,
      kind: 'alta',
      status: 'Vivo',
      reason: 'administrative-discharge',
      encounterId: 'CMA-R3',
      expectedOccupant: {
        clinicalEpisodeId: 'CMA-R3',
        rut: applied.record.beds.R3.rut,
      },
    });

    const reapplied = applyCensusImportDiff(applied.record, later, context());

    expect(later.retainedBedCollisionResolutions).toEqual([]);
    expect(reapplied.record.beds.R3).toBeUndefined();
    expect(reapplied.record.discharges).toHaveLength(1);
  });
});
