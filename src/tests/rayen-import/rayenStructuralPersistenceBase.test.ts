import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { buildRayenStructuralPersistenceBase } from '@/features/rayen-import/domain/rayenStructuralPersistenceBase';
import { applyCensusImportDiff } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

const patient = (bedId: string, note?: string): PatientData =>
  ({
    bedId,
    patientName: 'Paciente sanitizado',
    rut: 'ID-SANITIZADO',
    age: '40',
    pathology: 'Diagnóstico sanitizado',
    specialty: 'Medicina Interna',
    status: 'Estable',
    admissionDate: '2026-08-17',
    clinicalEpisodeId: 'episode-move-r4-r1',
    medicalHandoffNote: note,
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    hasWristband: true,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
  }) as PatientData;

const record = (beds: DailyRecord['beds'], lastUpdated: string): DailyRecord => ({
  date: '2026-08-17',
  beds,
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated,
});

const diffWithMoves = (moves: CensusImportDiff['moves'] = []): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves,
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: moves.length,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
});

const reviewedMoveDiff = diffWithMoves([
  {
    fromBedId: 'R4',
    toBedId: 'R1',
    rut: 'ID-SANITIZADO',
    patientName: 'Paciente sanitizado',
    source: { encounterId: 'episode-move-r4-r1' } as never,
  },
]);

const emptyDiff = diffWithMoves();
const pendingLocal = { localWriteState: 'active' } as const;

const collisionDiff = (
  disposition: { kind: 'move'; targetBedId: string } | { kind: 'discharge' | 'transfer' | 'remove' }
): CensusImportDiff => ({
  ...emptyDiff,
  bedOccupancyCollisions: [
    {
      id: 'collision-r1',
      bedId: 'R1',
      availableAlternativeBedIds: ['R2'],
      candidates: [
        {
          clinicalEpisodeId: 'episode-selected',
          sourceKind: 'medical-surgical',
          currentBedId: 'R4',
          patient: { ...patient('R4'), clinicalEpisodeId: 'episode-selected' },
          source: { encounterId: 'episode-selected' } as never,
        },
        {
          clinicalEpisodeId: 'episode-other',
          sourceKind: 'cma',
          currentBedId: 'R1',
          patient: { ...patient('R1'), clinicalEpisodeId: 'episode-other' },
          source: { encounterId: 'episode-other' } as never,
        },
      ],
    },
  ],
  bedOccupancyCollisionResolutions: [
    {
      collisionId: 'collision-r1',
      selectedEpisodeId: 'episode-selected',
      otherDisposition: disposition,
    },
  ],
});

