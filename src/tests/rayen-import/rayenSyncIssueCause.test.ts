import { describe, expect, it } from 'vitest';
import { buildRayenSyncCoverage } from '@/features/rayen-import/domain/rayenSyncHistory';
import { RayenSyncMetaSchema } from '@/schemas/zod/dailyRecord';
import type { ClinicalFillError } from '@/features/rayen-import/contracts/clinicalFillContracts';

const failure = (message: string, reason: ClinicalFillError['reason'] = 'source_unavailable') =>
  ({
    bedId: 'R1',
    clinicalEpisodeId: 'E1',
    source: 'scales',
    reason,
    message,
  }) as ClinicalFillError;

const causeOf = (error: ClinicalFillError) =>
  buildRayenSyncCoverage(1, [error], '2026-10-31T23:00:00.000Z').issues?.[0].cause;

describe('the sync history explains why a source could not be read', () => {
  it.each([
    [
      'Las escalas no fueron autorizadas para el episodio de esta pestaña.',
      'episode_not_authorized',
    ],
    ['Sin token de Ficha Médico: inicia sesión.', 'session_required'],
    ['No se pudo consultar el informe (HTTP 403).', 'permission_denied'],
    ['El archivo excedió el tiempo de lectura.', 'source_timeout'],
    ['La extensión no respondió. Actualícela o conecte Gestión de Camas.', 'source_timeout'],
    ['Error interno 503 de la paciente sintética', 'source_unavailable'],
  ])('classifies "%s" as %s and does not keep the message', (message, cause) => {
    const error = failure(message);
    expect(causeOf(error)).toBe(cause);
    expect(
      JSON.stringify(buildRayenSyncCoverage(1, [error], '2026-10-31T23:00:00.000Z'))
    ).not.toContain(message);
  });

  it('leaves out the cause when the failure was not reading a source', () => {
    expect(causeOf(failure('Otro escritor cambió el censo.', 'concurrent_write'))).toBeUndefined();
  });

  it('keeps a known cause when the history is read back and tolerates an unknown one', () => {
    const coverage = buildRayenSyncCoverage(1, [failure('Sin token')], '2026-10-31T23:00:00.000Z');
    const read = (cause: unknown) =>
      RayenSyncMetaSchema.parse({
        at: '2026-10-31T23:00:00.000Z',
        by: 'sintetico',
        coverage: { ...coverage, issues: coverage.issues?.map(issue => ({ ...issue, cause })) },
      }).coverage?.issues?.[0];
    expect(read('session_required')?.cause).toBe('session_required');
    const unknown = read('causa_de_una_version_futura');
    expect(unknown?.cause).toBeUndefined();
    expect(unknown?.reason).toBe('source_unavailable');
  });
});
