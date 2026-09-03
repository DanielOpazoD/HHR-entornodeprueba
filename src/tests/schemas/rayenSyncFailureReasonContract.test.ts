import { describe, expect, it } from 'vitest';

import {
  hasStructuralRepairs,
  parseDailyRecordWithDefaultsReport,
  safeParseDailyRecord,
} from '@/schemas/zodSchemas';
import { RayenSyncEventSchema } from '@/schemas/zod/dailyRecord';
import { RAYEN_SYNC_FAILURE_REASONS, type RayenSyncEvent } from '@/types/domain/rayenSync';

/**
 * Contrato entre el tipo de dominio y el esquema Zod del historial de
 * sincronización. El 02-09 se vio que `apply_unauthorized` y
 * `apply_conflict` (#294) existían para TypeScript pero no para Zod: un
 * registro con esa causa fallaba el parse completo y la ruta de reparación
 * descartaba TODO el historial (y la siguiente corrida lo reescribía con un
 * solo evento).
 */

const failedEvent = (failureReason: string): Record<string, unknown> => ({
  id: `run-${failureReason}`,
  sourceDate: '2026-09-01',
  startedAt: '2026-09-01T10:00:00.000Z',
  completedAt: '2026-09-01T10:00:05.000Z',
  by: 'Operador',
  status: 'failed',
  failureReason,
});

const recordWith = (events: Record<string, unknown>[]): Record<string, unknown> => ({
  date: '2026-09-01',
  beds: {},
  rayenSyncHistory: events,
});

describe('causas de fallo de sincronización · contrato tipo ↔ esquema', () => {
  it('cada causa del dominio es aceptada por el esquema del evento', () => {
    RAYEN_SYNC_FAILURE_REASONS.forEach(reason => {
      const parsed = RayenSyncEventSchema.safeParse(failedEvent(reason));
      expect(parsed.success, reason).toBe(true);
      expect((parsed.success && parsed.data.failureReason) || null).toBe(reason);
    });
  });

  it('un registro con cualquier causa conserva su historial completo en el parse estricto', () => {
    const record = recordWith(RAYEN_SYNC_FAILURE_REASONS.map(failedEvent));
    const parsed = safeParseDailyRecord(record);

    expect(parsed).not.toBeNull();
    expect(parsed?.rayenSyncHistory?.map(event => event.failureReason)).toEqual([
      ...RAYEN_SYNC_FAILURE_REASONS,
    ]);
  });

  it('una causa desconocida (cliente más nuevo) no invalida el registro: el evento sobrevive sin causa', () => {
    const record = recordWith([failedEvent('apply_unauthorized'), failedEvent('causa_futura')]);
    const parsed = safeParseDailyRecord(record);

    expect(parsed).not.toBeNull();
    const history = parsed?.rayenSyncHistory as RayenSyncEvent[];
    expect(history).toHaveLength(2);
    expect(history[0].failureReason).toBe('apply_unauthorized');
    expect(history[1].failureReason).toBeUndefined();
    expect(history[1].status).toBe('failed');
  });

  it('la ruta de reparación salva el historial y la proyección de sincronización en vez de descartarlos', () => {
    const parsed = parseDailyRecordWithDefaultsReport(
      {
        ...recordWith([failedEvent('snapshot_error'), { id: 'roto' }]),
        rayenSync: { at: '2026-09-01T10:00:00.000Z', by: 'Operador' },
        // Una cama corrupta obliga a la ruta de reparación del registro entero.
        beds: { R1: { patientName: 'Legacy', status: 'ESTADO_INVALIDO' } },
      },
      '2026-09-01'
    );

    expect(hasStructuralRepairs(parsed.report)).toBe(true);
    expect(parsed.report.droppedRayenSyncEvents).toBe(1);
    expect(parsed.record.rayenSyncHistory?.map(event => event.id)).toEqual(['run-snapshot_error']);
    expect(parsed.record.rayenSync).toEqual({ at: '2026-09-01T10:00:00.000Z', by: 'Operador' });
  });

  it('un motivo estructural desconocido no invalida el evento: se degrada a «unclassified» (#307)', () => {
    // `unverified-report-row` se persiste cuando la fila ambigua del informe de GC
    // conserva la revisión; un cliente rezagado durante el despliegue no debe
    // perder el historial por un motivo que aún no conoce.
    const event = {
      ...failedEvent('apply_conflict'),
      structuralReview: {
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 4,
        issues: [
          { bedId: 'H5C1', reason: 'unverified-report-row' },
          { bedId: 'H4C1', reason: 'episode-less-report-row' },
          { bedId: 'H4C2', reason: 'report-predates-admission' },
          { bedId: 'H5C2', reason: 'motivo_futuro' },
        ],
      },
    };
    const parsed = RayenSyncEventSchema.safeParse(event);

    expect(parsed.success).toBe(true);
    expect(
      parsed.success ? parsed.data.structuralReview?.issues?.map(issue => issue.reason) : null
    ).toEqual([
      'unverified-report-row',
      'episode-less-report-row',
      'report-predates-admission',
      'unclassified',
    ]);
  });
});
