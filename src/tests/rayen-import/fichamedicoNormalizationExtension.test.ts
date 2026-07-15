import { describe, expect, it } from 'vitest';

import '../../../extension/fichamedico-normalization.js';

const normalization = (
  globalThis as typeof globalThis & {
    HhrFichaMedicoNormalization: {
      selectPrincipalDiagnosis: (
        rows: unknown[],
        header?: Record<string, unknown>,
        listItem?: Record<string, unknown>
      ) => { name: string; code: string; source: string };
    };
  }
).HhrFichaMedicoNormalization;

describe('Ficha Medico diagnosis normalization', () => {
  it('selects the first active principal diagnosis and its CIE-10 code', () => {
    expect(
      normalization.selectPrincipalDiagnosis(
        [
          {
            diagnosisName: 'Diagnóstico archivado',
            internalCode: 'A00.0',
            isPrincipal: true,
            archived: true,
          },
          {
            diagnosisName: 'Neumonía bacteriana',
            internalCode: 'J15.9',
            isPrincipal: 'S',
            archived: 'N',
            deleted: 0,
          },
          {
            diagnosisName: 'Diagnóstico secundario',
            internalCode: 'R50.9',
            isPrincipal: false,
          },
        ],
        { principalDiagName: 'Fallback' }
      )
    ).toEqual({
      name: 'Neumonía bacteriana',
      code: 'J15.9',
      source: 'principal-entry',
    });
  });

  it('falls back to the principal header diagnosis when entries are unavailable', () => {
    expect(
      normalization.selectPrincipalDiagnosis([], { principalDiagName: 'Diagnóstico principal' })
    ).toEqual({ name: 'Diagnóstico principal', code: '', source: 'principal-header' });
  });
});
