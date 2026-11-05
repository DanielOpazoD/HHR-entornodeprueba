// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import '../../../extension/fichamedico-fluid-balance-runtime.js';
const { create } = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoFluidBalanceRuntime: {
      create: (deps: Record<string, unknown>) => {
        fetchFluidBalance: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
      };
    };
  }
).HhrFichaMedicoFluidBalanceRuntime;
const input = { encId: '123456', fecha: '2026-11-04', sender: { tab: { id: 7 } } };
const runtime = (data: unknown = [], role = 'Enfermera(o)') => {
  const deps = {
    authorize: vi.fn().mockResolvedValue(true),
    resolveSession: vi.fn().mockResolvedValue({
      info: { role, practitionerId: '77' },
    }),
    readJson: vi.fn().mockResolvedValue({ status: 200, data }),
    classify: () => 'source_unavailable',
  };
  return { deps, read: create(deps).fetchFluidBalance };
};
describe('Eloísa balance runtime', () => {
  it.each(['Enfermera(o)', 'Médico'])('reads all authors with reader access for %s', async role => {
    const { deps, read } = runtime(
      [
        {
          id: 1,
          regDatetime: '2026-11-04T10:00:00-05:00',
          hydBalType: 'IN',
          inputQuantity: 100,
          authorHealthCarePractitionerRoleName: 'TENS',
          patientName: 'Sintético',
        },
      ],
      role
    );
    const result = await read(input);
    const request = deps.readJson.mock.calls[0]?.[0];
    expect(request.path).toContain(`/123456/${role === 'Médico' ? '1' : '2'}/77?`);
    const params = new URL(request.path, 'https://synthetic.example').searchParams;
    expect(params.get('type')).toBe('');
    expect(params.get('itemId')).toBe('');
    expect(params.get('dateTimeFrom')).toBe('2026-11-03T00:00:00');
    expect(params.get('dateTimeTo')).toBe('2026-11-05T23:59:59');
    expect(result).toEqual({
      censusDate: input.fecha,
      entries: [
        { id: 1, regDatetime: '2026-11-04T10:00:00-05:00', hydBalType: 'IN', inputQuantity: 100 },
      ],
    });
  });
  it('rejects unauthorized episodes before reading clinical data', async () => {
    const { deps, read } = runtime();
    deps.authorize.mockResolvedValue(false);
    expect(await read(input)).toMatchObject({ errorCode: 'episode_not_authorized' });
    expect(deps.readJson).not.toHaveBeenCalled();
  });
  it.each([{}, null, [null], ['bad']])(
    'does not turn an invalid body into an empty balance: %j',
    async body => {
      expect(await runtime(body).read(input)).toMatchObject({ errorCode: 'invalid_response' });
    }
  );
  it('distinguishes a failed request from an authoritative empty response', async () => {
    const { deps, read } = runtime();
    deps.readJson.mockRejectedValueOnce(new Error('offline'));
    expect(await read(input)).toMatchObject({ errorCode: 'source_unavailable' });
    expect(await read(input)).toEqual({ entries: [], censusDate: input.fecha });
    deps.readJson.mockResolvedValue({ status: 204, data: null });
    expect(await read(input)).toEqual({ entries: [], censusDate: input.fecha });
  });
});
