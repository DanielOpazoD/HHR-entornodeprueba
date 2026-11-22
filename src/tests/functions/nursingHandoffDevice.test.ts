// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
  createDeviceHandoffHandlers,
  createNursingHandoffDeviceFunctions,
} = require('../../../functions/lib/nursingHandoffDevice.js');
const { ACCESS, PRIVATE, digest } = require('../../../functions/lib/accounts/accountPolicy.js');

const uid = 'hhrn_synthetic_nurse';
const deviceId = '22222222-2222-4222-8222-222222222222';
const proof = 'a'.repeat(64);
const professionalRun = '11111111-1';
const sourceOrigin = 'chrome-extension://' + 'a'.repeat(32);
const instant = Date.parse('2026-11-21T12:00:00Z');
const context = {
  auth: {
    uid,
    token: {
      hhrAccountVersion: 1,
      auth_time: instant / 1000,
      firebase: { sign_in_provider: 'password' },
    },
  },
};
const account = { status: 'active', role: 'nurse_hospital', hospitalId: 'hanga_roa', version: 1 };
const enrollment = { deviceId, challenge: digest(proof) };
const status = { action: 'status', deviceId, proof, professionalRun };

function fixture() {
  const documents = new Map<string, unknown>([
    [ACCESS + '/' + uid, account],
    [PRIVATE + '/' + uid, { rut: professionalRun }],
  ]);
  const getRead = vi.fn((path: string) => ({ data: () => documents.get(path) }));
  const firestore = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: name + '/' + id,
        get: async () => getRead(name + '/' + id),
        collection: vi.fn(),
        delete: async () => documents.delete(name + '/' + id),
      }),
    }),
    runTransaction: (write: (transaction: unknown) => unknown) =>
      write({
        get: async (ref: { path: string }) => getRead(ref.path),
        create: (ref: { path: string }, value: unknown) => documents.set(ref.path, value),
      }),
  };
  const getUser = vi.fn(async () => ({
    email: 'nurse@example.invalid',
    disabled: false,
    tokensValidAfterTime: new Date(instant - 1000).toISOString(),
  }));
  return {
    documents,
    deps: {
      firestore,
      auth: { app: { options: { projectId: 'hhr-pruebas' } }, getUser },
      now: () => instant,
      Timestamp: {},
      FieldValue: {},
    },
  };
}

describe('llave individual de enfermería', () => {
  it('registra solo cuentas individuales con una sesión HHR válida, sin guardar la llave', async () => {
    const { documents, deps } = fixture();
    const { register } = createDeviceHandoffHandlers(deps);
    await expect(register(enrollment, {})).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(register(enrollment, context)).resolves.toEqual({ registered: true });
    await expect(register(enrollment, context)).resolves.toEqual({ registered: true });
    const grant = documents.get('hhr_nursing_handoff_devices/' + deviceId);
    expect(grant).toMatchObject({
      uid,
      runHash: digest(professionalRun),
      proofHash: digest(proof),
    });
    expect(JSON.stringify(grant)).not.toContain(proof);
    await expect(
      register({ ...enrollment, challenge: 'b'.repeat(64) }, context)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('verifica la llave y el RUN y revoca el acceso por cuenta o equipo', async () => {
    const { documents, deps } = fixture();
    const { register, operate } = createDeviceHandoffHandlers(deps);
    await register(enrollment, context);
    await expect(operate({ ...status, professionalRun: '11.111.111-1' })).resolves.toEqual({
      authorized: true,
    });
    for (const attempt of [{ proof: 'b'.repeat(64) }, { professionalRun: '22222222-2' }]) {
      await expect(operate({ ...status, ...attempt })).rejects.toMatchObject({
        code: 'unauthenticated',
      });
    }
    documents.set(ACCESS + '/' + uid, { ...account, version: 2 });
    await expect(operate(status)).rejects.toMatchObject({ code: 'unauthenticated' });
    documents.set(ACCESS + '/' + uid, account);
    await expect(operate({ ...status, action: 'disconnect' })).resolves.toEqual({
      disconnected: true,
    });
    await expect(operate(status)).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('expone ambos puntos de entrada solo en hhr-pruebas y restringe el origen HTTP', async () => {
    const { deps } = fixture();
    const env = { GCLOUD_PROJECT: 'hhr-pruebas', HHR_NURSING_HANDOFF_DEVICE_ORIGIN: sourceOrigin };
    expect(createNursingHandoffDeviceFunctions(deps, {})).toEqual({});
    expect(createNursingHandoffDeviceFunctions(deps, { ...env, GCLOUD_PROJECT: 'other' })).toEqual(
      {}
    );
    expect(
      createNursingHandoffDeviceFunctions(deps, { ...env, FUNCTIONS_EMULATOR: 'true' })
    ).toEqual({});
    const { nursingHandoffDevice, registerNursingHandoffDevice } =
      createNursingHandoffDeviceFunctions(deps, env);
    expect(registerNursingHandoffDevice).toBeTypeOf('function');
    const res = {
      set: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      end: vi.fn(),
    };
    await nursingHandoffDevice({ headers: {}, get: () => 'https://other.example' }, res);
    expect(res.status).toHaveBeenLastCalledWith(403);
    await nursingHandoffDevice(
      {
        headers: {},
        get: () => sourceOrigin,
        method: 'POST',
        is: () => true,
        body: { data: { action: 'status' } },
      },
      res
    );
    expect(res.json).toHaveBeenLastCalledWith({
      error: expect.objectContaining({ status: 'UNAUTHENTICATED' }),
    });
  });
});
