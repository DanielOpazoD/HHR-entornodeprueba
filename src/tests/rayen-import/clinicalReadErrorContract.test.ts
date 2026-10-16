import { describe, expect, it, vi } from 'vitest';
import { decodeClinicalReadFailure } from '@/features/rayen-import/contracts/clinicalReadError';
import { mapScalesFormsPayload } from '@/features/rayen-import/bridge/patientClinicalBundleChannel';
import { createClinicalFormsAuthorizationRecovery } from '@/features/rayen-import/domain/clinicalFormsAuthorizationRecovery';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';
import type { ClinicalFillCandidate } from '@/features/rayen-import/domain/clinicalFillCandidates';

const legacyDenied = 'Las escalas no fueron autorizadas para el episodio de esta pestaña.';
const candidate = {
  bedId: 'R1',
  clinicalCrib: false,
  patient: { patientName: 'Paciente sintético', rut: '12.345.678-5', clinicalEpisodeId: '142040' },
} as ClinicalFillCandidate;

const recovery = () => {
  const deps = {
    readForms: vi.fn(async () => ({ forms: [] })),
    refreshSnapshot: vi.fn(
      async () =>
        ({ encounters: [{ encounterId: '142040', run: '12345678-5' }] }) as RayenCensusSnapshot
    ),
    verifyEpisode: vi.fn(async () => []),
  };
  const reader = createClinicalFormsAuthorizationRecovery(
    [candidate],
    new AbortController().signal,
    {
      ...deps,
    }
  );
  return { reader, deps };
};

describe('clinical read error wire compatibility', () => {
  it.each([
    ['episode_not_authorized', 'Mensaje actualizado'],
    [undefined, legacyDenied],
  ] as const)('renews verified episode for new and legacy denial: %s', async (errorCode, error) => {
    const { reader, deps } = recovery();
    reader.observe('142040', { forms: [], error, errorCode });
    await reader.readForms('142040');
    expect(deps.refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.readForms).toHaveBeenCalledTimes(1);
  });
  it.each(['permission_denied', 'session_required', 'future_code', null, 42])(
    'never interprets an explicit non-authorization code through its message: %s',
    async code => {
      const { reader, deps } = recovery();
      reader.observe(
        '142040',
        mapScalesFormsPayload({ forms: [], error: legacyDenied, errorCode: code })
      );
      await reader.readForms('142040');
      expect(deps.refreshSnapshot).not.toHaveBeenCalled();
      expect(deps.verifyEpisode).not.toHaveBeenCalled();
    }
  );
  it('preserves successful empty forms and rejects a code-only failure', () => {
    expect(mapScalesFormsPayload({ forms: [] })).toEqual({ forms: [] });
    expect(mapScalesFormsPayload({ forms: [], errorCode: 'session_required' })).toMatchObject({
      errorCode: 'session_required',
      error: expect.any(String),
    });
  });
  it('classifies malformed source data separately from a valid empty response', () => {
    expect(mapScalesFormsPayload({ forms: {} })).toMatchObject({ errorCode: 'invalid_response' });
  });
  it('treats unknown codes as failures without falling back to a legacy authorization phrase', () => {
    expect(decodeClinicalReadFailure({ error: legacyDenied, errorCode: 'future_code' })).toEqual({
      error: legacyDenied,
      errorCode: 'unexpected',
    });
  });
});
