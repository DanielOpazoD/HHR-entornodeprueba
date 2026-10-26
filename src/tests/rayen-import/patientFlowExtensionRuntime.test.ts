// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import '../../../extension/hhr-origin-policy.js';
import '../../../extension/tab-encounter-authorization.js';
import '../../../extension/fichamedico-patient-flow-runtime.js';

type RuntimeFactory = {
  create: (dependencies: {
    clinicalClient: {
      resolveSession: () => Promise<{ info?: object; error?: string }>;
      readBuffer: (input: object) => Promise<{ data: ArrayBuffer }>;
    };
    bufferToBase64: (buffer: ArrayBuffer) => string;
  }) => {
    authorizeSnapshotResponse: (
      sender: { origin?: string; url?: string; tab: { id: number; url: string } },
      response: Promise<object>
    ) => Promise<object>;
    authorizeBundleResponse: (
      sender: { origin?: string; url?: string; tab: { id: number; url: string } },
      response: Promise<object>
    ) => Promise<object>;
    authorizeVerifiedEncounter: (
      sender: { origin?: string; url?: string; tab: { id: number; url: string } },
      encounterId: string
    ) => boolean;
    isAuthorized: (
      sender: { origin?: string; url?: string; tab: { id: number; url: string } },
      encounterId: string
    ) => boolean;
    canRequestClinicalEpisode: (sender: object | undefined, encId: string) => boolean;
    route: {
      handle: (
        message: { encId?: string },
        sender?: { origin?: string; url?: string; tab: { id: number; url: string } }
      ) => Promise<{
        ok?: boolean;
        length?: number;
        base64?: string;
        error?: string;
      }>;
      fallback: string;
    };
  };
};

const factory = (
  globalThis as typeof globalThis & { HhrFichaMedicoPatientFlowRuntime: RuntimeFactory }
).HhrFichaMedicoPatientFlowRuntime;

