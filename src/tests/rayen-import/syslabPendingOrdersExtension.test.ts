// @vitest-environment node
import { describe, expect, it } from 'vitest';
import '../../../extension/lab-result-parser.js';
import '../../../extension/lab-viewer.js';
const labViewer = (
  globalThis as unknown as {
    HhrLabViewer: {
      validateDetailBatch: (details: unknown[], ids: string[], rut: string) => unknown[] | null;
      buildAnalysis: (
        details: unknown[],
        exams: unknown[]
      ) => {
        columns: unknown[];
        summary: { reportCount: number };
      };
    };
  }
).HhrLabViewer;
describe('explicit pending Syslab orders', () => {
  it('accounts for pending orders without columns and still rejects missing or duplicate orders', () => {
    const pending = { examId: '123', status: 'no_validated_results' };
    const valid = { examId: '124', rutBody: '11111111', findings: [] };
    expect(labViewer.validateDetailBatch([pending, valid], ['123', '124'], '11111111')).toEqual([
      pending,
      valid,
    ]);
    expect(
      labViewer.validateDetailBatch([pending, pending], ['123', '124'], '11111111')
    ).toBeNull();
    expect(labViewer.validateDetailBatch([pending], ['123', '124'], '11111111')).toBeNull();
    expect(
      labViewer.validateDetailBatch([{ ...pending, findings: [] }], ['123'], '11111111')
    ).toBeNull();
    const result = labViewer.buildAnalysis([pending, valid], [{ id: '123' }, { id: '124' }]);
    expect(result.columns).toEqual([expect.objectContaining({ key: '124' })]);
    expect(result.summary.reportCount).toBe(1);
    expect(labViewer.buildAnalysis([pending], [{ id: '123' }]).columns).toEqual([]);
  });
});
