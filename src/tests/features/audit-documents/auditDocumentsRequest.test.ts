import { describe, expect, it } from 'vitest';

import {
  parseRutList,
  resolvePatientRanges,
} from '@/features/audit-documents/domain/auditDocumentsRequest';
import { getVisibleModules } from '@/utils/permissions';

describe('RUT list for the audit download', () => {
  it('reads RUTs pasted one per line, by commas or from a spreadsheet with names', () => {
    const parsed = parseRutList('11.111.111-1, 12345678-5\n22222222-2\tPaciente Prueba\n');

    expect(parsed).toEqual({
      runs: ['111111111', '123456785', '222222222'],
      invalid: [],
      repeated: 0,
    });
  });

  it('skips a repeated RUT however it was written', () => {
    expect(parseRutList('11.111.111-1\n111111111')).toEqual({
      runs: ['111111111'],
      invalid: [],
      repeated: 1,
    });
  });

  it.each([
    ['a wrong verifier digit', '11.111.111-2'],
    ['a passport', 'P1234567'],
    ['a RUT with a prefix glued to it', 'RUT:11111111-1'],
    ['a body too short for Eloísa', '1-9'],
  ])('reports %s instead of guessing a RUT', (_case, value) => {
    expect(parseRutList(value)).toEqual({ runs: [], invalid: [value], repeated: 0 });
  });

  it('gives each RUT its own dates when set and the general ones otherwise', () => {
    const { patients, invertedRuns } = resolvePatientRanges(
      ['111111111', '123456785', '222222222'],
      { dateFrom: '2026-01-01', dateTo: '2026-06-30' },
      {
        '123456785': { dateFrom: '2025-05-01', dateTo: '2025-05-31' },
        '222222222': { dateTo: '2025-12-01' },
      }
    );

    expect(patients).toEqual([
      { run: '111111111', dateFrom: '2026-01-01', dateTo: '2026-06-30' },
      { run: '123456785', dateFrom: '2025-05-01', dateTo: '2025-05-31' },
      { run: '222222222', dateFrom: '2026-01-01', dateTo: '2025-12-01' },
    ]);
    expect(invertedRuns).toEqual(['222222222']);
  });

  it('is offered to administration and hospital nursing only', () => {
    expect(getVisibleModules('admin')).toContain('AUDIT_DOCUMENTS');
    expect(getVisibleModules('nurse_hospital')).toContain('AUDIT_DOCUMENTS');
    for (const role of ['viewer', 'editor', 'doctor_urgency', 'doctor_specialist']) {
      expect(getVisibleModules(role)).not.toContain('AUDIT_DOCUMENTS');
    }
  });
});
