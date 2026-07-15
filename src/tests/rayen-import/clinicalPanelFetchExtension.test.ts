import { describe, expect, it, vi } from 'vitest';

import '../../../extension/clinical-panel-fetch.js';

const clinicalPanelFetch = (
  globalThis as typeof globalThis & {
    HhrClinicalPanelFetch: {
      fetchMedicationPages: (input: {
        fetchPage: (page: number, limit: number) => Promise<unknown>;
        pageSize?: number;
        maxPages?: number;
      }) => Promise<unknown[]>;
      unwrapRequiredSources: (
        sources: Array<{
          label: string;
          result: { status: 'fulfilled'; value: unknown } | { status: 'rejected'; reason: unknown };
        }>
      ) => unknown[];
    };
  }
).HhrClinicalPanelFetch;

describe('clinical panel extension fetch contracts', () => {
  it('fetches every medication-state page instead of stopping at the first 100 rows', async () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => ({ id }));
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ Medication: firstPage })
      .mockResolvedValueOnce({ Medication: [{ id: 100 }, { id: 101 }] });

    const rows = await clinicalPanelFetch.fetchMedicationPages({ fetchPage });

    expect(rows).toHaveLength(102);
    expect(fetchPage.mock.calls).toEqual([
      [0, 100],
      [1, 100],
    ]);
  });

  it('accepts a legitimate empty 204 payload but rejects any unavailable required source', () => {
    expect(
      clinicalPanelFetch.unwrapRequiredSources([
        { label: 'plan de cuidados', result: { status: 'fulfilled', value: null } },
      ])
    ).toEqual([null]);

    expect(() =>
      clinicalPanelFetch.unwrapRequiredSources([
        { label: 'historial clínico', result: { status: 'fulfilled', value: [] } },
        {
          label: 'medicamentos activos',
          result: { status: 'rejected', reason: new Error('HTTP 503') },
        },
      ])
    ).toThrow('medicamentos activos: HTTP 503');
  });

  it('fails closed when the backend repeats a full medication page', async () => {
    const repeatedPage = Array.from({ length: 100 }, (_, id) => ({ id }));
    const fetchPage = vi.fn().mockResolvedValue({ Medication: repeatedPage });

    await expect(clinicalPanelFetch.fetchMedicationPages({ fetchPage })).rejects.toThrow(
      'repitió una página'
    );
  });
});
