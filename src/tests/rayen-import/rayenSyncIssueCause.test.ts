import { describe, expect, it } from 'vitest';
import { buildRayenSyncCoverage } from '@/features/rayen-import/domain/rayenSyncHistory';
import { RayenSyncMetaSchema } from '@/schemas/zod/dailyRecord';
import type { ClinicalFillError } from '@/features/rayen-import/contracts/clinicalFillContracts';
import type { DailyRecord } from '@/types/domain/dailyRecord';

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

  it('names a patient discharged today by exact episode, not as an old unidentified attempt', () => {
    const record = {
      date: '2026-11-01',
      beds: {},
      discharges: [
        {
          id: 'alta',
          bedId: 'R2',
          patientName: 'Paciente Sintética',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'E1',
        },
      ],
    } as unknown as DailyRecord;
    const error = { ...failure('Fuente no disponible'), bedId: '*' };
    const issue = buildRayenSyncCoverage(1, [error], '2026-11-01T18:50:00.000Z', record)
      .issues?.[0];
    expect(issue?.diagnostic).toMatchObject({
      patientName: 'Paciente Sintética',
      document: '11.111.111-1',
      bedId: 'R2',
      clinicalEpisodeId: 'E1',
    });
  });

  it('does not borrow the identity of a deleted movement', () => {
    const record = {
      date: '2026-11-01',
      beds: {},
      discharges: [
        {
          id: 'alta',
          bedId: 'R2',
          patientName: 'Paciente Sintética',
          rut: '11.111.111-1',
          clinicalEpisodeId: 'E1',
          deletedAt: '2026-11-01T12:00:00.000Z',
        },
      ],
    } as unknown as DailyRecord;
    const error = { ...failure('Fuente no disponible'), bedId: '*' };
    const issue = buildRayenSyncCoverage(1, [error], '2026-11-01T18:50:00.000Z', record)
      .issues?.[0];
    expect(issue?.diagnostic?.patientName).toBeUndefined();
  });
});
