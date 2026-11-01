import { describe, expect, it } from 'vitest';

import {
  resolveClinicalDocumentExceptionMessage,
  resolveClinicalDocumentOutcomeError,
  shouldClearSelectedClinicalDocument,
} from '@/features/clinical-documents/hooks/clinicalDocumentWorkspaceActionSupport';
describe('clinicalDocumentWorkspaceActionSupport', () => {
  it('resolves outcome error preferring user-safe messages', () => {
    expect(
      resolveClinicalDocumentOutcomeError(
        {
          status: 'failed',
          data: null,
          userSafeMessage: 'Mensaje seguro.',
          issues: [{ kind: 'unknown', message: 'raw failure' }],
        },
        'fallback'
      )
    ).toBe('Mensaje seguro.');
  });

  it('resolves thrown exception messages with fallback for unknown values', () => {
    expect(resolveClinicalDocumentExceptionMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(resolveClinicalDocumentExceptionMessage('raw', 'fallback')).toBe('fallback');
  });

  it('detects when deleting the active document should clear workspace selection', () => {
    expect(shouldClearSelectedClinicalDocument('doc-1', 'doc-1')).toBe(true);
    expect(shouldClearSelectedClinicalDocument('doc-1', 'doc-2')).toBe(false);
    expect(shouldClearSelectedClinicalDocument(null, 'doc-1')).toBe(false);
  });
});
