// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';

type AuthorizationFactory = {
  create: (dependencies: Record<string, unknown>) => {
    authorize: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
};

let authorizationFactory: AuthorizationFactory;
let normalizePatientRutBody: (value: unknown) => string;

beforeAll(async () => {
  await import('../../../extension/lab-viewer.js');
  await import('../../../extension/syslab-encounter-authorization.js');
  const extensionGlobals = globalThis as typeof globalThis & {
    HhrSyslabEncounterAuthorization: AuthorizationFactory;
    HhrLabViewer: { normalizePatientRutBody: (value: unknown) => string };
  };
  authorizationFactory = extensionGlobals.HhrSyslabEncounterAuthorization;
  normalizePatientRutBody = extensionGlobals.HhrLabViewer.normalizePatientRutBody;
});

const buildAuthorization = (activeEncounterIds: string[] = []) =>
  authorizationFactory.create({
    getFichaFetchInfo: vi.fn(async () => ({ info: { token: 'session' } })),
    fichaSessionCacheKey: vi.fn(async () => 'session-key'),
    fetchActiveEncounterRows: vi.fn(async () => ({
      rows: activeEncounterIds.map(id => ({ id })),
    })),
    resolveFichaEncounterId: vi.fn(() => ''),
    normalizePatientRutBody,
  });

describe('Syslab encounter authorization', () => {
  it('authorizes an encounter present in the active Eloísa census', async () => {
    const authorization = buildAuthorization(['141814']);

    await expect(
      authorization.authorize({
        encId: '141814',
        sender: { tab: { url: 'http://localhost:3000' } },
      })
    ).resolves.toEqual({ ok: true });
  });

  it('accepts a trusted HHR selection when Eloísa confirms the encounter RUN', async () => {
    const authorization = buildAuthorization();

    await expect(
      authorization.authorize({
        encId: '141814',
        patientRut: '285551498',
        resolvedPatientRut: '28.555.149-8',
        sender: { tab: { url: 'http://localhost:3000/' } },
      })
    ).resolves.toEqual({ ok: true, verifiedBy: 'patient-identity' });
  });

  it('rejects the fallback for an untrusted origin or a different RUN', async () => {
    const authorization = buildAuthorization();

    await expect(
      authorization.authorize({
        encId: '141814',
        patientRut: '285551498',
        resolvedPatientRut: '11.111.111-1',
        sender: { tab: { url: 'http://localhost:3000/' } },
      })
    ).resolves.toHaveProperty('error');
    await expect(
      authorization.authorize({
        encId: '141814',
        patientRut: '285551498',
        resolvedPatientRut: '28.555.149-8',
        sender: { tab: { url: 'http://localhost:4000/' } },
      })
    ).resolves.toHaveProperty('error');
  });

  it('preserves the verifier boundary for a seven-digit RUT body', async () => {
    const authorization = buildAuthorization();

    await expect(
      authorization.authorize({
        encId: '141814',
        patientRut: '9.123.456-7',
        resolvedPatientRut: '9.123.456-7',
        sender: { tab: { url: 'https://testinghhr.netlify.app/' } },
      })
    ).resolves.toEqual({ ok: true, verifiedBy: 'patient-identity' });
  });

  it('rejects a malformed encounter before the trusted HHR fallback', async () => {
    const authorization = buildAuthorization();

    await expect(
      authorization.authorize({
        encId: 'not-an-encounter',
        patientRut: '28.555.149-8',
        resolvedPatientRut: '28.555.149-8',
        sender: { tab: { url: 'http://localhost:3000/' } },
      })
    ).resolves.toEqual({ error: 'El episodio clínico no es válido.' });
  });
});
