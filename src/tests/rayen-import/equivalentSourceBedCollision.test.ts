import { describe, expect, it } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCensusImportDiff,
  reconcileCensus,
  type BedOccupancyCollisionResolution,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { resolveBedOccupancyCollisions } from '@/features/rayen-import/domain/bedOccupancyCollisionPolicy';
const EQUIVALENT_BEDS = ['R1', 'R2', 'R3', 'R4', 'NEO1', 'NEO2'] as const;
const encounter = (
  bedId: (typeof EQUIVALENT_BEDS)[number],
  encounterId: string,
  patientName: string,
  source: 'cma' | 'physical'
): RayenEncounter => {
  const isNeo = bedId.startsWith('NEO');
  const number = bedId.at(-1);
  const sourceDigit = source === 'cma' ? '1' : '2';
  return {
    encounterId,
    run: `${sourceDigit}${number ?? '9'}1111111`,
    firstGivenName: patientName,
    firstFamilyName: 'Paciente',
    admissionDatetime: '2026-08-21T08:00:00-06:00',
    service:
      source === 'cma' ? 'Área quirúrgica indiferenciada' : 'Área Médico Quirúrgica Indiferenciada',
    room: source === 'cma' ? `CMA ${bedId}` : isNeo ? `Neo ${number}` : `Recuperación ${number}`,
    bed: source === 'cma' ? `CMA${bedId}` : isNeo ? `NEO${number}` : `R${number}`,
  };
};
const patient = (entry: RayenEncounter, bedId: string): PatientData => ({
  ...EMPTY_PATIENT,
  bedId,
  patientName: `${entry.firstGivenName} Paciente`,
  rut: entry.run ?? '',
  clinicalEpisodeId: entry.encounterId,
  handoffNote: `nota-${entry.encounterId}`,
});

