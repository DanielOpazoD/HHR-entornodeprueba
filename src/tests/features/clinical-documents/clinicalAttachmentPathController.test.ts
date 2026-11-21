// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildClinicalAttachmentStoragePath,
  normalizeClinicalAttachmentRutKey,
  sanitizeClinicalAttachmentFileName,
} from '@/features/clinical-documents/controllers/clinicalAttachmentPathController';

describe('clinicalAttachmentPathController', () => {
  it('normalizes RUTs for stable Storage paths', () => {
    expect(normalizeClinicalAttachmentRutKey('10.000.117-9')).toBe('10000117-9');
    expect(normalizeClinicalAttachmentRutKey('  9.876.543-K ')).toBe('9876543-k');
  });

  it('sanitizes filenames while preserving useful extensions', () => {
    expect(sanitizeClinicalAttachmentFileName(' Eco abdomen final (1).PDF ')).toBe(
      'Eco-abdomen-final-1.PDF'
    );
    expect(sanitizeClinicalAttachmentFileName('***')).toBe('archivo');
  });

  it('builds a patient and hospitalization scoped Storage path', () => {
    expect(
      buildClinicalAttachmentStoragePath({
        hospitalId: 'hhr',
        patientRut: '10.000.117-9',
        episodeKey: '10.000.117-9__2026-04-15',
        attachmentId: 'att_123',
        fileName: 'Informe externo.pdf',
      })
    ).toBe(
      'clinical-attachments/hhr/10000117-9/10000117-9__2026-04-15/att_123/Informe-externo.pdf'
    );
  });
});
