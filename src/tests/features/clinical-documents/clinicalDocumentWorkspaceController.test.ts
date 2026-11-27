// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatClinicalDocumentAuthorName,
  getClinicalDocumentPatientFieldLabel,
} from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';

describe('clinicalDocumentWorkspaceController', () => {
  it('renames the epicrisis report date field to Fecha de alta', () => {
    const field = { id: 'finf', label: 'Fecha del informe', value: '', type: 'date' as const };
    expect(getClinicalDocumentPatientFieldLabel(field, 'epicrisis')).toBe('Fecha de alta');
  });

  it('formats author names as first name plus first surname', () => {
    expect(formatClinicalDocumentAuthorName('Juan Pablo Perez Soto')).toBe('Juan Perez');
    expect(formatClinicalDocumentAuthorName('Ana Perez')).toBe('Ana Perez');
  });
});
