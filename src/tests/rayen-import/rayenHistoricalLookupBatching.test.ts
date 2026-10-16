import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestEgresoLookup } from '@/features/rayen-import/bridge/rayenImportBridge';
import type { EgresoLookupTarget } from '@/features/rayen-import/contracts/egresoLookup';
import { createRayenSnapshotEvidenceClient } from '@/features/rayen-import/hooks/rayenSnapshotEvidenceClient';

vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  requestEgresoLookup: vi.fn(),
}));

const targets = (count: number): EgresoLookupTarget[] =>
  Array.from({ length: count }, (_, index) => ({
    run: `${10000000 + index}1`,
    encounterId: '',
    dischargeDay: '2026-09-16',
  }));
const resultFor = (target: string | EgresoLookupTarget) => ({
  run: typeof target === 'string' ? target : target.run,
  encounterId: typeof target === 'string' ? '101' : target.encounterId || '101',
  egreso: { hasAdministrativeDischarge: true },
});
const setup = () => {
  const counters = { requests: 0, cacheHits: 0, timeouts: 0 };
  return { counters, client: createRayenSnapshotEvidenceClient(true, counters) };
};

describe('historical discharge lookup batching', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => vi.useRealTimers());

  it('recovers a month of episodes without sending one batch beyond the bridge deadline', async () => {
    vi.mocked(requestEgresoLookup).mockImplementation(async chunk =>
      chunk.length > 4 ? [] : chunk.map(resultFor)
    );
    const { client, counters } = setup();
    const requested = targets(86);
    const results = await client.lookupEgresos(requested);
    expect(results).toEqual(requested.map(resultFor));
    expect(requestEgresoLookup).toHaveBeenCalledTimes(22);
    expect(counters.requests).toBe(22);
  });

  it('bounds concurrent bridge requests and keeps order when later batches finish first', async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximum = 0;
    vi.mocked(requestEgresoLookup).mockImplementation(async chunk => {
      active += 1;
      maximum = Math.max(maximum, active);
      const firstRun = typeof chunk[0] === 'string' ? chunk[0] : chunk[0].run;
      await new Promise(resolve => setTimeout(resolve, firstRun === '100000001' ? 500 : 100));
      active -= 1;
      return chunk.map(resultFor);
    });
    const requested = targets(17);
    const pending = setup().client.lookupEgresos(requested);
    await vi.runAllTimersAsync();
    expect(await pending).toEqual(requested.map(resultFor));
    expect(maximum).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['empty', 'rejected', 'incomplete'])(
    'isolates a %s batch without shifting the identities of later successful results',
    async failure => {
      vi.mocked(requestEgresoLookup).mockImplementation(async chunk => {
        if (chunk[0] === requested[0]) {
          if (failure === 'rejected') throw new Error('Temporary bridge failure');
          return failure === 'empty' ? [] : chunk.slice(0, 1).map(resultFor);
        }
        return chunk.map(resultFor);
      });
      const requested = targets(9);
      const results = await setup().client.lookupEgresos(requested);
      expect(results).toHaveLength(9);
      expect(results.map(result => result.run)).toEqual(requested.map(target => target.run));
      expect(results.slice(4)).toEqual(requested.slice(4).map(resultFor));
      for (const result of results.slice(failure === 'incomplete' ? 1 : 0, 4)) {
        expect(result.error).toBeTruthy();
        expect(result.egreso).toBeUndefined();
      }
    }
  );

  it.each([undefined, 'Temporary read failure'])(
    'rejects a response for a different identity or exact hospitalization (error=%s)',
    async error => {
      const requested = [{ ...targets(1)[0], encounterId: '101' }];
      vi.mocked(requestEgresoLookup).mockResolvedValue([
        { run: requested[0].run, encounterId: '102', egreso: { id: '102' }, error },
      ]);
      expect((await setup().client.lookupEgresos(requested))[0]).toMatchObject({
        run: requested[0].run,
        encounterId: '101',
        error: expect.any(String),
      });
      vi.mocked(requestEgresoLookup).mockResolvedValue([
        { run: '200000002', encounterId: '101', egreso: { id: '101' }, error },
      ]);
      expect((await setup().client.lookupEgresos(requested))[0].error).toBeTruthy();
    }
  );
});
