import { describe, expect, it } from 'vitest';

import { buildAppliedRayenSyncEvent } from '@/features/rayen-import/domain/rayenSyncHistory';
import type { RayenSyncRun } from '@/features/rayen-import/domain/rayenSyncHistory';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import { RayenSyncEventSchema } from '@/schemas/zod/dailyRecord';
import { safeParseDailyRecord } from '@/schemas/zodSchemas';

/**
 * Contrato del requisito de revisión propio del intento.
 *
 * El riesgo que cubre este archivo ya ocurrió antes con `failureReason`: un campo que existía
 * para TypeScript pero no para Zod hacía fallar el parse del evento y la ruta de reparación
 * descartaba el historial completo. Un requisito de revisión que se pierda al persistir deja la
 * auditoría afirmando «política automática» sobre una corrida que sí pasó por revisión humana.
 */

const diff = {
  admissions: [{ bedId: 'R1' }],
  updates: [],
  moves: [],
  discharges: [],
  conflicts: [],
  pendingAdministrativeDischarges: [],
  unchangedCount: 0,
  summary: {
    admissions: 1,
    updates: 0,
    moves: 0,
    discharges: 0,
    conflicts: 0,
    unchanged: 0,
    pendingAdministrativeDischarges: 0,
  },
} as unknown as CensusImportDiff;

const bootstrapRun: RayenSyncRun = {
  id: 'run-bootstrap',
  sourceDate: '2026-09-09',
  startedAt: '2026-09-09T10:00:00.000Z',
  by: 'Operador HHR',
  policy: { mode: 'auto', clinicalBatchMode: 'enforced', revision: 3 },
  reviewRequirement: 'day_bootstrap',
};

describe('requisito de revisión por inicio del día · dominio ↔ esquema', () => {
  it('conserva el requisito junto a la política realmente vigente', () => {
    const event = buildAppliedRayenSyncEvent(bootstrapRun, diff, '2026-09-09T10:01:00.000Z');

    expect(event.reviewRequirement).toBe('day_bootstrap');
    // La política global no se falsea: siguió siendo automática durante la corrida.
    expect(event.policy?.mode).toBe('auto');
  });

  it('no inventa un requisito cuando la política global gobernó sola', () => {
    const { reviewRequirement, ...normalRun } = bootstrapRun;
    void reviewRequirement;

    const event = buildAppliedRayenSyncEvent(normalRun, diff, '2026-09-09T10:01:00.000Z');

    expect(event.reviewRequirement).toBeUndefined();
  });

  it('el esquema del evento acepta y preserva el requisito', () => {
    const parsed = RayenSyncEventSchema.safeParse({
      id: 'run-bootstrap',
      sourceDate: '2026-09-09',
      startedAt: '2026-09-09T10:00:00.000Z',
      completedAt: '2026-09-09T10:01:00.000Z',
      by: 'Operador HHR',
      status: 'applied',
      policy: { mode: 'auto', clinicalBatchMode: 'enforced', revision: 3 },
      reviewRequirement: 'day_bootstrap',
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reviewRequirement).toBe('day_bootstrap');
  });

  it('un requisito desconocido no descarta el evento ni el historial', () => {
    const parsed = safeParseDailyRecord({
      date: '2026-09-09',
      beds: {},
      rayenSyncHistory: [
        {
          id: 'run-future',
          sourceDate: '2026-09-09',
          startedAt: '2026-09-09T10:00:00.000Z',
          completedAt: '2026-09-09T10:01:00.000Z',
          by: 'Operador HHR',
          status: 'applied',
          reviewRequirement: 'requisito_de_una_version_mas_nueva',
        },
      ],
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.rayenSyncHistory).toHaveLength(1);
    expect(parsed?.rayenSyncHistory?.[0]?.reviewRequirement).toBeUndefined();
    expect(parsed?.rayenSyncHistory?.[0]?.status).toBe('applied');
  });
});