describe('buildRayenStructuralPersistenceBase', () => {
  it.each([
    ['without a local record', null, undefined],
    ['without an active local write', record({}, '2026-08-17T20:01:00.000Z'), undefined],
  ])('rejects duplicate authoritative episodes %s', (_label, local, localWriteState) => {
    const duplicated = patient('R4');
    const authoritative = record(
      { R4: duplicated, R1: { ...duplicated, bedId: 'R1' } },
      '2026-08-17T20:00:00.000Z'
    );

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, { localWriteState })
    ).toThrow('El censo autoritativo contiene el episodio episode-move-r4-r1 en R4 y R1');
  });

  it('rebases a pending local move onto the authoritative bed without duplicating the episode', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record(
      { R1: patient('R1', 'Nota local que no debe perderse') },
      '2026-08-17T20:01:00.000Z'
    );

    const base = buildRayenStructuralPersistenceBase(
      authoritative,
      local,
      reviewedMoveDiff,
      pendingLocal
    );

    expect(base.lastUpdated).toBe(authoritative.lastUpdated);
    expect(base.beds.R1).toBeUndefined();
    expect(base.beds.R4?.clinicalEpisodeId).toBe('episode-move-r4-r1');
    expect(base.beds.R4?.medicalHandoffNote).toBe('Nota local que no debe perderse');
  });

  it('persists the reviewed R4 to R1 movement atomically on the first application', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record(
      { R1: patient('R1', 'Nota local que no debe perderse') },
      '2026-08-17T20:01:00.000Z'
    );
    const base = buildRayenStructuralPersistenceBase(
      authoritative,
      local,
      reviewedMoveDiff,
      pendingLocal
    );
    const applied = applyCensusImportDiff(base, reviewedMoveDiff, {
      idFactory: () => 'movement-id',
      now: new Date('2026-08-17T20:02:00.000Z'),
      syncRunId: 'run-first-pass',
    });

    expect(applied.applied.moves).toBe(1);
    expect(applied.skipped).toEqual([]);
    expect(applied.record.beds.R4).toBeUndefined();
    expect(applied.record.beds.R1?.clinicalEpisodeId).toBe('episode-move-r4-r1');
    expect(applied.record.beds.R1?.medicalHandoffNote).toBe('Nota local que no debe perderse');
  });

  it('blocks a local-only occupant that was absent from the reviewed remote layout', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const unrelatedLocalPatient = {
      ...patient('R1'),
      patientName: 'Paciente local no revisado',
      clinicalEpisodeId: 'episode-local-only',
    };
    const local = record(
      { R1: unrelatedLocalPatient, R2: patient('R2', 'Nota local que debe conservarse') },
      '2026-08-17T20:01:00.000Z'
    );

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).toThrow('Hay cambios locales de cama sin confirmar en R1');
  });

  it('rejects a local destination that differs from the reviewed movement target', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record({ R2: patient('R2') }, '2026-08-17T20:01:00.000Z');

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, reviewedMoveDiff, pendingLocal)
    ).toThrow('Hay cambios locales de cama sin confirmar en R2');
  });

  it('rejects an additional duplicate even when the reviewed movement target also exists', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record({ R1: patient('R1'), R2: patient('R2') }, '2026-08-17T20:01:00.000Z');

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, reviewedMoveDiff, pendingLocal)
    ).toThrow('Hay cambios locales de cama sin confirmar en R2');
  });

  it('ignores a stale local placement instead of treating it as a pending move', () => {
    const authoritativePatient = { ...patient('R1'), medicalHandoffNote: 'Nota confirmada' };
    const authoritative = record({ R1: authoritativePatient }, '2026-08-17T20:01:00.000Z');
    const staleLocal = record(
      { R4: patient('R4', 'Nota local obsoleta') },
      '2026-08-17T20:00:00.000Z'
    );

    const base = buildRayenStructuralPersistenceBase(authoritative, staleLocal, emptyDiff);

    expect(base).toBe(authoritative);
    expect(base.beds.R4).toBeUndefined();
    expect(base.beds.R1?.medicalHandoffNote).toBe('Nota confirmada');
  });

  it('blocks a failed local version instead of silently discarding its edits', () => {
    const authoritative = record(
      { R4: patient('R4', 'Nota confirmada') },
      '2026-08-17T20:00:00.000Z'
    );
    const failedLocal = record(
      { R1: patient('R1', 'Nota de una escritura fallida') },
      '2026-08-17T20:01:00.000Z'
    );

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, failedLocal, reviewedMoveDiff, {
        localWriteState: 'failed',
      })
    ).toThrow('Hay cambios locales que no pudieron guardarse');
  });

  it.each(['failed', 'conflict'] as const)(
    'blocks a %s local write even when its timestamp is malformed',
    localWriteState => {
      const authoritative = record({ R4: patient('R4') }, 'fecha-invalida-remota');
      const local = record({ R4: patient('R4', 'Nota local') }, 'fecha-invalida-local');

      expect(() =>
        buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, { localWriteState })
      ).toThrow('Hay cambios locales que no pudieron guardarse');
    }
  );

  it('blocks an active local write when timestamps cannot establish its ordering', () => {
    const authoritative = record({ R4: patient('R4') }, 'fecha-invalida-remota');
    const local = record({ R4: patient('R4', 'Nota local') }, 'fecha-invalida-local');

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).toThrow('No se pudo verificar la versión local pendiente');
  });

  it('blocks a stale but still-active outbox placement before it can overwrite remote structure', () => {
    const authoritative = record(
      { R1: { ...patient('R1'), medicalHandoffNote: 'Nota confirmada' } },
      '2026-08-17T20:01:00.000Z'
    );
    const stalePendingLocal = record(
      { R4: patient('R4', 'Nota local pendiente') },
      '2026-08-17T20:00:00.000Z'
    );

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, stalePendingLocal, emptyDiff, {
        localWriteState: 'active',
      })
    ).toThrow('Hay cambios locales de cama sin confirmar');
  });

  it('blocks conflicting content when an older active outbox has the same episode and bed', () => {
    const authoritative = record(
      { R4: patient('R4', 'Nota remota más reciente') },
      '2026-08-17T20:01:00.000Z'
    );
    const olderPendingLocal = record(
      { R4: patient('R4', 'Nota local anterior') },
      '2026-08-17T20:00:00.000Z'
    );

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, olderPendingLocal, emptyDiff, pendingLocal)
    ).toThrow('El censo remoto cambió mientras había datos locales pendientes');
  });

  it('blocks older active outbox movements instead of restoring authoritative collections', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:01:00.000Z');
    const local = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    local.transfers = [{ id: 'pending-transfer' }] as DailyRecord['transfers'];

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).toThrow('Hay movimientos locales sin confirmar');
  });

  it('accepts a pending outbox that already reflects a reviewed collision relocation', () => {
    const selected = { ...patient('R4'), clinicalEpisodeId: 'episode-selected' };
    const other = { ...patient('R1'), clinicalEpisodeId: 'episode-other' };
    const authoritative = record({ R4: selected, R1: other }, '2026-08-17T20:00:00.000Z');
    const local = record(
      {
        R1: { ...selected, bedId: 'R1', medicalHandoffNote: 'Nota local revisada' },
        R2: { ...other, bedId: 'R2' },
      },
      '2026-08-17T20:01:00.000Z'
    );

    const base = buildRayenStructuralPersistenceBase(
      authoritative,
      local,
      collisionDiff({ kind: 'move', targetBedId: 'R2' }),
      pendingLocal
    );

    expect(base.beds.R4?.medicalHandoffNote).toBe('Nota local revisada');
    expect(base.beds.R1?.clinicalEpisodeId).toBe('episode-other');
    expect(base.beds.R2).toBeUndefined();
  });

  it('rejects a reviewed local-only collision candidate whose fields cannot be rebased safely', () => {
    const selected = { ...patient('R4'), clinicalEpisodeId: 'episode-selected' };
    const other = { ...patient('R2'), clinicalEpisodeId: 'episode-other' };
    const authoritative = record({ R4: selected }, '2026-08-17T20:00:00.000Z');
    const local = record(
      { R1: { ...selected, bedId: 'R1' }, R2: other },
      '2026-08-17T20:01:00.000Z'
    );

    expect(() =>
      buildRayenStructuralPersistenceBase(
        authoritative,
        local,
        collisionDiff({ kind: 'move', targetBedId: 'R2' }),
        pendingLocal
      )
    ).toThrow('Hay cambios locales de cama sin confirmar en R2');
  });

  it('rejects a pending collision discharge because its clinical details cannot be safely rebuilt', () => {
    const selected = { ...patient('R4'), clinicalEpisodeId: 'episode-selected' };
    const other = { ...patient('R1'), clinicalEpisodeId: 'episode-other' };
    const authoritative = record({ R4: selected, R1: other }, '2026-08-17T20:00:00.000Z');
    const local = record({ R1: { ...selected, bedId: 'R1' } }, '2026-08-17T20:01:00.000Z');
    local.discharges = [
      { id: 'collision-discharge', clinicalEpisodeId: 'episode-other' },
    ] as DailyRecord['discharges'];

    expect(() =>
      buildRayenStructuralPersistenceBase(
        authoritative,
        local,
        collisionDiff({ kind: 'discharge' }),
        pendingLocal
      )
    ).toThrow('Hay movimientos locales sin confirmar');
  });

  it('preserves same-bed legacy notes when stable identity and admission stamp match', () => {
    const legacyAuthoritative = {
      ...patient('R4'),
      clinicalEpisodeId: undefined,
      admissionTime: '12:00',
      medicalHandoffNote: undefined,
    };
    const legacyLocal = {
      ...legacyAuthoritative,
      medicalHandoffNote: 'Nota local de episodio heredado',
    };

    const base = buildRayenStructuralPersistenceBase(
      record({ R4: legacyAuthoritative }, '2026-08-17T20:00:00.000Z'),
      record({ R4: legacyLocal }, '2026-08-17T20:01:00.000Z'),
      emptyDiff,
      pendingLocal
    );

    expect(base.beds.R4?.medicalHandoffNote).toBe('Nota local de episodio heredado');
  });

  it('rejects a same-day legacy occupant when the admission time is missing', () => {
    const authoritativePatient = {
      ...patient('R4'),
      clinicalEpisodeId: undefined,
    };
    const localPatient = {
      ...authoritativePatient,
      medicalHandoffNote: 'Nota que no puede atribuirse a un episodio exacto',
    };

    expect(() =>
      buildRayenStructuralPersistenceBase(
        record({ R4: authoritativePatient }, '2026-08-17T20:00:00.000Z'),
        record({ R4: localPatient }, '2026-08-17T20:01:00.000Z'),
        emptyDiff,
        pendingLocal
      )
    ).toThrow('Hay cambios locales de cama sin confirmar en R4');
  });

  it('preserves a matching blocked-bed record and rejects a different local block', () => {
    const blocked = {
      ...patient('R4'),
      patientName: '',
      clinicalEpisodeId: undefined,
      isBlocked: true,
      blockedReason: 'Mantención',
    };
    const authoritative = record({ R4: blocked }, '2026-08-17T20:00:00.000Z');
    const sameLocal = record(
      { R4: { ...blocked, blockedReason: 'Mantención confirmada' } },
      '2026-08-17T20:01:00.000Z'
    );
    const differentLocal = record({ R1: { ...blocked, bedId: 'R1' } }, '2026-08-17T20:01:00.000Z');
    const staleLocal = record(
      { R4: { ...blocked, blockedReason: 'Mantención antigua' } },
      '2026-08-17T19:59:00.000Z'
    );

    expect(
      buildRayenStructuralPersistenceBase(authoritative, sameLocal, emptyDiff, pendingLocal).beds.R4
        ?.blockedReason
    ).toBe('Mantención confirmada');
    expect(
      buildRayenStructuralPersistenceBase(authoritative, staleLocal, emptyDiff).beds.R4
        ?.blockedReason
    ).toBe('Mantención');
    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, differentLocal, emptyDiff, pendingLocal)
    ).toThrow('Hay cambios locales de cama sin confirmar en R1');
  });

  it('blocks a pending local movement instead of carrying it into an unrelated Rayen commit', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record({ R4: patient('R4') }, '2026-08-17T20:01:00.000Z');
    local.discharges = [{ id: 'local-discharge' }] as DailyRecord['discharges'];

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).toThrow('Hay movimientos locales sin confirmar');
  });

  it('blocks newer local removals before restoring authoritative structural collections', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    authoritative.activeExtraBeds = ['EXTRA-1'];
    authoritative.discharges = [
      { id: 'confirmed-discharge' },
    ] as unknown as DailyRecord['discharges'];
    const local = record({ R4: patient('R4') }, '2026-08-17T20:01:00.000Z');

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).toThrow('Hay movimientos locales sin confirmar');
  });

  it('blocks a newer local edit to an existing movement with the same id', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record({ R4: patient('R4') }, '2026-08-17T20:01:00.000Z');
    authoritative.discharges = [
      { id: 'shared-discharge', time: '19:00' },
    ] as unknown as DailyRecord['discharges'];
    local.discharges = [
      { id: 'shared-discharge', time: '19:30' },
    ] as unknown as DailyRecord['discharges'];

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).toThrow('Hay movimientos locales sin confirmar');
  });

  it('blocks a newer local occupant removal before restoring the remote bed', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record({}, '2026-08-17T20:01:00.000Z');

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).toThrow('Hay cambios locales de cama sin confirmar en R4');
  });

  it('accepts an identical legacy movement without a generated id', () => {
    const authoritative = record({ R4: patient('R4') }, '2026-08-17T20:00:00.000Z');
    const local = record({ R4: patient('R4') }, '2026-08-17T20:01:00.000Z');
    const legacyMovement = {
      patientName: 'Paciente sanitizado',
      rut: 'ID-SANITIZADO',
      originalBedId: 'R4',
      movementDate: '2026-08-17',
      time: '19:30',
      status: 'Vivo',
    };
    authoritative.discharges = [legacyMovement] as unknown as DailyRecord['discharges'];
    local.discharges = [{ ...legacyMovement }] as unknown as DailyRecord['discharges'];

    expect(() =>
      buildRayenStructuralPersistenceBase(authoritative, local, emptyDiff, pendingLocal)
    ).not.toThrow();
  });
});
