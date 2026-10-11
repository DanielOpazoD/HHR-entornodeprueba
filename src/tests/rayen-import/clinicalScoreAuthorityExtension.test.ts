// @vitest-environment node
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import {
  loadFactory,
  createDependencies,
  sender,
  sessionIdentity,
} from './clinicalScoreRuntimeExtension.fixture';
import {
  loadOwner,
  createDependencies as createWriteDependencies,
  backgroundSource,
  cudyrAnswers,
} from './clinicalScoreWriteRuntimeExtension.fixture';

describe('Scores tab and clinical identity authority', () => {
  it.each([
    { identityVerified: false, practitionerId: '77', practitionerRoleId: '88' },
    { identityVerified: true, practitionerId: '', practitionerRoleId: '88' },
    { identityVerified: true, practitionerId: '77', practitionerRoleId: 'bad' },
  ])('rejects unverified or incomplete identity before opening a batch: %j', async info => {
    const dependencies = createDependencies({ getFichaFetchInfo: vi.fn(async () => ({ info })) });
    const result = await loadFactory().create(dependencies).handleOptionsRequest({ sender });
    expect(result.error).toContain('verificar una sesión');
    expect(dependencies.fetchFichaClaims).not.toHaveBeenCalled();
    expect(dependencies.chrome.storage.session.set).not.toHaveBeenCalled();
  });

  it.each([
    ['practitionerId', '78'],
    ['practitionerRoleId', '89'],
    ['facId', '1343'],
    ['apiOrigin', 'https://other.example.invalid'],
    ['token', 'renewed-synthetic-token'],
  ])(
    'binds the actual options batch and revalidates %s before form access',
    async (field, value) => {
      const info = {
        apiOrigin: 'https://example.invalid',
        facId: '1342',
        practitionerId: '77',
        practitionerRoleId: '88',
        identityVerified: true,
        role: 'Enfermera',
        token: 'synthetic-token',
      };
      let liveInfo = info;
      const stored: Record<string, unknown> = {};
      const getFichaFetchInfo = vi.fn(async () => ({ info: liveInfo }));
      const dependencies = createDependencies({
        chrome: {
          storage: {
            session: {
              set: vi.fn(async (values: Record<string, unknown>) => {
                Object.assign(stored, values);
              }),
              get: vi.fn(async () => stored),
            },
          },
        },
        getFichaFetchInfo,
        hasFichaClaim: vi.fn(() => true),
        fetchActiveHospitalizedPatients: vi.fn(async () => ({
          patients: [{ encounterId: '901' }],
        })),
      });
      const runtime = loadFactory().create(dependencies);
      const options = await runtime.handleOptionsRequest({ currentEncId: '901', sender });
      expect(options.ok).toBe(true);
      const batchId = String(options.batchId);
      expect(stored[`hhr-scores-batch-${batchId}`]).toMatchObject({
        senderTabId: 5,
        sessionIdentity: sessionIdentity(info),
      });
      expect(JSON.stringify(stored)).not.toContain('synthetic-token');
      liveInfo = { ...info, [field]: value };
      const result = await runtime.handleFormRequest({
        batchId,
        encId: '901',
        instrument: 'BRADEN',
        sender,
      });
      expect(getFichaFetchInfo).toHaveBeenLastCalledWith(sender);
      if (field === 'token') {
        expect(dependencies.verifyEncounterStillHospitalized).toHaveBeenCalledWith('901', liveInfo);
      } else {
        expect(result.error).toContain('sesión clínica cambió');
        expect(dependencies.verifyEncounterStillHospitalized).not.toHaveBeenCalled();
      }
    }
  );

  it.each([undefined, { tab: { id: 6 } }])(
    'rejects a different or missing sender before resolving any session',
    async otherSender => {
      const batchId = '12345678-1234-1234-1234-123456789012';
      const getFichaFetchInfo = vi.fn();
      const runtime = loadFactory().create(
        createDependencies({
          getFichaFetchInfo,
          chrome: {
            storage: {
              session: {
                get: vi.fn(async () => ({
                  [`hhr-scores-batch-${batchId}`]: {
                    createdAt: 1_000_000,
                    senderTabId: 5,
                    patients: [{ encounterId: '901' }],
                  },
                })),
                set: vi.fn(),
              },
            },
          },
        })
      );
      expect((await runtime.readScoresBatch(batchId, '901', otherSender)).error).toContain(
        'esta pestaña'
      );
      expect(getFichaFetchInfo).not.toHaveBeenCalled();
    }
  );

  it('fails closed for a pre-upgrade batch with no identity binding', async () => {
    const batchId = '12345678-1234-1234-1234-123456789012';
    const runtime = loadFactory().create(
      createDependencies({
        getFichaFetchInfo: vi.fn(async () => ({ info: {} })),
        chrome: {
          storage: {
            session: {
              get: vi.fn(async () => ({
                [`hhr-scores-batch-${batchId}`]: {
                  createdAt: 1_000_000,
                  senderTabId: 5,
                  patients: [{ encounterId: '901' }],
                },
              })),
              set: vi.fn(),
            },
          },
        },
      })
    );
    expect((await runtime.readScoresBatch(batchId, '901', sender)).error).toContain(
      'sesión clínica cambió'
    );
  });

  it('propagates the real save route sender and rejects a changed batch before any POST', async () => {
    const sender = { tab: { id: 5, url: 'https://hhr-entorno-prueba.netlify.app/' } };
    const readScoresBatch = vi.fn(async () => ({ error: 'La sesión clínica cambió.' }));
    const dependencies = createWriteDependencies({ readScoresBatch });
    const runtime = loadOwner().create(dependencies);
    const start = backgroundSource.indexOf('[RUNTIME_MESSAGES.SCORE_SAVE_REQUEST]: runtimeRoute(');
    const end = backgroundSource.indexOf('[RUNTIME_MESSAGES.CLINICAL_WRITE_ACK]', start);
    const context = vm.createContext({
      RUNTIME_MESSAGES: { SCORE_SAVE_REQUEST: 'save' },
      runtimeRoute: (handle: unknown) => handle,
      handleScoreSaveRequest: runtime.handleSaveRequest,
    });
    const routes = vm.runInContext('({' + backgroundSource.slice(start, end) + '})', context);
    const request = {
      batchId: 'batch-1',
      encId: '901',
      instrument: 'CUDYR',
      answers: cudyrAnswers,
    };
    expect(await routes.save(request, sender)).toEqual({ error: 'La sesión clínica cambió.' });
    expect(readScoresBatch).toHaveBeenCalledWith('batch-1', '901', sender);
    expect(dependencies.fetchWithTimeout).not.toHaveBeenCalled();
    expect(dependencies.verifyEncounterStillHospitalized).not.toHaveBeenCalled();
  });
});
