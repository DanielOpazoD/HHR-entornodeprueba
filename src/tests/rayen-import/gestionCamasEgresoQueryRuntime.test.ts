// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Target = { run: string; encounterId?: string; dischargeDay?: string };
type Result = {
  run: string;
  encounterId?: string;
  egreso?: Record<string, unknown> | null;
  error?: string;
};
type Factory = {
  create: (dependencies: Record<string, unknown>) => {
    request: (
      runs: unknown[],
      targets?: Target[],
      sender?: unknown
    ) => Promise<{
      error?: string;
      results?: Result[];
    }>;
  };
};
const source = (file: string) => readFileSync(`extension/${file}`, 'utf8');
const syntheticRun = '10000000K';
const day = '2030-01-10';
const sender = { tab: { id: 17 }, frameId: 0 };
const mother = { id: 101, dateDischarge: day, hasAdministrativeDischarge: true };
const newborn = { id: 202, dateDischarge: day, hasAdministrativeDischarge: true };
const exact = { run: syntheticRun, encounterId: '202', dischargeDay: day };
const reportOnly = { run: syntheticRun, dischargeDay: day };
const ok = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

function harness(payloads: unknown[] = [[], []]) {
  const context = vm.createContext({});
  vm.runInContext('self = globalThis', context);
  for (const file of [
    'clinical-day-runtime.js',
    'gestion-camas-egreso-lookup.js',
    'gestion-camas-egreso-query-runtime.js',
  ])
    vm.runInContext(source(file), context, { filename: file });
  const record = {
    apiBase: 'https://gestion.example.test/api',
    facId: 7,
    token: 'synthetic-token',
    generation: 1,
  };
  const resolveSession = vi.fn(
    async (): Promise<{ record?: typeof record; error?: string }> => ({ record })
  );
  const fetchWithTimeout = vi.fn(async (_url: string, _options: unknown) => ok(payloads.shift()));
  const classifyRejection = vi.fn(
    async (response: { status: number }, _record: unknown): Promise<string> =>
      response.status === 401 ? 'expired' : response.status === 403 ? 'forbidden' : ''
  );
  const markSessionVerified = vi.fn(async (_record: unknown) => true);
  const authorizeVerifiedEncounter = vi.fn();
  const runtime = (context.HhrGestionCamasEgresoQueryRuntime as Factory).create({
    resolveSession,
    fetchWithTimeout,
    classifyRejection,
    markSessionVerified,
    authorizeVerifiedEncounter,
  });
  const queriedTypes = () =>
    fetchWithTimeout.mock.calls.map(([url]) =>
      new URL(url).searchParams.get('prefferedPeridentId')
    );
  return {
    runtime,
    record,
    resolveSession,
    fetchWithTimeout,
    classifyRejection,
    markSessionVerified,
    authorizeVerifiedEncounter,
    queriedTypes,
  };
}