const fixture = (bedId: (typeof EQUIVALENT_BEDS)[number]) => {
  const cma = encounter(bedId, `CMA-${bedId}`, 'Camila', 'cma');
  const physical = encounter(bedId, `MQ-${bedId}`, 'Mario', 'physical');
  const current: DailyRecord = {
    date: '2026-08-21',
    beds: { [bedId]: patient(cma, bedId), H2C1: patient(physical, 'H2C1') },
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
  return { cma, physical, current, snapshot };
};

const context = () => {
  let id = 0;
  return {
    idFactory: () => `movement-${++id}`,
    now: new Date('2026-08-21T12:30:00-06:00'),
    actor: 'Nurse Test',
    syncRunId: 'run-equivalent-bed-collision',
  };
};

const reviewed = (
  bedId: (typeof EQUIVALENT_BEDS)[number],
  resolution: Omit<BedOccupancyCollisionResolution, 'collisionId'>
) => {
  const { current, snapshot } = fixture(bedId);
  const diff = reconcileCensus(current, snapshot, {
    reference: new Date('2026-08-21T12:00:00-06:00'),
  });
  const collision = diff.bedOccupancyCollisions?.[0];
  if (!collision) throw new Error(`Expected ${bedId} source collision`);
  return {
    current,
    diff: resolveBedOccupancyCollisions(diff, [{ ...resolution, collisionId: collision.id }]),
  };
};

describe('CMA and physical equivalent-bed collisions', () => {
  it.each(EQUIVALENT_BEDS)(
    'blocks first-wins planning and exposes both source episodes for %s',
    bedId => {
      const { current, snapshot } = fixture(bedId);
      const diff = reconcileCensus(current, snapshot);

      expect(diff.admissions).toHaveLength(0);
      expect(diff.moves).toHaveLength(0);
      expect(diff.bedOccupancyCollisions?.[0]).toMatchObject({
        bedId,
        candidates: [
          { clinicalEpisodeId: `CMA-${bedId}`, sourceKind: 'cma', currentBedId: bedId },
          {
            clinicalEpisodeId: `MQ-${bedId}`,
            sourceKind: 'medical-surgical',
            currentBedId: 'H2C1',
          },
        ],
      });
      expect(diff.conflicts).toEqual([
        expect.objectContaining({ code: 'cma-physical-bed-collision', bedId }),
      ]);
      expect(diff.pendingAdministrativeDischarges).toHaveLength(0);
    }
  );

  it('keeps the selected episode in its equivalent bed and moves the other atomically', () => {
    const { current, diff } = reviewed('NEO2', {
      selectedEpisodeId: 'CMA-NEO2',
      otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
    });
    const result = applyCensusImportDiff(current, diff, context());

    expect(result.record.beds.NEO2).toMatchObject({
      clinicalEpisodeId: 'CMA-NEO2',
      handoffNote: 'nota-CMA-NEO2',
    });
    expect(result.record.beds.H3C1).toMatchObject({
      clinicalEpisodeId: 'MQ-NEO2',
      handoffNote: 'nota-MQ-NEO2',
    });
    expect(result.record.beds.H2C1).toBeUndefined();
    expect(result.skipped).toHaveLength(0);
  });

  it('does not offer a blocked bed as an alternative destination', () => {
    const { current, snapshot } = fixture('R1');
    current.beds.H3C1 = {
      ...EMPTY_PATIENT,
      bedId: 'H3C1',
      patientName: '',
      isBlocked: true,
      blockedReason: 'Mantención',
    };

    const diff = reconcileCensus(current, snapshot);

    expect(diff.bedOccupancyCollisions?.[0].availableAlternativeBedIds).not.toContain('H3C1');
  });

  it('collapses CMA and physical aliases of the same episode without requesting review', () => {
    const { current, snapshot } = fixture('R1');
    snapshot.encounters[1] = {
      ...snapshot.encounters[0],
      service: 'Área Médico Quirúrgica Indiferenciada',
      room: 'Recuperación 1',
      bed: 'R1',
    };

    const diff = reconcileCensus(current, snapshot);

    expect(diff.bedOccupancyCollisions).toEqual([]);
    expect(diff.conflicts).toEqual([]);
  });

  it('excludes a future encounter from a historical equivalent-bed collision', () => {
    const { current, snapshot } = fixture('R1');
    current.date = '2026-08-20';
    delete current.beds.H2C1;
    snapshot.encounters[1] = {
      ...snapshot.encounters[1],
      admissionDatetime: '2026-08-21T08:00:00-06:00',
    };

    const diff = reconcileCensus(current, snapshot, {
      reference: new Date('2026-08-21T12:00:00-06:00'),
    });

    expect(diff.bedOccupancyCollisions).toEqual([]);
    expect(diff.admissions.some(entry => entry.source?.encounterId === 'MQ-R1')).toBe(false);
    expect(diff.moves.some(entry => entry.source?.encounterId === 'MQ-R1')).toBe(false);
  });

  it.each([
    ['discharge', 'discharges'],
    ['transfer', 'transfers'],
  ] as const)('records a manual %s for the non-selected episode', (kind, list) => {
    const { current, diff } = reviewed('R4', {
      selectedEpisodeId: 'MQ-R4',
      otherDisposition: { kind },
    });
    const result = applyCensusImportDiff(current, diff, context());

    expect(result.record.beds.R4.clinicalEpisodeId).toBe('MQ-R4');
    expect(result.record[list]).toEqual([
      expect.objectContaining({
        clinicalEpisodeId: 'CMA-R4',
        movementProvenance: expect.objectContaining({ source: 'manual' }),
      }),
    ]);
  });

  it('can remove the other episode without inventing a discharge movement', () => {
    const { current, diff } = reviewed('R3', {
      selectedEpisodeId: 'CMA-R3',
      otherDisposition: { kind: 'remove' },
    });
    const result = applyCensusImportDiff(current, diff, context());

    expect(result.record.beds.R3.clinicalEpisodeId).toBe('CMA-R3');
    expect(result.record.beds.H2C1).toBeUndefined();
    expect(result.record.discharges).toHaveLength(0);
    expect(result.record.transfers).toHaveLength(0);
  });

  it('does not request the same reviewed collision again on an unchanged snapshot', () => {
    const { current, snapshot } = fixture('R3');
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

    expect(applied.record.rayenBedCollisionResolutions).toContainEqual(
      expect.objectContaining({ id: collision.id, selectedEpisodeId: 'CMA-R3' })
    );
    const repeated = reconcileCensus(applied.record, snapshot);

    expect(repeated.bedOccupancyCollisions).toEqual([]);
    expect(repeated.conflicts).toEqual([]);
    expect(repeated.admissions).toEqual([]);
    expect(repeated.moves).toEqual([]);
  });

  it('reopens a reviewed collision when the recorded bed outcome no longer matches', () => {
    const { current, snapshot } = fixture('R3');
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
    delete applied.record.beds.R3;

    const repeated = reconcileCensus(applied.record, snapshot);

    expect(repeated.bedOccupancyCollisions).toHaveLength(1);
    expect(repeated.conflicts).toEqual([
      expect.objectContaining({ code: 'cma-physical-bed-collision', bedId: 'R3' }),
    ]);
  });

  it('reopens a discharge decision when its movement was deleted', () => {
    const { current, snapshot } = fixture('R4');
    const initial = reconcileCensus(current, snapshot);
    const collision = initial.bedOccupancyCollisions?.[0];
    if (!collision) throw new Error('Expected R4 source collision');
    const resolved = resolveBedOccupancyCollisions(initial, [
      {
        collisionId: collision.id,
        selectedEpisodeId: 'CMA-R4',
        otherDisposition: { kind: 'discharge' },
      },
    ]);
    const applied = applyCensusImportDiff(current, resolved, context());
    applied.record.discharges[0].deletedAt = '2026-08-21T13:00:00-06:00';

    const repeated = reconcileCensus(applied.record, snapshot);

    expect(repeated.bedOccupancyCollisions).toHaveLength(1);
    expect(repeated.conflicts).toEqual([
      expect.objectContaining({ code: 'cma-physical-bed-collision', bedId: 'R4' }),
    ]);
  });

  it('keeps Rayen field updates flowing through a matching move receipt', () => {
    const { current, snapshot } = fixture('NEO2');
    const initial = reconcileCensus(current, snapshot);
    const collision = initial.bedOccupancyCollisions?.[0];
    if (!collision) throw new Error('Expected NEO2 source collision');
    const resolved = resolveBedOccupancyCollisions(initial, [
      {
        collisionId: collision.id,
        selectedEpisodeId: 'CMA-NEO2',
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
    ]);
    const applied = applyCensusImportDiff(current, resolved, context());
    const changedSnapshot: RayenCensusSnapshot = {
      ...snapshot,
      encounters: snapshot.encounters.map(entry =>
        entry.encounterId === 'MQ-NEO2' ? { ...entry, diagnosis: 'Diagnóstico actualizado' } : entry
      ),
    };

    const repeated = reconcileCensus(applied.record, changedSnapshot);

    expect(repeated.bedOccupancyCollisions).toEqual([]);
    expect(repeated.updates).toEqual([
      expect.objectContaining({ bedId: 'H3C1', changes: expect.any(Array) }),
    ]);
  });

  it('requests a new decision when one episode in a resolved bed collision changes', () => {
    const { current, snapshot } = fixture('R3');
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
    const changedSnapshot: RayenCensusSnapshot = {
      ...snapshot,
      encounters: snapshot.encounters.map(entry =>
        entry.encounterId === 'MQ-R3' ? { ...entry, encounterId: 'MQ-R3-NEW' } : entry
      ),
    };

    const repeated = reconcileCensus(applied.record, changedSnapshot);

    expect(repeated.bedOccupancyCollisions).toHaveLength(1);
    expect(repeated.bedOccupancyCollisions?.[0].id).not.toBe(collision.id);
    expect(repeated.conflicts).toEqual([
      expect.objectContaining({ code: 'cma-physical-bed-collision', bedId: 'R3' }),
    ]);
  });

  it('requires and applies one decision for each simultaneous equivalent-bed collision', () => {
    const r1 = fixture('R1');
    const r2 = fixture('R2');
    const current: DailyRecord = {
      ...r1.current,
      beds: {
        R1: r1.current.beds.R1,
        H2C1: r1.current.beds.H2C1,
        R2: r2.current.beds.R2,
        H2C2: patient(r2.physical, 'H2C2'),
      },
    };
    const snapshot: RayenCensusSnapshot = {
      ...r1.snapshot,
      encounters: [...r1.snapshot.encounters, ...r2.snapshot.encounters],
    };
    const diff = reconcileCensus(current, snapshot);

    expect(diff.bedOccupancyCollisions?.map(item => item.bedId)).toEqual(['R1', 'R2']);
    const resolved = resolveBedOccupancyCollisions(diff, [
      {
        collisionId: diff.bedOccupancyCollisions![0].id,
        selectedEpisodeId: 'CMA-R1',
        otherDisposition: { kind: 'remove' },
      },
      {
        collisionId: diff.bedOccupancyCollisions![1].id,
        selectedEpisodeId: 'MQ-R2',
        otherDisposition: { kind: 'remove' },
      },
    ]);
    const result = applyCensusImportDiff(current, resolved, context());

    expect(result.record.beds.R1.clinicalEpisodeId).toBe('CMA-R1');
    expect(result.record.beds.R2.clinicalEpisodeId).toBe('MQ-R2');
    expect(result.record.beds.H2C1).toBeUndefined();
    expect(result.record.beds.H2C2).toBeUndefined();
    expect(result.skipped).toHaveLength(0);
  });

  it('rejects all reviewed collision decisions atomically when they share one destination', () => {
    const r1 = fixture('R1');
    const r2 = fixture('R2');
    const current: DailyRecord = {
      ...r1.current,
      beds: {
        R1: r1.current.beds.R1,
        H2C1: r1.current.beds.H2C1,
        R2: r2.current.beds.R2,
        H2C2: patient(r2.physical, 'H2C2'),
      },
    };
    const diff = reconcileCensus(current, {
      ...r1.snapshot,
      encounters: [...r1.snapshot.encounters, ...r2.snapshot.encounters],
    });
    diff.bedOccupancyCollisionResolutions = [
      {
        collisionId: diff.bedOccupancyCollisions![0].id,
        selectedEpisodeId: 'CMA-R1',
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
      {
        collisionId: diff.bedOccupancyCollisions![1].id,
        selectedEpisodeId: 'CMA-R2',
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
    ];

    const result = applyCensusImportDiff(current, diff, context());

    expect(result.record.beds).toEqual(current.beds);
    expect(result.applied).toEqual({ admissions: 0, updates: 0, moves: 0, discharges: 0 });
    expect(result.skipped).toHaveLength(2);
  });

  it('keeps every collision pending when reviewed moves compete for one destination', () => {
    const r1 = fixture('R1');
    const r2 = fixture('R2');
    const current: DailyRecord = {
      ...r1.current,
      beds: {
        R1: r1.current.beds.R1,
        H2C1: r1.current.beds.H2C1,
        R2: r2.current.beds.R2,
        H2C2: patient(r2.physical, 'H2C2'),
      },
    };
    const diff = reconcileCensus(current, {
      ...r1.snapshot,
      encounters: [...r1.snapshot.encounters, ...r2.snapshot.encounters],
    });
    const resolved = resolveBedOccupancyCollisions(diff, [
      {
        collisionId: diff.bedOccupancyCollisions![0].id,
        selectedEpisodeId: 'CMA-R1',
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
      {
        collisionId: diff.bedOccupancyCollisions![1].id,
        selectedEpisodeId: 'CMA-R2',
        otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
      },
    ]);

    expect(resolved.bedOccupancyCollisionResolutions).toEqual([]);
    expect(resolved.conflicts).toHaveLength(2);
    expect(resolved.summary.conflicts).toBe(2);
  });

  it('rejects a stale reviewed destination when the bed became blocked', () => {
    const { current, diff } = reviewed('R1', {
      selectedEpisodeId: 'CMA-R1',
      otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
    });
    current.beds.H3C1 = {
      ...EMPTY_PATIENT,
      bedId: 'H3C1',
      patientName: '',
      isBlocked: true,
      blockedReason: 'Mantención',
    };

    const result = applyCensusImportDiff(current, diff, context());

    expect(result.record.beds.R1.clinicalEpisodeId).toBe('CMA-R1');
    expect(result.record.beds.H2C1.clinicalEpisodeId).toBe('MQ-R1');
    expect(result.record.beds.H3C1.isBlocked).toBe(true);
    expect(result.applied).toEqual({ admissions: 0, updates: 0, moves: 0, discharges: 0 });
    expect(result.skipped).toHaveLength(1);
  });

  it('does not let a collision decision claim an ordinary structural target', () => {
    const { current, diff } = reviewed('R1', {
      selectedEpisodeId: 'CMA-R1',
      otherDisposition: { kind: 'move', targetBedId: 'H3C1' },
    });
    const incoming = encounter('R3', 'ORDINARY-1', 'Olivia', 'physical');
    diff.admissions.push({
      bedId: 'H3C1',
      patient: patient(incoming, 'H3C1'),
      isCma: false,
      source: incoming,
    });

    const result = applyCensusImportDiff(current, diff, context());

    expect(result.record.beds.R1.clinicalEpisodeId).toBe('CMA-R1');
    expect(result.record.beds.H2C1.clinicalEpisodeId).toBe('MQ-R1');
    expect(result.record.beds.H3C1.clinicalEpisodeId).toBe('ORDINARY-1');
    expect(result.skipped).toEqual([
      expect.objectContaining({ kind: 'bed-collision', bedId: 'R1' }),
    ]);
  });
});
