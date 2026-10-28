import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  importCudyrSupplement,
  loadCudyrSupplements,
} from '@/services/cudyr/cudyrSupplementService';
const { request, runtime } = vi.hoisted(() => ({ request: vi.fn(), runtime: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => request }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: runtime },
}));
beforeEach(() => {
  request.mockReset();
  runtime.mockReset().mockResolvedValue({});
});
describe('complete persisted supplement pagination', () => {
  it('keeps the month readable beyond fifty immutable versions', async () => {
    for (let page = 0; page < 11; page++)
      request.mockResolvedValueOnce({
        data: {
          reports: Array.from({ length: page === 10 ? 1 : 5 }, (_, i) => ({
            id: String(page * 5 + i),
          })),
          nextCursor: page === 10 ? null : `cursor-${page}`,
        },
      });
    const reports = await loadCudyrSupplements(
      '2026-10-01',
      '2026-10-07',
      new AbortController().signal
    );
    expect(reports).toHaveLength(51);
    expect(request).toHaveBeenCalledTimes(11);
    expect(request.mock.calls.at(-1)?.[0]).toMatchObject({
      cursor: 'cursor-9',
      limit: 5,
      month: '2026-10',
    });
  });
  it('rejects a repeated cursor without looping forever or returning a partial success', async () => {
    request.mockResolvedValue({ data: { reports: [], nextCursor: 'same-cursor' } });
    await expect(
      loadCudyrSupplements('2026-10-01', '2026-10-07', new AbortController().signal)
    ).rejects.toThrow(/no avanzó/);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('stops after an in-flight page if the user changes the requested period', async () => {
    const controller = new AbortController();
    request.mockImplementationOnce(async () => {
      controller.abort();
      return { data: { reports: [], nextCursor: 'next' } };
    });
    await expect(
      loadCudyrSupplements('2026-10-01', '2026-10-07', controller.signal)
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('checks the capture session after the Functions runtime finishes loading', async () => {
    let release: (() => void) | undefined;
    runtime.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = () => resolve({});
        })
    );
    let sessionChanged = false;
    const pending = importCudyrSupplement(
      {
        operationId: 'synthetic',
        file: { name: 'synthetic.xls', base64: 'AA==' },
        report: {
          schemaVersion: 1,
          source: 'eloisa_monthly_report',
          month: '2026-10',
          establishment: 'Hospital Hanga Roa',
          generatedLabel: '',
          sheet: 'Synthetic',
          patients: [],
        },
      },
      () => {
        if (sessionChanged) throw new Error('Synthetic session changed');
      }
    );
    sessionChanged = true;
    if (!release) throw new Error('Runtime must be waiting');
    release();
    await expect(pending).rejects.toThrow('Synthetic session changed');
    expect(request).not.toHaveBeenCalled();
  });
});
