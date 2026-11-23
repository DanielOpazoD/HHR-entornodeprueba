import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClinicalDocumentAuditLoggers } from '@/hooks/controllers/useClinicalDocumentAuditLoggers';

const defaultSessionStorage = globalThis.sessionStorage;

describe('useClinicalDocumentAuditLoggers', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.stubGlobal('sessionStorage', defaultSessionStorage);
  });

  it('throttles repeated CLINICAL_DOCUMENT_EDITED logs within the window', () => {
    const logEvent = vi.fn();
    const { result } = renderHook(() => useClinicalDocumentAuditLoggers(logEvent));

    result.current.logClinicalDocumentEdited('doc-1', 'tpl-1', 'Epicrisis', '11.111.111-1');
    result.current.logClinicalDocumentEdited('doc-1', 'tpl-1', 'Epicrisis', '11.111.111-1');

    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(
      'CLINICAL_DOCUMENT_EDITED',
      'clinicalDocument',
      'doc-1',
      { documentId: 'doc-1', templateId: 'tpl-1', documentTitle: 'Epicrisis' },
      '11.111.111-1',
      undefined
    );
  });

  it('still logs clinical document edits when sessionStorage throws SecurityError or QuotaExceededError', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn(() => {
        throw new DOMException('Blocked', 'SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }),
    });

    const logEvent = vi.fn();
    const { result } = renderHook(() => useClinicalDocumentAuditLoggers(logEvent));

    expect(() =>
      result.current.logClinicalDocumentEdited('doc-2', 'tpl-1', 'Evolucion', '11.111.111-1')
    ).not.toThrow();
    expect(logEvent).toHaveBeenCalledTimes(1);
  });
});
