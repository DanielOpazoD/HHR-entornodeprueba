// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatClinicalDocumentDateTime } from '@/shared/clinical-documents/clinicalDocumentPresentation';

describe('clinicalDocumentPresentation', () => {
  it('formatea fechas clinicas para modal y sidebar', () => {
    expect(formatClinicalDocumentDateTime('2026-03-15T10:45:00.000Z')).not.toBe('—');
  });
});
