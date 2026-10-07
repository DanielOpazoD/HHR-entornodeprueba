import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { supplementRequest } from '@/tests/fixtures/cudyrSupplementFixture';
const require = createRequire(import.meta.url);
const { parseSupplementImport } = require('../../../functions/lib/cudyrSupplementContract.js');
describe('documentary supplement boundary', () => {
  it('identifies exact versions separately from equivalent monthly content', () => {
    const request = supplementRequest();
    const first = parseSupplementImport(request);
    request.report.generatedLabel = 'A later printing';
    const later = parseSupplementImport(request);
    expect(later.contentId).toBe(first.contentId);
    expect(later.versionId).not.toBe(first.versionId);
    request.report.patients[0].days[0].category = 'B1';
    request.report.patients[0].days[0].originalValue = 'B1';
    expect(parseSupplementImport(request).contentId).not.toBe(first.contentId);
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
