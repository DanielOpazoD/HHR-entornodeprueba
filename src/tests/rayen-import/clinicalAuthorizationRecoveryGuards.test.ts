import { describe, expect, it, vi } from 'vitest';
import type { PatientData } from '@/types/domain/patient';
import { createClinicalFormsAuthorizationRecovery } from '@/features/rayen-import/domain/clinicalFormsAuthorizationRecovery';
import type { ClinicalFillCandidate } from '@/features/rayen-import/domain/clinicalFillCandidates';
import type { RayenCensusSnapshot } from '@/features/rayen-import/contracts/rayenSnapshot';

const denial = {
  forms: [],
  error: 'Las escalas no fueron autorizadas para el episodio de esta pestaña.',
};
const patient = (patch: Partial<PatientData> = {}): ClinicalFillCandidate => ({
  bedId: 'R1',
  clinicalCrib: false,
  patient: {
    patientName: 'Paciente sintético',
    rut: '12.345.678-5',
    clinicalEpisodeId: '142040',
    ...patch,
  } as PatientData,
});
const verified = () => [{ run: '123456785', encounterId: '142040', egreso: { id: '142040' } }];
const setup = (candidates: ClinicalFillCandidate[] = [patient()]) => {
  const controller = new AbortController();
  const readForms = vi.fn(async () => ({ forms: [{ synthetic: true }] }));
  const verifyEpisode = vi.fn(async () => verified());
  const recovery = createClinicalFormsAuthorizationRecovery(candidates, controller.signal, {
    readForms,
    verifyEpisode,
  });
  recovery.observe('142040', denial);
  return { ...recovery, controller, readSource: readForms, verifyEpisode };
};

