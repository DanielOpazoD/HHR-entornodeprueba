import { describe, expect, it } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { RayenFillProgress } from '@/features/rayen-import/hooks/useRayenFillStatus';
import {
  buildRayenSyncBarViewModel,
  type RayenSyncBarViewModelInput,
} from '@/features/rayen-import/components/rayenSyncBarViewModel';

const fill = (overrides: Partial<RayenFillProgress> = {}): RayenFillProgress => ({
  running: false,
  outcome: 'idle',
  attemptId: 0,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
  staffingOutcome: 'idle',
  ...overrides,
});

const input = (
  overrides: Partial<RayenSyncBarViewModelInput> = {}
): RayenSyncBarViewModelInput => ({
  diff: null,
  fill: fill(),
  isApplyingCensus: false,
  isPreviewOpen: false,
  isSyncing: false,
  error: null,
  hasPersistedSync: false,
  ...overrides,
});

const oneChangeDiff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  reportEgresos: [],
  summary: {
    admissions: 1,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
} satisfies CensusImportDiff;

describe('buildRayenSyncBarViewModel', () => {
  it.each([
    ['idle', input(), 'idle', 'Listo para sincronizar'],
    ['capture', input({ isSyncing: true }), 'capture', 'Leyendo información de Eloísa'],
    [
      'review',
      input({ isPreviewOpen: true, diff: oneChangeDiff }),
      'review',
      '1 cambio listo para revisar',
    ],
    ['apply', input({ isApplyingCensus: true }), 'apply', 'Aplicando cambios al censo'],
    [
      'staffing decision',
      input({ fill: fill({ outcome: 'complete', staffingOutcome: 'pending' }) }),
      'staffing',
      'Revisión lista · 1 decisión pendiente',
    ],
    [
      'conflict',
      input({ hasUnresolvedConflicts: true, isSyncing: true }),
      'action',
      'Sincronización con conflictos pendientes',
    ],
  ])('maps %s to one canonical state', (_name, state, phase, label) => {
    expect(buildRayenSyncBarViewModel(state)).toMatchObject({ phase, label });
  });

  it('uses the real clinical patient counter instead of an inferred percentage', () => {
    const model = buildRayenSyncBarViewModel(
      input({ fill: fill({ running: true, outcome: 'running', done: 4, total: 8 }) })
    );

    expect(model.label).toBe('Datos clínicos · 4 de 8 pacientes');
    expect(model.progress).toEqual({ kind: 'determinate', done: 4, total: 8 });
    expect(model.ariaBusy).toBe(true);
  });

  it('counts pending administrative discharges in the review total', () => {
    const pendingAdministrativeDischargeDiff = {
      ...oneChangeDiff,
      summary: {
        ...oneChangeDiff.summary,
        admissions: 0,
        pendingAdministrativeDischarges: 1,
      },
    } satisfies CensusImportDiff;

    const model = buildRayenSyncBarViewModel(
      input({ isPreviewOpen: true, diff: pendingAdministrativeDischargeDiff })
    );

    expect(model).toMatchObject({
      phase: 'review',
      label: '1 cambio listo para revisar',
    });
  });

  it('keeps an overlapping rejected attempt visibly busy while the prior fill continues', () => {
    const model = buildRayenSyncBarViewModel(
      input({ fill: fill({ running: true, outcome: 'rejected', done: 3, total: 8 }) })
    );

    expect(model).toMatchObject({
      phase: 'clinical',
      label: 'Sincronización anterior en curso · 3 de 8 pacientes',
      progress: { kind: 'determinate', done: 3, total: 8 },
      ariaBusy: true,
    });
  });

  it('shows a completed fill until its successful sync metadata is persisted', () => {
    const model = buildRayenSyncBarViewModel(
      input({ fill: fill({ outcome: 'complete', done: 8, total: 8 }) })
    );

    expect(model).toMatchObject({
      phase: 'complete',
      label: 'Todo al día',
      visuallyHidden: false,
    });
  });

  it('never presents a completed fill with patient errors as successful', () => {
    const model = buildRayenSyncBarViewModel(
      input({ fill: fill({ outcome: 'complete', done: 7, total: 8, errors: 1 }) })
    );

    expect(model).toMatchObject({
      phase: 'action',
      tone: 'warning',
      label: 'Sincronización completada con observaciones',
      visuallyHidden: false,
    });
  });

  it('keeps the exact error as one expandable detail', () => {
    const model = buildRayenSyncBarViewModel(input({ error: 'La captura agotó el tiempo.' }));

    expect(model).toMatchObject({
      phase: 'action',
      label: 'Sincronización requiere revisión',
      detail: 'La captura agotó el tiempo.',
    });
  });

  it('does not turn a clinical issue into an Enfermería/TENS warning', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        hasPersistedSync: true,
        persistedSync: {
          status: 'partial',
          coverage: {
            total: 8,
            completed: 7,
            errors: 1,
            sourceErrors: 1,
            completedAt: '2026-07-27T18:00:00.000Z',
          },
          staffingObservation: { ambiguousSections: [], ignoredBoundaryRecords: 0 },
        },
      })
    );

    expect(model.label).toBe('Última sincronización con observaciones');
    expect(model.label).not.toContain('Enfermería/TENS');
  });

  it('treats handoff-boundary traceability alone as a successful synchronization', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        hasPersistedSync: true,
        persistedSync: {
          status: 'complete',
          coverage: {
            total: 12,
            completed: 12,
            errors: 0,
            sourceErrors: 0,
            completedAt: '2026-07-27T18:00:00.000Z',
          },
          staffingObservation: { ambiguousSections: [], ignoredBoundaryRecords: 8 },
        },
      })
    );

    expect(model).toMatchObject({
      phase: 'complete',
      tone: 'success',
      label: 'Todo al día',
      visuallyHidden: true,
    });
  });
});
