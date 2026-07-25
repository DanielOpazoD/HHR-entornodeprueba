// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import '../../../extension/message-contract.js';

interface ValidationResult {
  ok: boolean;
  known: boolean;
  type?: string;
  response?: { code?: string; error?: string };
}

interface MessageContract {
  types: Record<string, string>;
  responses: {
    success: (data?: object) => Record<string, unknown>;
    error: (message: string, code?: string, data?: object) => Record<string, unknown>;
    uncertain: (message: string, data?: object) => Record<string, unknown>;
    sessionRequired: (message: string, data?: object) => Record<string, unknown>;
  };
  validateRuntimeMessage: (message: unknown) => ValidationResult;
  createRuntimeRouter: (
    routes: Record<
      string,
      {
        handle: (message: Record<string, unknown>, sender: unknown) => unknown;
        fallback: string;
      }
    >
  ) => (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown;
}

const contract = (globalThis as typeof globalThis & { HhrRayenMessageContract: MessageContract })
  .HhrRayenMessageContract;

describe('shared Rayen runtime-message contract', () => {
  it('registers every service-worker request type once', () => {
    const values = Object.values(contract.types);

    expect(values).toHaveLength(49);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every(value => /^RAYEN_[A-Z0-9_]+$/.test(value))).toBe(true);
  });

  it('accepts valid payloads and rejects malformed known messages', () => {
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.SYNC_BUNDLE_REQUEST,
        requestId: 'sync-1',
        dateStart: '2026-07-24',
        dateEnd: '2026-07-25',
      })
    ).toMatchObject({ ok: true, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.SYNC_BUNDLE_REQUEST,
        requestId: 'sync-1',
        dateStart: '2026-07-24',
      })
    ).toMatchObject({ ok: false, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.HANDOFF_SAVE_REQUEST,
        batchId: 'batch-1',
        encId: '141121',
        observation: 'Paciente estable.',
      })
    ).toMatchObject({ ok: true, known: true, type: contract.types.HANDOFF_SAVE_REQUEST });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.HANDOFF_OPTIONS_REQUEST,
        currentEncId: '',
      })
    ).toMatchObject({ ok: true, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.LAB_SEARCH_REQUEST,
        rutBody: '29219852',
      })
    ).toMatchObject({ ok: true, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.LAB_SEARCH_REQUEST,
        rutBody: '29.219.852-3',
      })
    ).toMatchObject({ ok: false, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.LAB_SEARCH_REQUEST,
        rutBody: '1234',
      })
    ).toMatchObject({ ok: false, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.STATISTICAL_DISCHARGE_REPORT_REQUEST,
        encId: '141704',
      })
    ).toMatchObject({ ok: true, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.STATISTICAL_DISCHARGE_REPORT_REQUEST,
        encId: '',
      })
    ).toMatchObject({ ok: false, known: true });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.PATIENT_FLOW_REPORT_REQUEST,
        encId: '142040',
      })
    ).toMatchObject({ ok: true, known: true });

    expect(
      contract.validateRuntimeMessage({
        type: contract.types.EGRESO_LOOKUP_REQUEST,
        runs: '17752753-2',
      })
    ).toMatchObject({
      ok: false,
      known: true,
      response: { code: 'INVALID_MESSAGE', error: expect.stringContaining('runs') },
    });
    expect(
      contract.validateRuntimeMessage({
        type: contract.types.NURSING_MEDICAL_EPICRISIS_PRINT_REQUEST,
        encId: '141121',
        patientRun: '17.752.753-1',
        censusDate: '2026-07-19',
        delivery: 'download',
        operation: 'list',
        documentType: 'history',
      })
    ).toMatchObject({ ok: true, known: true });
  });

  it('leaves unknown messages untouched for other extension listeners', () => {
    const sendResponse = vi.fn();
    const router = contract.createRuntimeRouter({});

    expect(router({ type: 'ANOTHER_EXTENSION_MESSAGE' }, {}, sendResponse)).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('preserves asynchronous sendResponse semantics and maps operation failures', async () => {
    const sender = { tab: { id: 12 } };
    const handler = vi.fn(async message => ({ opened: message.encId }));
    const sendResponse = vi.fn();
    const router = contract.createRuntimeRouter({
      [contract.types.OPEN_ENCOUNTER_REQUEST]: {
        handle: handler,
        fallback: 'No se pudo abrir el episodio.',
      },
    });

    expect(
      router({ type: contract.types.OPEN_ENCOUNTER_REQUEST, encId: '141121' }, sender, sendResponse)
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ opened: '141121' }));
    expect(handler).toHaveBeenCalledWith(
      { type: contract.types.OPEN_ENCOUNTER_REQUEST, encId: '141121' },
      sender
    );

    const falsyResponse = vi.fn();
    const falsyRouter = contract.createRuntimeRouter({
      [contract.types.EXTENSION_HEALTH_REQUEST]: {
        handle: () => false,
        fallback: 'No se pudo verificar la extensión.',
      },
    });
    expect(falsyRouter({ type: contract.types.EXTENSION_HEALTH_REQUEST }, {}, falsyResponse)).toBe(
      true
    );
    await vi.waitFor(() => expect(falsyResponse).toHaveBeenCalledWith(false));

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failedResponse = vi.fn();
    const failedRouter = contract.createRuntimeRouter({
      [contract.types.EXTENSION_HEALTH_REQUEST]: {
        handle: () => Promise.reject(new Error('canal cerrado')),
        fallback: 'No se pudo verificar la extensión.',
      },
    });
    expect(
      failedRouter({ type: contract.types.EXTENSION_HEALTH_REQUEST }, {}, failedResponse)
    ).toBe(true);
    await vi.waitFor(() =>
      expect(failedResponse).toHaveBeenCalledWith({
        error: 'No se pudo verificar la extensión. canal cerrado',
      })
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('does not invoke a handler when a known payload is invalid', async () => {
    const handler = vi.fn();
    const sendResponse = vi.fn();
    const router = contract.createRuntimeRouter({
      [contract.types.SYSLAB_LOGIN_REQUEST]: {
        handle: handler,
        fallback: 'No se pudo iniciar sesión.',
      },
    });

    expect(
      router(
        { type: contract.types.SYSLAB_LOGIN_REQUEST, username: 'usuario', password: null },
        {},
        sendResponse
      )
    ).toBe(true);
    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'INVALID_MESSAGE',
          error: expect.stringContaining('password'),
        })
      )
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('provides common response shapes without exposing payload details', () => {
    expect(contract.responses.success({ connected: true })).toEqual({
      connected: true,
      ok: true,
    });
    expect(contract.responses.error(' Falló la operación. ', 'FAILED')).toEqual({
      code: 'FAILED',
      error: 'Falló la operación.',
    });
    expect(contract.responses.uncertain('Sin confirmación')).toEqual({
      state: 'uncertain',
      uncertain: true,
      error: 'Sin confirmación',
    });
    expect(contract.responses.sessionRequired('Inicia sesión')).toEqual({
      state: 'requires-session',
      requiresLogin: true,
      error: 'Inicia sesión',
    });
  });

  it('loads the contract before every runtime caller and the service-worker router', () => {
    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts?: Array<{ js?: string[]; matches?: string[] }>;
    };
    const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
    const syslabLogin = readFileSync(path.resolve('extension/syslab-login.html'), 'utf8');
    const runtimeCallers = new Set([
      'content-fichamedico.js',
      'content-gestioncamas.js',
      'content-hhr.js',
      'content-hhr-patient-flow.js',
      'content-hhr-epicrisis.js',
      'content-hhr-statistical-discharge.js',
      'content-hhr-syslab.js',
      'content-exam-request-print.js',
      'content-prescription-print.js',
    ]);

    for (const entry of manifest.content_scripts || []) {
      const scripts = entry.js || [];
      if (!scripts.some(script => runtimeCallers.has(script))) continue;
      expect(scripts[0]).toBe('message-contract.js');
    }
    expect(background.indexOf("'message-contract.js'")).toBeLessThan(
      background.indexOf("'encounter-navigation.js'")
    );
    expect(background).toContain(
      'chrome.runtime.onMessage.addListener(messageContract.createRuntimeRouter(runtimeMessageRoutes))'
    );
    expect(background).not.toMatch(/msg\.type\s*===\s*['"]RAYEN_/);
    const patientFlowEntry = manifest.content_scripts?.find(entry =>
      entry.js?.includes('content-hhr-patient-flow.js')
    );
    expect(patientFlowEntry?.matches).toEqual([
      'http://localhost:3000/*',
      'http://localhost:3001/*',
      'https://testinghhr.netlify.app/*',
    ]);
    expect(background).toContain('patientFlowRuntime.authorizeSnapshotResponse(sender,');
    const dischargeReportRuntime = readFileSync(
      path.resolve('extension/gestion-camas-discharge-report-runtime.js'),
      'utf8'
    );
    expect(background).toContain("'gestion-camas-discharge-report-runtime.js'");
    expect(dischargeReportRuntime).toContain('Informe_Estadistico_Egreso_Hospitalario_CARTA.pdf');
    expect(dischargeReportRuntime).toContain("reportUrl.searchParams.set('ENC_ID', encounterId)");
    expect(dischargeReportRuntime).toContain('await markSessionVerified(result)');
    expect(syslabLogin.indexOf('message-contract.js')).toBeLessThan(
      syslabLogin.indexOf('syslab-login.js')
    );
  });
});