describe('clinical authorization recovery guards', () => {
  it.each(['E9876543', '9876543'])(
    'renews a known passport %s only through an exact live source episode and identifier',
    async run => {
      const refreshSnapshot = vi.fn(
        async () => ({ encounters: [{ encounterId: '142040', run }] }) as RayenCensusSnapshot
      );
      const readForms = vi.fn(async () => ({ forms: [{ synthetic: true }] }));
      const verifyEpisode = vi.fn();
      const recovery = createClinicalFormsAuthorizationRecovery(
        [patient({ rut: run, documentType: 'Pasaporte' })],
        new AbortController().signal,
        { readForms, verifyEpisode, refreshSnapshot }
      );
      recovery.observe('142040', denial);
      expect(await recovery.readForms('142040')).toEqual({ forms: [{ synthetic: true }] });
      expect(refreshSnapshot).toHaveBeenCalledTimes(1);
      expect(verifyEpisode).not.toHaveBeenCalled();
      expect(readForms).toHaveBeenCalledTimes(1);
    }
  );

  it.each(
    [
      [],
      [{ encounterId: '142040', run: 'F9876543' }],
      [{ encounterId: '142040', run: '9876543' }],
      [{ encounterId: '999999', run: 'E9876543' }],
      [
        { encounterId: '142040', run: 'E9876543' },
        { encounterId: '142040', run: 'E9876543' },
      ],
    ].map(encounters => ({ encounters }))
  )(
    'does not fall back to a RUN lookup for an absent or contradictory passport snapshot $encounters',
    async ({ encounters }) => {
      const refreshSnapshot = vi.fn(async () => ({ encounters }) as RayenCensusSnapshot);
      const readForms = vi.fn();
      const verifyEpisode = vi.fn();
      const recovery = createClinicalFormsAuthorizationRecovery(
        [patient({ rut: 'E9876543', documentType: 'Pasaporte' })],
        new AbortController().signal,
        { readForms, verifyEpisode, refreshSnapshot }
      );
      recovery.observe('142040', denial);
      expect(await recovery.readForms('142040')).toEqual(denial);
      expect(readForms).not.toHaveBeenCalled();
      expect(verifyEpisode).not.toHaveBeenCalled();
    }
  );

  it('shares one fresh capture across different denied episodes', async () => {
    const refreshSnapshot = vi.fn(
      async () =>
        ({
          encounters: [
            { encounterId: '142040', run: '123456785' },
            { encounterId: '142041', run: '111111111' },
          ],
        }) as RayenCensusSnapshot
    );
    const readForms = vi.fn(async () => ({ forms: [] }));
    const verifyEpisode = vi.fn();
    const recovery = createClinicalFormsAuthorizationRecovery(
      [patient(), patient({ clinicalEpisodeId: '142041', rut: '11.111.111-1' })],
      new AbortController().signal,
      { readForms, verifyEpisode, refreshSnapshot }
    );
    for (const id of ['142040', '142041']) recovery.observe(id, denial);
    await Promise.all(['142040', '142041'].map(id => recovery.readForms(id)));
    expect(refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(verifyEpisode).not.toHaveBeenCalled();
    expect(readForms).toHaveBeenCalledTimes(2);
  });

  it.each(['111111111', 'A123456785', '123A456785'])(
    'rejects contradictory or non-RUN source identity %s',
    async run => {
      const refreshSnapshot = vi.fn(
        async () => ({ encounters: [{ encounterId: '142040', run }] }) as RayenCensusSnapshot
      );
      const readForms = vi.fn();
      const verifyEpisode = vi.fn();
      const recovery = createClinicalFormsAuthorizationRecovery(
        [patient()],
        new AbortController().signal,
        { readForms, verifyEpisode, refreshSnapshot }
      );
      recovery.observe('142040', denial);
      expect(await recovery.readForms('142040')).toEqual(denial);
      expect(readForms).not.toHaveBeenCalled();
      expect(verifyEpisode).not.toHaveBeenCalled();
    }
  );

  it.each([
    [],
    [patient(), patient()],
    [patient({ clinicalEpisodeId: '999999' })],
    [patient({ rut: 'A123456785' })],
    [patient({ rut: '123A456785' })],
    [patient({ documentType: 'Pasaporte' })],
    [patient({ rut: '12.345.678-9' })],
    [patient({ identityStatus: 'provisional' })],
  ])('does not verify an unknown, ambiguous or invalid document', async (...candidates) => {
    const api = setup(candidates);
    expect(await api.readForms('142040')).toEqual(denial);
    expect(api.verifyEpisode).not.toHaveBeenCalled();
    expect(api.readSource).not.toHaveBeenCalled();
  });

  it.each([
    [{ run: '123456785', encounterId: '999999', egreso: { id: '999999' } }],
    [{ run: '111111111', encounterId: '142040', egreso: { id: '142040' } }],
    [{ run: '123456785', encounterId: '142040', egreso: { id: '999999' } }],
    [{ run: '123456785', encounterId: '142040', egreso: { id: '142040' }, error: 'Sin sesión' }],
  ])('preserves the denied source after a mismatching exact response', async (...results) => {
    const api = setup();
    api.verifyEpisode.mockResolvedValue(results);
    expect(await api.readForms('142040')).toEqual(denial);
    expect(api.readSource).not.toHaveBeenCalled();
  });

  it('coalesces renewal and does not infer a maternal identity from a bed', async () => {
    const api = setup();
    await Promise.all([api.readForms('142040'), api.readForms('142040')]);
    expect(api.verifyEpisode).toHaveBeenCalledTimes(1);
    expect(api.verifyEpisode).toHaveBeenCalledWith([
      { run: '12.345.678-5', encounterId: '142040' },
    ]);
  });

  it('uses an explicitly stored maternal RUN only to look up the exact RN episode', async () => {
    const api = setup([
      patient({ rut: '', identityStatus: 'provisional', neonatalMaternalRut: '12.345.678-5' }),
    ]);
    expect(await api.readForms('142040')).toEqual({ forms: [{ synthetic: true }] });
    expect(api.verifyEpisode).toHaveBeenCalledWith([
      { run: '12.345.678-5', encounterId: '142040' },
    ]);
  });

  it('does not renew ordinary source errors or expand the existing forms retry count', async () => {
    const api = setup();
    api.readSource.mockResolvedValue({ forms: [] });
    api.observe('999999', { forms: [], error: 'HTTP 403' });
    await api.readForms('999999');
    expect(api.verifyEpisode).not.toHaveBeenCalled();
  });

  it('does not start verification after cancellation', async () => {
    const api = setup();
    api.controller.abort();
    await expect(api.readForms('142040')).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.verifyEpisode).not.toHaveBeenCalled();
  });

  it('does not read after cancellation during verification', async () => {
    const api = setup();
    api.verifyEpisode.mockImplementation(async () => {
      api.controller.abort();
      return verified();
    });
    await expect(api.readForms('142040')).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.readSource).not.toHaveBeenCalled();
  });
});
