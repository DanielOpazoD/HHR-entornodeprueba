// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const source = (name: string) => readFileSync(`extension/${name}`, 'utf8');

describe('hospitalization report foreign identity search', () => {
  it('queries Number Identification first and preserves every letter of the official code', async () => {
    const context = vm.createContext({ URL });
    vm.runInContext(source('eloisa-patient-identity.js'), context);
    vm.runInContext(source('hospitalization-report-search-runtime.js'), context);
    vm.runInContext(source('hospitalization-reports-runtime.js'), context);
    const reports = (
      context as unknown as {
        HhrHospitalizationReportsRuntime: {
          resolveRows: (request: Record<string, unknown>) => Promise<{ rows?: unknown[] }>;
          identityKey: (value: string, type?: string) => string;
          isSearchableIdentifier: (value: string, type?: string) => boolean;
        };
      }
    ).HhrHospitalizationReportsRuntime;
    const fetchWithTimeout = vi.fn(async (_url: string, _options?: unknown) => ({
      ok: true,
      status: 200,
      json: async () => [
        {
          encounterId: 303,
          patientIdentifier: 'A123456785',
          startPeriod: '2026-09-20T18:00:00.000Z',
          endPeriod: '2026-09-21T10:00:00.000Z',
        },
      ],
    }));

    await expect(
      reports.resolveRows({
        info: {
          apiOrigin: 'https://fichamedicoback.rayensalud.cl',
          token: 'testing',
          facId: '2',
        },
        patientRun: 'A123456785',
        patientDocumentType: 'RUT',
        encId: '303',
        fetchWithTimeout,
      })
    ).resolves.toMatchObject({ rows: [expect.objectContaining({ encounterId: 303 })] });
    const url = new URL(fetchWithTimeout.mock.calls[0][0]);
    expect(url.searchParams.get('prefferedPeridentId')).toBe('3');
    expect(url.searchParams.get('prefferedIdentifierCode')).toBe('A123456785');
    expect(reports.identityKey('A123456785', 'RUT')).not.toBe(
      reports.identityKey('B123456785', 'RUT')
    );
    for (const placeholder of ['N/N', 'NOINFORMADO', 'NO-INFORMADO']) {
      expect(reports.identityKey(placeholder)).toBe('');
      expect(reports.isSearchableIdentifier(placeholder)).toBe(false);
    }
    expect(reports.identityKey('K12345678', 'RUT')).toBe('K12345678');
  });
});