describe('Gestión de Camas RUN/maternal RUN discharge query runtime', () => {
  it('finds an exact newborn episode only available under maternal RUN type 4', async () => {
    const h = harness([[mother], [newborn]]);
    expect(await h.runtime.request([], [exact], sender)).toEqual({
      results: [{ run: syntheticRun, encounterId: '202', egreso: newborn }],
    });
    expect(h.queriedTypes()).toEqual(['2', '4']);
    for (const [url, options] of h.fetchWithTimeout.mock.calls) {
      expect(new URL(url).pathname).toBe('/api/facility/7/encounter');
      expect(new URL(url).searchParams.get('prefferedIdentifierCode')).toBe(syntheticRun);
      expect(options).toEqual({ headers: { Authorization: h.record.token } });
    }
    expect(h.markSessionVerified).toHaveBeenNthCalledWith(1, h.record);
    expect(h.markSessionVerified).toHaveBeenNthCalledWith(2, h.record);
    expect(h.authorizeVerifiedEncounter).toHaveBeenCalledExactlyOnceWith(sender, '202');
  });

  it('returns an exact type 2 episode immediately without a needless type 4 query', async () => {
    const h = harness([[mother, newborn]]);
    expect((await h.runtime.request([], [exact], sender)).results?.[0].encounterId).toBe('202');
    expect(h.queriedTypes()).toEqual(['2']);
    expect(h.markSessionVerified).toHaveBeenCalledTimes(1);
    expect(h.authorizeVerifiedEncounter).toHaveBeenCalledExactlyOnceWith(sender, '202');
  });

  it('does not select a mother and newborn sharing the report-only discharge day', async () => {
    const h = harness([[mother], [newborn]]);
    expect(await h.runtime.request([], [reportOnly], sender)).toEqual({
      results: [{ run: syntheticRun, encounterId: '', egreso: null }],
    });
    expect(h.queriedTypes()).toEqual(['2', '4']);
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
  });

  it('selects a unique newborn day match only after both queries complete', async () => {
    const h = harness([[{ ...mother, dateDischarge: '2030-01-09' }], [newborn]]);
    const result = await h.runtime.request([], [reportOnly], sender);
    expect(result.results?.[0]).toEqual({ run: syntheticRun, encounterId: '202', egreso: newborn });
    expect(h.queriedTypes()).toEqual(['2', '4']);
    expect(h.authorizeVerifiedEncounter).toHaveBeenCalledExactlyOnceWith(sender, '202');
  });

  it.each([202, '202', '0202'])(
    'deduplicates the same numeric episode returned as %s',
    async id => {
      const h = harness([[newborn], [{ ...newborn, id }]]);
      expect((await h.runtime.request([], [reportOnly], sender)).results?.[0].encounterId).toBe(
        '202'
      );
      expect(h.queriedTypes()).toEqual(['2', '4']);
      expect(h.authorizeVerifiedEncounter).toHaveBeenCalledTimes(1);
    }
  );

  it('does not let a differently formatted duplicate hide the exact maternal episode', async () => {
    const h = harness([[{ ...newborn, id: '0202' }], [newborn]]);
    expect((await h.runtime.request([], [exact], sender)).results?.[0].egreso).toEqual(newborn);
    expect(h.queriedTypes()).toEqual(['2', '4']);
    expect(h.authorizeVerifiedEncounter).toHaveBeenCalledExactlyOnceWith(sender, '202');
  });

  it('waits for maternal query completion before authorizing a unique type 2 day match', async () => {
    const h = harness();
    let completeMaternal!: (response: ReturnType<typeof ok>) => void;
    const pendingMaternal = new Promise<ReturnType<typeof ok>>(resolve => {
      completeMaternal = resolve;
    });
    let maternalStarted!: () => void;
    const started = new Promise<void>(resolve => {
      maternalStarted = resolve;
    });
    h.fetchWithTimeout.mockResolvedValueOnce(ok([mother]));
    h.fetchWithTimeout.mockImplementationOnce(async () => {
      maternalStarted();
      return pendingMaternal;
    });
    const pending = h.runtime.request([], [reportOnly], sender);
    await started;
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
    completeMaternal(ok([]));
    expect((await pending).results?.[0].encounterId).toBe('101');
    expect(h.authorizeVerifiedEncounter).toHaveBeenCalledExactlyOnceWith(sender, '101');
  });

  it('does not deduplicate unproven identities by their identical discharge dates', async () => {
    const h = harness([[{ dateDischarge: day }], [{ dateDischarge: day }]]);
    expect((await h.runtime.request([], [reportOnly], sender)).results?.[0].egreso).toBeNull();
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
  });

  it('does not collapse different large numeric episode strings through Number precision loss', async () => {
    const h = harness([
      [{ ...mother, id: '9007199254740992' }],
      [{ ...newborn, id: '9007199254740993' }],
    ]);
    expect((await h.runtime.request([], [reportOnly], sender)).results?.[0].egreso).toBeNull();
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
  });

  it('never selects a wrong episode even when its discharge day matches', async () => {
    const h = harness([[mother], [{ ...newborn, id: 303 }]]);
    expect(await h.runtime.request([], [exact], sender)).toEqual({
      results: [{ run: syntheticRun, encounterId: '202', egreso: null }],
    });
    expect(h.queriedTypes()).toEqual(['2', '4']);
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
  });

  it('supports singleton payloads and emits only approved metadata, never credentials', async () => {
    const h = harness([
      null,
      { ...newborn, patientName: 'Synthetic patient', token: 'synthetic-token' },
    ]);
    const result = await h.runtime.request([], [exact], sender);
    expect(result.results?.[0].egreso).toEqual(newborn);
    expect(JSON.stringify(result)).not.toContain('synthetic-token');
    expect(JSON.stringify(result)).not.toContain('patientName');
  });

  it('does not select legacy RUN-only targets without an exact episode or discharge day', async () => {
    const h = harness([[mother], [newborn]]);
    expect((await h.runtime.request(['10.000.000-K'], undefined, sender)).results).toEqual([
      { run: syntheticRun, encounterId: '', egreso: null },
    ]);
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
  });

  for (const failedType of [2, 4]) {
    it.each([
      [401, 'venció'],
      [403, 'permisos'],
      [500, 'HTTP 500'],
    ])(`fails closed for HTTP %s from required type ${failedType}`, async (status, message) => {
      const h = harness();
      if (failedType === 4) h.fetchWithTimeout.mockResolvedValueOnce(ok([mother]));
      const response = { ok: false, status: Number(status), json: async () => [] };
      h.fetchWithTimeout.mockResolvedValueOnce(response);
      const result = await h.runtime.request([], [reportOnly], sender);
      expect(result.results?.[0]).toEqual({
        run: syntheticRun,
        error: expect.stringContaining(message),
      });
      expect(h.classifyRejection).toHaveBeenCalledExactlyOnceWith(response, h.record);
      expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
      expect(h.queriedTypes()).toEqual(failedType === 2 ? ['2'] : ['2', '4']);
    });

    it(`suppresses partial results on a network failure from type ${failedType}`, async () => {
      const h = harness();
      if (failedType === 4) h.fetchWithTimeout.mockResolvedValueOnce(ok([mother]));
      h.fetchWithTimeout.mockRejectedValueOnce(new Error('Synthetic network failure'));
      expect((await h.runtime.request([], [reportOnly], sender)).results?.[0]).toEqual({
        run: syntheticRun,
        error: 'Synthetic network failure',
      });
      expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
    });

    it(`stops the batch on a session generation change at type ${failedType}`, async () => {
      const h = harness([[mother], [newborn]]);
      if (failedType === 4) h.markSessionVerified.mockResolvedValueOnce(true);
      h.markSessionVerified.mockResolvedValueOnce(false);
      expect((await h.runtime.request([], [reportOnly, exact], sender)).results).toEqual([
        { run: syntheticRun, error: expect.stringContaining('sesión cambió') },
      ]);
      expect(h.queriedTypes()).toEqual(failedType === 2 ? ['2'] : ['2', '4']);
      expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
    });
  }

  it.each(['expired', 'changed'])(
    'preserves batch termination for classified %s rejection',
    async rejection => {
      const h = harness();
      h.fetchWithTimeout.mockResolvedValueOnce(ok([mother]));
      h.fetchWithTimeout.mockResolvedValueOnce({ ok: false, status: 401, json: async () => [] });
      h.classifyRejection.mockResolvedValueOnce(rejection);
      const result = await h.runtime.request([], [reportOnly, exact], sender);
      expect(result.results).toHaveLength(1);
      expect(result.results?.[0].error).toContain(
        rejection === 'changed' ? 'sesión cambió' : 'venció'
      );
      expect(h.queriedTypes()).toEqual(['2', '4']);
      expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
    }
  );

  it('fails closed if the needed maternal response cannot be decoded', async () => {
    const h = harness();
    h.fetchWithTimeout.mockResolvedValueOnce(ok([mother]));
    h.fetchWithTimeout.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });
    expect((await h.runtime.request([], [reportOnly], sender)).results?.[0].error).toBe(
      'Invalid JSON'
    );
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
  });

  it('does not authorize even an exact type 2 match after session verification fails', async () => {
    const h = harness([[newborn]]);
    h.markSessionVerified.mockResolvedValueOnce(false);
    expect((await h.runtime.request([], [exact], sender)).results?.[0].error).toContain(
      'sesión cambió'
    );
    expect(h.queriedTypes()).toEqual(['2']);
    expect(h.authorizeVerifiedEncounter).not.toHaveBeenCalled();
  });

  it('returns connection and facility errors before querying', async () => {
    const h = harness();
    h.resolveSession.mockResolvedValueOnce({ error: 'Synthetic disconnected session' });
    expect(await h.runtime.request([], [exact])).toEqual({
      error: 'Synthetic disconnected session',
    });
    h.resolveSession.mockResolvedValueOnce({ record: { ...h.record, facId: 0 } });
    expect((await h.runtime.request([], [exact])).error).toContain('establecimiento');
    expect(h.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('imports the pure policy before the query runtime and wires session/authorization dependencies', () => {
    const background = source('background.js');
    expect(background.indexOf("'gestion-camas-egreso-query-runtime.js'")).toBeGreaterThan(
      background.indexOf("'gestion-camas-egreso-lookup.js'")
    );
    expect(background).toContain(
      'const { request: handleEgresoLookup } = self.HhrGestionCamasEgresoQueryRuntime.create({'
    );
    expect(background).toContain('markSessionVerified: markGestionCamasSessionVerified');
    expect(background).toContain('classifyRejection: classifyGestionCamasRejection');
    expect(background).toContain(
      'authorizeVerifiedEncounter: (sender, encounterId) => patientFlowRuntime.authorizeVerifiedEncounter(sender, encounterId)'
    );
  });
});
