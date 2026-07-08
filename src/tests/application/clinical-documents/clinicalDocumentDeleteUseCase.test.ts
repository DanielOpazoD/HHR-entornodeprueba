import { describe, expect, it, vi } from 'vitest';
import { executeDeleteClinicalDocument } from '@/application/clinical-documents/clinicalDocumentUseCases';
import type { ClinicalDocumentPort } from '@/application/ports/clinicalDocumentPort';

const buildPort = () =>
  ({ delete: vi.fn(async () => undefined) }) as unknown as ClinicalDocumentPort;

describe('executeDeleteClinicalDocument (fail-closed)', () => {
  it('audits BEFORE deleting and succeeds when the audit succeeds', async () => {
    const port = buildPort();
    const writeAuditEvent = vi.fn(async () => ({
      status: 'success' as const,
      data: null,
      issues: [],
    }));

    const outcome = await executeDeleteClinicalDocument(
      'doc-1',
      'hhr',
      { deletedBy: 'admin@h.cl', templateId: 'epicrisis', documentTitle: 'Epicrisis' },
      { clinicalDocumentPort: port, writeAuditEvent }
    );

    expect(outcome.status).toBe('success');
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin@h.cl',
        action: 'CLINICAL_DOCUMENT_DELETED',
        entityType: 'clinicalDocument',
        entityId: 'doc-1',
      })
    );
    expect(port.delete).toHaveBeenCalledWith('doc-1', 'hhr');
    // Audit-first: the audit was invoked before the delete.
    expect(writeAuditEvent.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(port.delete).mock.invocationCallOrder[0]
    );
  });

  it('fails closed: a failed audit was attempted and aborts before deleting', async () => {
    const port = buildPort();
    const writeAuditEvent = vi.fn(async () => ({
      status: 'failed' as const,
      data: null,
      issues: [],
    }));

    const outcome = await executeDeleteClinicalDocument(
      'doc-1',
      'hhr',
      { deletedBy: 'admin@h.cl' },
      { clinicalDocumentPort: port, writeAuditEvent }
    );

    expect(outcome.status).toBe('failed');
    expect(writeAuditEvent).toHaveBeenCalledTimes(1); // the audit WAS attempted (first)
    expect(port.delete).not.toHaveBeenCalled(); // ...and the delete never happened
  });
});