describe('Ficha Médico patient-flow runtime', () => {
  const session = { apiOrigin: 'https://fichamedicoback.rayensalud.cl' };
  const sender = {
    origin: 'http://localhost:3000',
    tab: { id: 44, url: 'http://localhost:3000/' },
  };
  let resolveSession: Mock<() => Promise<{ info?: object; error?: string }>>;
  let readBuffer: Mock<(input: object) => Promise<{ data: ArrayBuffer }>>;
  let bufferToBase64: Mock<(buffer: ArrayBuffer) => string>;

  beforeEach(() => {
    resolveSession = vi.fn(async () => ({ info: session }));
    readBuffer = vi.fn(async () => ({ data: new ArrayBuffer(0) }));
    bufferToBase64 = vi.fn(() => 'JVBERg==');
  });

  const createRuntime = () =>
    factory.create({
      clinicalClient: {
        resolveSession,
        readBuffer,
      },
      bufferToBase64,
    });

  const authorize = async (runtime: ReturnType<RuntimeFactory['create']>) =>
    runtime.authorizeSnapshotResponse(
      sender,
      Promise.resolve({ snapshot: { encounters: [{ encounterId: '142040' }] } })
    );

  it.each([
    'https://hhr-hospitalizados.app',
    'https://hhr-entorno-prueba.netlify.app',
    'https://deploy-preview-992--testinghhr.netlify.app',
    'https://feature-origins--hhr-entorno-prueba.netlify.app',
    'http://localhost:3000',
    'http://localhost:3010',
    'http://localhost:3020',
    'http://127.0.0.1:3020',
  ])('authorizes %s only for its verified tab and episode', async origin => {
    const runtime = createRuntime();
    const publishedSender = { origin, tab: { id: 90, url: `${origin}/census` } };
    expect(runtime.isAuthorized(publishedSender, '142040')).toBe(false);
    await runtime.authorizeSnapshotResponse(
      publishedSender,
      Promise.resolve({ snapshot: { encounters: [{ encounterId: '142040' }] } })
    );
    expect(runtime.isAuthorized(publishedSender, '142040')).toBe(true);
    expect(runtime.isAuthorized(publishedSender, '999999')).toBe(false);
    expect(
      runtime.isAuthorized(
        { ...publishedSender, tab: { ...publishedSender.tab, id: 91 } },
        '142040'
      )
    ).toBe(false);
    expect(
      runtime.isAuthorized({ ...publishedSender, origin: `${origin}.evil.example` }, '142040')
    ).toBe(false);
    await expect(runtime.route.handle({ encId: '142040' }, publishedSender)).resolves.toMatchObject(
      { ok: true }
    );
  });

  it('reads the official report for one validated encounter through the shared client', async () => {
    const buffer = Uint8Array.from([0x25, 0x50, 0x44, 0x46]).buffer;
    readBuffer.mockResolvedValue({ data: buffer });
    const runtime = createRuntime();
    await authorize(runtime);

    await expect(runtime.route.handle({ encId: '142040' }, sender)).resolves.toEqual({
      ok: true,
      length: 4,
      base64: 'JVBERg==',
    });
    expect(readBuffer).toHaveBeenCalledWith({
      info: session,
      path: '/api/report/Flujo_del_Paciente.pdf',
      query: { enc_id: '142040' },
      cache: 'no-store',
    });
    expect(runtime.route.fallback).toBe('No se pudo leer la trazabilidad de camas.');
  });

  const scalesHandler = (
    runtime: ReturnType<RuntimeFactory['create']>,
    resolve: unknown,
    fetch: unknown
  ) => {
    const source = readFileSync('extension/background.js', 'utf8');
    const start = source.indexOf('const handleScalesReportRequest =');
    const end = source.indexOf('\n};', start) + 3;
    const context = vm.createContext({
      patientFlowRuntime: runtime,
      resolveFichaClinicalSession: resolve,
      fetchScalesReportWithInfo: fetch,
    });
    return vm.runInContext(source.slice(start, end) + '\nhandleScalesReportRequest;', context);
  };

  it('blocks scales for unknown, other-tab, expired and invalid HHR episodes before any session or read', async () => {
    vi.useFakeTimers();
    try {
      const runtime = createRuntime();
      const fetchForms = vi.fn(async () => ({ forms: [] }));
      const handle = scalesHandler(runtime, resolveSession, fetchForms);
      const request = { encId: '142040', sender };
      expect((await handle(request)).error).toContain('no fueron autorizadas');
      await authorize(runtime);
      expect((await handle({ ...request, encId: '999999' })).error).toContain(
        'no fueron autorizadas'
      );
      expect(
        (await handle({ ...request, sender: { ...sender, tab: { ...sender.tab, id: 45 } } })).error
      ).toContain('no fueron autorizadas');
      expect((await handle({ ...request, encId: '../otro' })).error).toContain(
        'no fueron autorizadas'
      );
      expect((await handle({ encId: '142040' })).error).toContain('no fueron autorizadas');
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
      expect((await handle(request)).error).toContain('no fueron autorizadas');
      expect(resolveSession).not.toHaveBeenCalled();
      expect(fetchForms).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads authorized HHR scales and preserves the authenticated Ficha Médico panel', async () => {
    const runtime = createRuntime();
    await authorize(runtime);
    const fetchForms = vi.fn(async () => ({ forms: [{ synthetic: true }] }));
    const resolve = vi.fn(async () => ({ info: session }));
    const handle = scalesHandler(runtime, resolve, fetchForms);
    await expect(handle({ encId: '142040', sender })).resolves.toEqual({
      forms: [{ synthetic: true }],
    });
    const fichaSender = {
      origin: 'https://fichamedico.rayensalud.cl',
      tab: { id: 10, url: 'https://fichamedico.rayensalud.cl/' },
    };
    await expect(handle({ encId: '142040', sender: fichaSender })).resolves.toEqual({
      forms: [{ synthetic: true }],
    });
    expect(resolve).toHaveBeenLastCalledWith({ sender: fichaSender });
    expect(fetchForms).toHaveBeenCalledTimes(2);
    expect(
      (
        await handle({
          encId: '142040',
          sender: { ...fichaSender, origin: 'https://fichamedico.rayensalud.cl.evil.invalid' },
        })
      ).error
    ).toContain('no fueron autorizadas');
    resolve.mockResolvedValueOnce({ error: 'Sin sesión.' } as unknown as { info: typeof session });
    await expect(handle({ encId: '142040', sender: fichaSender })).resolves.toEqual({
      error: 'Sin sesión.',
      errorCode: 'session_required',
    });
    expect(fetchForms).toHaveBeenCalledTimes(2);
  });

  it('rejects non-numeric episodes before consulting the session', async () => {
    const runtime = createRuntime();

    await expect(runtime.route.handle({ encId: '../otro' }, sender)).resolves.toEqual({
      error: 'El episodio clínico no es válido para consultar su trazabilidad.',
    });
    expect(resolveSession).not.toHaveBeenCalled();
    expect(readBuffer).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated session is unavailable', async () => {
    resolveSession.mockResolvedValue({ error: 'Sin sesión clínica.' });
    const runtime = createRuntime();
    await authorize(runtime);

    await expect(runtime.route.handle({ encId: '142040' }, sender)).resolves.toEqual({
      error: 'Sin sesión clínica.',
    });
    expect(readBuffer).not.toHaveBeenCalled();
  });

  it('denies reports that were not authorized by a recent snapshot for the same trusted tab', async () => {
    const runtime = createRuntime();

    await expect(runtime.route.handle({ encId: '142040' }, sender)).resolves.toEqual({
      error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.',
    });
    await authorize(runtime);
    await expect(runtime.route.handle({ encId: '142041' }, sender)).resolves.toEqual({
      error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.',
    });
    await expect(
      runtime.route.handle(
        { encId: '142040' },
        {
          origin: 'http://localhost:4444',
          tab: { id: 44, url: 'http://localhost:3000/' },
        }
      )
    ).resolves.toEqual({
      error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.',
    });
    expect(readBuffer).not.toHaveBeenCalled();
  });

  it('also authorizes an exact discharged episode carried by the guarded bundle report', async () => {
    const runtime = createRuntime();
    await runtime.authorizeBundleResponse(
      sender,
      Promise.resolve({
        ok: true,
        snapshot: { encounters: [{ encounterId: '142040' }] },
        bundle: { egresoRows: [{ encounterId: '142099' }] },
      })
    );

    await expect(runtime.route.handle({ encId: '142099' }, sender)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('adds an exact Gestión de Camas lookup to the current tab authorization', async () => {
    const runtime = createRuntime();
    await authorize(runtime);

    expect(runtime.authorizeVerifiedEncounter(sender, '142083')).toBe(true);
    expect(runtime.isAuthorized(sender, '142083')).toBe(true);
    expect(runtime.isAuthorized(sender, 142083 as unknown as string)).toBe(true);
    expect(runtime.isAuthorized({ ...sender, tab: { ...sender.tab, id: 45 } }, '142083')).toBe(
      false
    );
    await expect(runtime.route.handle({ encId: '142083' }, sender)).resolves.toMatchObject({
      ok: true,
    });
  });

  it('keeps authorization from the newest overlapping snapshot response', async () => {
    const runtime = createRuntime();
    let resolveOlder!: (value: object) => void;
    let resolveNewer!: (value: object) => void;
    const older = runtime.authorizeSnapshotResponse(
      sender,
      new Promise(resolve => {
        resolveOlder = resolve;
      })
    );
    const newer = runtime.authorizeSnapshotResponse(
      sender,
      new Promise(resolve => {
        resolveNewer = resolve;
      })
    );

    resolveNewer({ snapshot: { encounters: [{ encounterId: '142041' }] } });
    await newer;
    resolveOlder({ snapshot: { encounters: [{ encounterId: '142040' }] } });
    await older;

    await expect(runtime.route.handle({ encId: '142041' }, sender)).resolves.toMatchObject({
      ok: true,
    });
    await expect(runtime.route.handle({ encId: '142040' }, sender)).resolves.toEqual({
      error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.',
    });
  });

  it('keeps authorization from the newest overlapping guarded bundle', async () => {
    const runtime = createRuntime();
    let resolveOlder!: (value: object) => void;
    let resolveNewer!: (value: object) => void;
    const older = runtime.authorizeBundleResponse(
      sender,
      new Promise(resolve => {
        resolveOlder = resolve;
      })
    );
    const newer = runtime.authorizeBundleResponse(
      sender,
      new Promise(resolve => {
        resolveNewer = resolve;
      })
    );
    resolveNewer({
      ok: true,
      snapshot: { encounters: [{ encounterId: '142041' }] },
      bundle: { egresoRows: [{ encounterId: '142042' }] },
    });
    await newer;
    resolveOlder({
      ok: true,
      snapshot: { encounters: [{ encounterId: '142040' }] },
      bundle: { egresoRows: [] },
    });
    await older;

    await expect(runtime.route.handle({ encId: '142042' }, sender)).resolves.toMatchObject({
      ok: true,
    });
    await expect(runtime.route.handle({ encId: '142040' }, sender)).resolves.toEqual({
      error: 'La trazabilidad no fue autorizada por el snapshot de esta pestaña.',
    });
  });
});
