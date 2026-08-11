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
    ['preparing_context', 'Preparando el contexto del censo · 07-08-2026', true],
    ['capturing', 'Leyendo información de Eloísa · 07-08-2026', true],
    ['planning_structure', 'Conciliando el censo · 07-08-2026', true],
    ['persisting_structure', 'Guardando cambios del censo · 07-08-2026', true],
    ['verifying_structure', 'Confirmando el censo guardado · 07-08-2026', true],
    ['complete', 'Todo al día · 07-08-2026', false],
  ] as const)('uses the execution stage %s as the canonical status', (type, label, ariaBusy) => {
    const model = buildRayenSyncBarViewModel(
      input({
        executionStage: { type },
        targetDate: '2026-08-07',
        error: type === 'complete' ? 'stale legacy error' : null,
      })
    );

    expect(model).toMatchObject({ label, ariaBusy });
  });

  it('keeps the selected historical date visible while awaiting review', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        executionStage: { type: 'awaiting_review' },
        targetDate: '2026-08-01',
        diff: oneChangeDiff,
      })
    );

    expect(model).toMatchObject({
      phase: 'review',
      label: '1 cambio listo para revisar · 01-08-2026',
    });
  });

  it('uses an idle state when no contextual execution or persisted result exists', () => {
    expect(buildRayenSyncBarViewModel(input())).toMatchObject({
      phase: 'idle',
      label: 'Listo para sincronizar',
    });
  });

  it.each(['pending', 'ambiguous', 'declined'] as const)(
    'keeps a complete clinical sync green when staffing is %s',
    staffingOutcome => {
      const model = buildRayenSyncBarViewModel(
        input({
          executionStage: { type: 'complete' },
          fill: fill({ outcome: 'complete', staffingOutcome }),
        })
      );

      expect(model).toMatchObject({
        phase: 'complete',
        tone: 'success',
        label: 'Todo al día',
      });
    }
  );

  it('does not degrade persisted clinical success because staffing evidence is ambiguous', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        hasPersistedSync: true,
        persistedSync: {
          status: 'complete',
          coverage: {
            total: 15,
            completed: 15,
            errors: 0,
            sourceErrors: 0,
            completedAt: '2026-08-08T05:00:00.000Z',
          },
          staffingObservation: {
            ambiguousSections: ['nurse_day'],
            ignoredBoundaryRecords: 1,
          },
        },
      })
    );

    expect(model).toMatchObject({ phase: 'complete', tone: 'success', label: 'Todo al día' });
  });

  it('uses the real clinical patient counter instead of an inferred percentage', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        executionStage: { type: 'syncing_clinical' },
        fill: fill({ running: true, outcome: 'running', done: 4, total: 8 }),
      })
    );

    expect(model.label).toBe('Datos clínicos · 4 de 8 pacientes');
    expect(model.progress).toEqual({ kind: 'determinate', done: 4, total: 8 });
    expect(model.ariaBusy).toBe(true);
  });

  it('keeps a shared clinical fill visible after the contextual view remounts', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        fill: fill({ running: true, outcome: 'running', done: 2, total: 5 }),
        targetDate: '2026-08-07',
      })
    );

    expect(model).toMatchObject({
      phase: 'clinical',
      label: 'Datos clínicos · 2 de 5 pacientes · 07-08-2026',
      progress: { kind: 'determinate', done: 2, total: 5 },
      ariaBusy: true,
    });
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
      input({
        executionStage: { type: 'awaiting_review' },
        diff: pendingAdministrativeDischargeDiff,
      })
    );

    expect(model).toMatchObject({
      phase: 'review',
      label: '1 cambio listo para revisar',
    });
  });

  it('keeps clinical progress canonical even when the legacy attempt result was rejected', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        executionStage: { type: 'syncing_clinical' },
        fill: fill({ running: true, outcome: 'rejected', done: 3, total: 8 }),
      })
    );

    expect(model).toMatchObject({
      phase: 'clinical',
      label: 'Datos clínicos · 3 de 8 pacientes',
      progress: { kind: 'determinate', done: 3, total: 8 },
      ariaBusy: true,
    });
  });

  it('shows completion from the contextual terminal state', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        executionStage: { type: 'complete' },
        fill: fill({ outcome: 'complete', done: 8, total: 8 }),
      })
    );

    expect(model).toMatchObject({
      phase: 'complete',
      label: 'Todo al día',
      visuallyHidden: false,
    });
  });

  it('presents a contextual partial result even if the legacy fill says complete', () => {
    const model = buildRayenSyncBarViewModel(
      input({
        executionStage: { type: 'partial', retry: 'clinical_only' },
        fill: fill({ outcome: 'complete', done: 7, total: 8, errors: 1 }),
      })
    );

    expect(model).toMatchObject({
      phase: 'action',
      tone: 'warning',
      label: 'Información clínica pendiente de completar',
      visuallyHidden: false,
    });
  });

  it('keeps the exact error as one expandable detail', () => {
    const model = buildRayenSyncBarViewModel(
      input({ executionStage: { type: 'failed' }, error: 'La captura agotó el tiempo.' })
    );

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
