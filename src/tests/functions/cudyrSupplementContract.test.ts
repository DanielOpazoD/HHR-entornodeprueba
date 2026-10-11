import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { supplementRequest, supplementBytes } from '@/tests/fixtures/cudyrSupplementFixture';
const require = createRequire(import.meta.url);
const { readCudyrSupplements } = require('../../../functions/lib/cudyrSupplementStore.js');
const { parseSupplementImport } = require('../../../functions/lib/cudyrSupplementContract.js');
describe('documentary supplement boundary', () => {
  it('revalidates old archived reports against their stored bytes on read', async () => {
    const request = supplementRequest();
    const parsed = parseSupplementImport(request);
    const report = {
      id: parsed.versionId,
      report: request.report,
      file: { sha256: parsed.fileHash },
    };
    const query: any = {
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      get: async () => ({ size: 1, docs: [{ data: () => ({ ...report }) }] }),
    };
    const hospital = {
      collection: (name: string) =>
        name === 'cudyrMonthlySupplements'
          ? query
          : {
              doc: () => ({
                get: async () => ({ exists: true, data: () => ({ base64: request.file.base64 }) }),
              }),
            },
    };
    expect(
      (await readCudyrSupplements(hospital, { month: '2026-10' })).reports[0].bytesVerified
    ).toBe(true);
    report.report.patients[0].days[0].category = 'A1';
    report.report.patients[0].days[0].originalValue = 'A1';
    await expect(readCudyrSupplements(hospital, { month: '2026-10' })).rejects.toThrow();
  });
  it('preserves extension capture provenance separately from clinical completeness', () => {
    const capture = { source: 'extension_monthly_report', observedAt: '2026-08-01T18:00:00Z' };
    const parsed = parseSupplementImport({ ...supplementRequest(), capture });
    expect(parsed.capture).toEqual(capture);
    expect(parsed).not.toHaveProperty('complete');
    expect(parsed.versionId).not.toBe(parseSupplementImport(supplementRequest()).versionId);
  });
  it.each(['invalid', '2999-01-01T00:00:00Z', '2026-08-01T18:00:00'])(
    'rejects unverifiable capture timestamps %s',
    observedAt => {
      expect(() =>
        parseSupplementImport({
          ...supplementRequest(),
          capture: { source: 'extension_monthly_report', observedAt },
        })
      ).toThrow();
    }
  );
  it('identifies exact versions separately from equivalent monthly content', () => {
    const request = supplementRequest();
    const first = parseSupplementImport(request);
    request.report.generatedLabel = 'Fecha Hora Impresión: 08-10-2026 02:35';
    request.file.base64 = supplementBytes(request.report);
    const later = parseSupplementImport(request);
    expect(later.contentId).toBe(first.contentId);
    expect(later.versionId).not.toBe(first.versionId);
    request.report.patients[0].days[0].category = 'B1';
    request.report.patients[0].days[0].originalValue = 'B1';
    request.file.base64 = supplementBytes(request.report);
    expect(parseSupplementImport(request).contentId).not.toBe(first.contentId);
  });
  it('rejects a valid-looking category that differs from the archived bytes', () => {
    const r = supplementRequest();
    r.report.patients[0].days[0].category = 'A1';
    r.report.patients[0].days[0].originalValue = 'A1';
    expect(() => parseSupplementImport(r)).toThrow();
  });
  it.each([
    'unconfirmed',
    'hospital',
    'oversized',
    'signature',
    'date',
    'category',
    'duplicate day',
    'duplicate row',
    'foreign',
    'period',
    'formula',
    'missing name',
  ])('rejects %s before storage', kind => {
    const r = supplementRequest();
    if (kind === 'unconfirmed') r.confirmed = false;
    if (kind === 'hospital') Object.assign(r, { hospitalId: 'other' });
    if (kind === 'oversized') r.file.base64 = 'A'.repeat(350000);
    if (kind === 'signature') r.file.base64 = 'AAAAAAAAAAA=';
    if (kind === 'date') r.report.patients[0].days[0].sourceDate = '2026-09-30';
    if (kind === 'category') r.report.patients[0].days[0].category = 'D3';
    if (kind === 'duplicate day') r.report.patients[0].days[1] = r.report.patients[0].days[0];
    if (kind === 'duplicate row') r.report.patients.push(r.report.patients[0]);
    if (kind === 'foreign') r.report.establishment = 'Hospital Distinto';
    if (kind === 'period') r.report.month = '2026-13';
    if (kind === 'formula') Object.assign(r.report.patients[0], { diagnosis: { formula: 'x' } });
    if (kind === 'missing name') r.report.patients[0].patientName = '';
    expect(() => parseSupplementImport(r)).toThrow();
  });
});
