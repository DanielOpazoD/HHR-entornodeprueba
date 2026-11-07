import { describe, expect, it } from 'vitest';
import { classifyRayenWriteCause } from '@/features/rayen-import/observability/rayenSyncDiagnostics';
import { RayenSyncEventSchema } from '@/schemas/zod/dailyRecord';

// The messages thrown by the guards that refuse a clinical batch before it reaches the server.
const REFUSALS: Array<[string, string]> = [
  ['Un campo clínico cambió mientras se preparaba el lote.', 'batch_field_changed'],
  ['El episodio clínico cambió durante la persistencia del lote.', 'batch_episode_changed'],
  ['El lote clínico mezcla episodios distintos para una misma cama.', 'batch_bed_mixed'],
  [
    'El lote clínico excede una transacción atómica segura; los datos quedaron pendientes.',
    'batch_too_large',
  ],
  ['Una actualización clínica excede por sí sola el límite transaccional.', 'batch_too_large'],
  ['El CUDYR ya fue registrado durante la recuperación mensual.', 'batch_cudyr_changed'],
  ['El censo CUDYR está protegido.', 'batch_cudyr_changed'],
  [
    'La evidencia mensual no identifica inequívocamente este episodio y turno.',
    'batch_cudyr_changed',
  ],
  ['La sesión cambió.', 'session_changed'],
];

describe('a clinical batch refused before reaching the server says which guard refused it', () => {
  it.each(REFUSALS)('«%s» → %s', (message, cause) => {
    expect(classifyRayenWriteCause(new Error(message))).toBe(cause);
  });

  it('keeps the network, server and unknown causes it had', () => {
    expect(classifyRayenWriteCause(new TypeError('Failed to fetch'))).toBe('source_unavailable');
    expect(classifyRayenWriteCause(new Error('deadline exceeded'))).toBe('source_timeout');
    expect(classifyRayenWriteCause(new Error('algo distinto'))).toBe('unexpected');
  });

  it('survives a reread of the synchronization history', () => {
    const issue = { bedId: 'R1', source: 'patch', reason: 'write_failed' };
    const parsed = RayenSyncEventSchema.safeParse({
      id: 'run-synthetic',
      by: 'synthetic',
      startedAt: '2026-11-07T06:38:14.739Z',
      status: 'partial',
      coverage: {
        total: 9,
        completed: 0,
        errors: 9,
        sourceErrors: 9,
        completedAt: '2026-11-07T06:39:11.063Z',
        issues: REFUSALS.map(([, cause]) => ({ ...issue, cause })),
      },
    });
    expect(parsed.success && parsed.data.coverage?.issues?.map(item => item.cause)).toEqual(
      REFUSALS.map(([, cause]) => cause)
    );
  });
});
