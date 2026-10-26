// @vitest-environment node
import { readHhrBridgeSource } from './support/hhrOriginPolicyFixture';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import '../../../extension/clinical-day-runtime.js';
import '../../../extension/clinical-history-coverage.js';
import '../../../extension/fichamedico-history-read-model.js';
import '../../../extension/fichamedico-device-evidence-runtime.js';
import '../../../extension/clinical-read-error-contract.js';
import '../../../extension/fichamedico-clinical-client.js';

type Result = { forms?: unknown[]; error?: string; errorCode?: string };
const factory = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoClinicalClient: {
      create: (deps: object) => {
        fetchScalesReportWithInfo: (id: string, info?: object) => Promise<Result>;
      };
    };
  }
).HhrFichaMedicoClinicalClient;
const session = {
  token: 'placeholder',
  apiOrigin: 'https://clinical.example',
  practitionerId: '81',
  role: 'Enfermera',
};
const read = (fetchWithTimeout: ReturnType<typeof vi.fn>, info: object = session) =>
  factory
    .create({ resolveFetchInfo: async () => ({ info }), fetchWithTimeout, defaultTimeoutMs: 45000 })
    .fetchScalesReportWithInfo('142040');

describe('extension forms source codes', () => {
  it.each([
    [401, 'session_required'],
    [403, 'permission_denied'],
    [503, 'source_unavailable'],
  ])(
    'keeps the old error message and adds a bounded code for HTTP %s',
    async (status, errorCode) => {
      const result = await read(vi.fn(async () => ({ ok: false, status })));
      expect(result).toMatchObject({ error: expect.stringContaining('HTTP ' + status), errorCode });
    }
  );
  it('distinguishes missing session, timeout and malformed JSON from valid empty data', async () => {
    expect(await read(vi.fn(), {})).toMatchObject({ errorCode: 'session_required' });
    expect(
      await read(
        vi
          .fn()
          .mockRejectedValue(Object.assign(new Error('Texto modificado'), { name: 'TimeoutError' }))
      )
    ).toMatchObject({ errorCode: 'source_timeout' });
    expect(
      await read(
        vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ unexpected: true }) }))
      )
    ).toMatchObject({ errorCode: 'invalid_response' });
    expect(await read(vi.fn(async () => ({ ok: true, status: 204 })))).toMatchObject({
      ok: true,
      forms: [],
    });
  });
  it('keeps episode authorization distinct from session failures in the real handler', async () => {
    const source = readFileSync('extension/background.js', 'utf8');
    const start = source.indexOf('const handleScalesReportRequest =');
    const end = source.indexOf('\n};', start) + 3;
    const authorized = vi.fn(() => false);
    const handler = vm.runInNewContext(source.slice(start, end) + '\nhandleScalesReportRequest;', {
      patientFlowRuntime: { canRequestClinicalEpisode: authorized },
      resolveFichaClinicalSession: async () => ({ error: 'Inicia sesión.' }),
      fetchScalesReportWithInfo: vi.fn(),
    });
    expect(await handler({ encId: '142040' })).toMatchObject({
      errorCode: 'episode_not_authorized',
    });
    authorized.mockReturnValue(true);
    expect(await handler({ encId: '142040' })).toMatchObject({ errorCode: 'session_required' });
  });
});

it.each([undefined, 'episode_not_authorized', 'future_code'])(
  'the actual page relay preserves legacy errors and additive codes: %s',
  async errorCode => {
    let receive: (event: object) => void = () => {};
    let done: (value: unknown) => void = () => {};
    const reply = new Promise(resolve => {
      done = resolve;
    });
    const page = {
      location: { origin: 'http://localhost:3000' },
      addEventListener: (_: string, listener: typeof receive) => {
        receive = listener;
      },
      removeEventListener: vi.fn(),
      postMessage: done,
    };
    const error = 'Mensaje conservado para HHR anterior';
    vm.runInNewContext(readHhrBridgeSource('content-hhr.js'), {
      window: page,
      console,
      chrome: {
        runtime: {
          id: 'synthetic-runtime',
          getManifest: () => ({ version: '0.48.53' }),
          onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
          sendMessage: async () => ({ error, errorCode }),
        },
      },
      HhrRayenMessageContract: { types: { SCALES_REPORT_REQUEST: 'RAYEN_SCALES_REPORT_REQUEST' } },
      HhrBridgeGeneration: { createRelay: () => ({ getContext: vi.fn() }) },
    });
    receive({
      source: page,
      origin: page.location.origin,
      data: { type: 'HHR_RAYEN_SCALES_REPORT_REQUEST', reqId: 'request-1', encId: '142040' },
    });
    expect(await reply).toMatchObject({
      type: 'HHR_RAYEN_SCALES_REPORT_RESULT',
      reqId: 'request-1',
      forms: [],
      error,
      errorCode,
    });
  }
);
