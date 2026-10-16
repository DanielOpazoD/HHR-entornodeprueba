import { describe, expect, it } from 'vitest';
import { buildDoc } from '@/tests/services/repositories/clinicalDocumentRepositoryFixture';
import {
  updateClinicalDocumentPdfFailure,
  updateClinicalDocumentPdfSuccess,
} from '@/features/clinical-documents/hooks/clinicalDocumentWorkspaceActionSupport';

const exported = buildDoc('document-a', 'episode-a', '2026-10-15T12:00:00Z');
const pdf = { exportStatus: 'exported' as const, fileId: 'synthetic-pdf' };
describe('PDF result document ownership', () => {
  it.each(['success', 'failure'] as const)(
    'does not apply a late %s to a different selected document',
    outcome => {
      const selected = buildDoc('document-b', 'episode-b', '2026-10-15T12:00:00Z');
      const result =
        outcome === 'success'
          ? updateClinicalDocumentPdfSuccess(selected, pdf, exported)
          : updateClinicalDocumentPdfFailure(selected, 'Unavailable', exported);
      expect(result).toBe(selected);
    }
  );

  it('does not match the same document id in another hospital or episode', () => {
    for (const selected of [
      { ...exported, hospitalId: 'another-hospital' },
      { ...exported, episodeKey: 'another-episode' },
    ]) {
      expect(updateClinicalDocumentPdfSuccess(selected, pdf, exported)).toBe(selected);
      expect(updateClinicalDocumentPdfFailure(selected, 'Unavailable', exported)).toBe(selected);
    }
  });

  it('updates only PDF metadata on the matching document, keeping current edits', () => {
    const edited = { ...exported, title: 'Título actualizado' };
    expect(updateClinicalDocumentPdfSuccess(edited, pdf, exported)).toEqual({ ...edited, pdf });
    expect(updateClinicalDocumentPdfFailure(edited, 'Unavailable', exported)).toMatchObject({
      title: edited.title,
      pdf: { exportStatus: 'failed', exportError: 'Unavailable' },
    });
    expect(edited.pdf).toBeUndefined();
  });
});
